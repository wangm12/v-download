import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { Readable, Stream, Writable } from 'node:stream'
import { registerManagedProcessTerminator, terminateDownloadProcess } from './downloadTypes'

type ManagedChild = {
  process: ChildProcess
  closed: Promise<void>
  resolveClosed: () => void
  stopping?: Promise<boolean>
}

const children = new Map<ChildProcess, ManagedChild>()
let shutdownRequested = false
let shutdownPromise: Promise<void> | null = null
type StdioEntry = string | number | Stream | null | undefined

const POSIX_LIFETIME_WRAPPER = String.raw`
set -m
/bin/sleep 10 &
probe_pid=$!
probe_pgid=$(/bin/ps -o pgid= -p "$probe_pid" 2>/dev/null)
probe_pgid=$(printf '%s' "$probe_pgid" | /usr/bin/tr -d '[:space:]')
kill "$probe_pid" 2>/dev/null || :
wait "$probe_pid" 2>/dev/null || :
if [ "$probe_pgid" != "$probe_pid" ]; then exit 125; fi

"$@" 0</dev/null 3>&- 4>&- &
worker_pid=$!
printf '%s\n' "$worker_pid" >&3
exec 3>&-
set +m

watch_parent() {
  watchdog_sleep_pid=
  cleanup_watchdog_sleep() {
    if [ -n "$watchdog_sleep_pid" ]; then
      kill -TERM "$watchdog_sleep_pid" 2>/dev/null || :
      wait "$watchdog_sleep_pid" 2>/dev/null || :
      watchdog_sleep_pid=
    fi
  }
  trap 'cleanup_watchdog_sleep; exit 0' TERM INT HUP
  while IFS= read -r line; do :; done
  trap 'cleanup_watchdog_sleep; exit 0' TERM INT HUP
  kill -TERM -- "-$worker_pid" 2>/dev/null || :
  /bin/sleep 2 &
  watchdog_sleep_pid=$!
  wait "$watchdog_sleep_pid" 2>/dev/null || :
  watchdog_sleep_pid=
  kill -KILL -- "-$worker_pid" 2>/dev/null || :
}
watch_parent <&0 &
watchdog_pid=$!

term_killer_pid=
handle_term() {
  if [ -n "$term_killer_pid" ]; then return; fi
  kill -TERM -- "-$worker_pid" 2>/dev/null || :
  (
    killer_sleep_pid=
    cleanup_killer_sleep() {
      if [ -n "$killer_sleep_pid" ]; then
        kill -TERM "$killer_sleep_pid" 2>/dev/null || :
        wait "$killer_sleep_pid" 2>/dev/null || :
        killer_sleep_pid=
      fi
    }
    trap 'cleanup_killer_sleep; exit 0' TERM INT HUP
    /bin/sleep 1 &
    killer_sleep_pid=$!
    wait "$killer_sleep_pid" 2>/dev/null || exit 0
    killer_sleep_pid=
    kill -KILL -- "-$worker_pid" 2>/dev/null || :
  ) >/dev/null 2>&1 &
  term_killer_pid=$!
}
trap 'handle_term' TERM INT HUP

while :; do
  wait "$worker_pid"
  worker_status=$?
  # wait can return early when a trapped signal interrupts it. Only repeat
  # while the leader itself is still alive; its process-group descendants may
  # outlive it and are cleaned up separately below.
  if ! kill -0 "$worker_pid" 2>/dev/null; then break; fi
done

# A downloader may exit after its pipe closes while ffmpeg or another child is
# still writing. Wait for and terminate every remaining member of its job group.
if kill -0 -- "-$worker_pid" 2>/dev/null; then
  kill -TERM -- "-$worker_pid" 2>/dev/null || :
  /bin/sleep 2
  kill -KILL -- "-$worker_pid" 2>/dev/null || :
  remaining=0
  while [ "$remaining" -lt 50 ] && kill -0 -- "-$worker_pid" 2>/dev/null; do
    /bin/sleep 0.1
    remaining=$((remaining + 1))
  done
fi

if [ -n "$term_killer_pid" ]; then
  kill -TERM "$term_killer_pid" 2>/dev/null || :
  wait "$term_killer_pid" 2>/dev/null || :
fi
kill -TERM "$watchdog_pid" 2>/dev/null || :
wait "$watchdog_pid" 2>/dev/null || :
exit "$worker_status"
`

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function signalGroup(pid: number | null, signal: NodeJS.Signals): void {
  if (typeof pid !== 'number') return
  try {
    process.kill(-pid, signal)
  } catch {
    /* The worker group may have exited between its state check and signal. */
  }
}

function stopPosixWrapper(proc: ChildProcess): () => Promise<boolean> {
  const control = proc.stdin as Writable | null
  const workerPidStream = proc.stdio[3] as Readable | null
  let workerPid: number | null = null
  let pidLine = ''
  let pidSettled = false
  let resolveWorkerPid!: (pid: number | undefined) => void
  const workerPidReady = new Promise<number | undefined>((resolve) => { resolveWorkerPid = resolve })
  let closeSettled = false
  let workerGroupStoppedAtClose = true
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
  let stopRequested = false
  let stopPromise: Promise<boolean> | null = null
  let escalationTimer: ReturnType<typeof setTimeout> | undefined

  const settleWorkerPid = (pid?: number) => {
    if (pidSettled) return
    pidSettled = true
    resolveWorkerPid(pid)
  }

  const onPidData = (chunk: Buffer | string) => {
    pidLine += chunk.toString()
    const newline = pidLine.indexOf('\n')
    if (newline < 0) return
    const parsed = Number(pidLine.slice(0, newline).trim())
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      workerPid = parsed
      settleWorkerPid(parsed)
      if (stopRequested) beginWorkerTermination()
    } else {
      settleWorkerPid()
    }
  }

  const beginWorkerTermination = () => {
    if (closeSettled || workerPid == null) return
    signalGroup(workerPid, 'SIGTERM')
    if (!escalationTimer) {
      escalationTimer = setTimeout(() => signalGroup(workerPid, 'SIGKILL'), 1500)
      escalationTimer.unref?.()
    }
  }

  workerPidStream?.on('data', onPidData)
  workerPidStream?.once('end', () => settleWorkerPid())
  workerPidStream?.once('error', () => settleWorkerPid())
  control?.on('error', () => {})
  proc.once('close', () => {
    // ChildProcess terminators can be called well after `close` (the provider
    // keeps its ChildProcess reference). Retire the numeric PGID here so an old
    // handle can never signal an unrelated process group that later reused it.
    if (workerPid != null) workerGroupStoppedAtClose = !groupExists(workerPid)
    workerPid = null
    if (escalationTimer) {
      clearTimeout(escalationTimer)
      escalationTimer = undefined
    }
    closeSettled = true
    settleWorkerPid()
    resolveClosed()
  })

  return () => {
    if (stopPromise) return stopPromise
    stopRequested = true
    try {
      if (control && !control.destroyed) control.end()
    } catch {
      /* close/error on the wrapper also triggers its EOF recovery path */
    }
    if (workerPid != null) beginWorkerTermination()

    stopPromise = (async () => {
      const pid = await Promise.race([
        workerPidReady,
        closed.then(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500))
      ])
      if (typeof pid === 'number' && workerPid == null && !closeSettled) workerPid = pid
      if (workerPid != null) beginWorkerTermination()

      let timeout: ReturnType<typeof setTimeout> | undefined
      const closedInTime = await Promise.race([
        closed.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 6000)
          timeout.unref?.()
        })
      ])
      if (timeout) clearTimeout(timeout)

      if (!closedInTime) {
        signalGroup(workerPid, 'SIGKILL')
        try { proc.kill('SIGKILL') } catch { /* wrapper already exited */ }
        await Promise.race([
          closed,
          new Promise<void>((resolve) => setTimeout(resolve, 2500))
        ])
      }
      if (escalationTimer) clearTimeout(escalationTimer)
      return closeSettled && workerGroupStoppedAtClose
    })()
    return stopPromise
  }
}

function stopChild(child: ManagedChild): Promise<boolean> {
  if (!child.stopping) child.stopping = terminateDownloadProcess(child.process, true)
  return child.stopping
}

/** Track a helper so application shutdown can stop it and wait for its process group. */
export function registerManagedChildProcess(
  proc: ChildProcess,
  managedTerminator?: () => Promise<boolean>
): void {
  if (managedTerminator) registerManagedProcessTerminator(proc, managedTerminator)
  if (children.has(proc)) return
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
  const child: ManagedChild = { process: proc, closed, resolveClosed }
  children.set(proc, child)
  proc.once('close', () => {
    if (children.get(proc) === child) children.delete(proc)
    resolveClosed()
  })
  if (shutdownRequested) void stopChild(child)
}

function normalizeStdio(stdio: SpawnOptions['stdio']): StdioEntry[] {
  if (typeof stdio === 'string') return [stdio as StdioEntry, stdio as StdioEntry, stdio as StdioEntry]
  if (!stdio) return ['pipe', 'pipe', 'pipe']
  const normalized = [...stdio].slice(0, 3) as StdioEntry[]
  while (normalized.length < 3) normalized.push('pipe')
  return normalized
}

/**
 * Spawn a media helper under an EOF watchdog on POSIX so SIGKILL of Electron
 * still stops the worker and same-group post-processors. Windows keeps direct
 * spawn semantics because its child tree has a different lifecycle contract.
 */
export function spawnManagedProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {}
): ChildProcess {
  if (process.platform === 'win32') {
    const proc = spawn(command, [...args], options)
    registerManagedChildProcess(proc)
    return proc
  }

  const stdio = normalizeStdio(options.stdio)
  if (stdio[0] !== 'ignore') {
    throw new Error('Managed POSIX media processes require ignored stdin')
  }

  const proc = spawn('/bin/bash', [
    '--noprofile',
    '--norc',
    '-p',
    '-c',
    POSIX_LIFETIME_WRAPPER,
    'v-download-managed-child',
    command,
    ...args
  ], {
    ...options,
    detached: true,
    stdio: ['pipe', stdio[1]!, stdio[2]!, 'pipe'] as unknown as SpawnOptions['stdio']
  })
  const terminate = stopPosixWrapper(proc)
  registerManagedChildProcess(proc, terminate)
  return proc
}

export function isManagedChildShutdownRequested(): boolean {
  return shutdownRequested
}

/** Stop all registered metadata, playlist-listing, thumbnail and download helpers. */
export function stopManagedChildProcesses(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  shutdownRequested = true
  shutdownPromise = (async () => {
    while (children.size > 0) {
      const active = [...children.values()]
      await Promise.allSettled(active.map(async (child) => {
        const stopped = await stopChild(child)
        if (!stopped) {
          console.warn(`[managed-processes] process group remained visible after shutdown pid=${child.process.pid ?? 'unknown'}`)
        }
        await child.closed
      }))
    }
  })()
  return shutdownPromise
}
