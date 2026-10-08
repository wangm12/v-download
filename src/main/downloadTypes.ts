import type { ChildProcess } from 'child_process'

/** Progress snapshot emitted by yt-dlp or ffmpeg download engines. */
export interface DownloadProgress {
  percent: number
  speed: string
  eta: string
  downloaded: string
  total: string
  phase: 'video' | 'audio' | 'merging' | ''
}

/** Subprocess-backed download handle (yt-dlp or ffmpeg). */
export interface DownloadProcess {
  process: ChildProcess
  onProgress: (cb: (progress: DownloadProgress) => void) => void
  cancel: () => void
  /** Completes only after cancellation escalation and its process group cleanup finish. */
  waitForCleanup?: () => Promise<boolean>
  getStderr: () => string
  /** Full yt-dlp stdout + stderr (for post-close destination / id parsing). */
  getOutput?: () => string
  getDestinations: () => string[]
  /** Final post-merge output paths reported by yt-dlp's after_move print hook. */
  getFinalDestinations?: () => string[]
  /** True when a bounded yt-dlp line/path parser could not capture every reported output. */
  hasIncompleteOutputPathMetadata?: () => boolean
}

const terminationCompletions = new WeakMap<ChildProcess, Promise<boolean>>()
const managedTerminators = new WeakMap<ChildProcess, () => Promise<boolean>>()

/** Register a process-specific cleanup path before callers can cancel it. */
export function registerManagedProcessTerminator(
  proc: ChildProcess,
  terminate: () => Promise<boolean>
): void {
  managedTerminators.set(proc, terminate)
}

function posixProcessGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Stop a downloader and its POSIX child processes, escalating if it ignores SIGTERM. */
export function terminateDownloadProcess(proc: ChildProcess, detachedProcessGroup: boolean): Promise<boolean> {
  const existing = terminationCompletions.get(proc)
  if (existing) return existing

  const managedTerminator = managedTerminators.get(proc)
  if (managedTerminator) {
    const completion = managedTerminator()
    terminationCompletions.set(proc, completion)
    return completion
  }

  // A caller can cancel in the small interval after spawn() returns but before
  // Node assigns pid. Defer signalling until `spawn`; a one-shot kill attempt
  // here would otherwise leave the newly-started child running.
  if (typeof proc.pid !== 'number' && proc.exitCode === null && proc.signalCode === null) {
    let finishBeforeSpawn!: (groupStopped: boolean) => void
    const beforeSpawn = new Promise<boolean>((resolve) => { finishBeforeSpawn = resolve })
    const cleanupListeners = () => {
      proc.removeListener('spawn', onSpawn)
      proc.removeListener('error', onSpawnError)
      proc.removeListener('close', onCloseBeforeSpawn)
    }
    const onSpawn = () => {
      cleanupListeners()
      terminationCompletions.delete(proc)
      void terminateDownloadProcess(proc, detachedProcessGroup).then(finishBeforeSpawn)
    }
    const onCloseBeforeSpawn = () => {
      cleanupListeners()
      finishBeforeSpawn(true)
    }
    const onSpawnError = () => {
      // Node emits `close` after a spawn error. Wait for it before allowing a
      // caller to release files or a queue slot.
    }
    terminationCompletions.set(proc, beforeSpawn)
    proc.once('spawn', onSpawn)
    proc.once('error', onSpawnError)
    proc.once('close', onCloseBeforeSpawn)
    return beforeSpawn
  }

  const hasProcessGroup = detachedProcessGroup && process.platform !== 'win32' && typeof proc.pid === 'number'
  const parentAlive = (): boolean => typeof proc.pid === 'number' && proc.exitCode === null && proc.signalCode === null
  const groupAlive = (): boolean => hasProcessGroup && posixProcessGroupExists(proc.pid!)
  if (!parentAlive() && !groupAlive()) return Promise.resolve(true)

  const send = (signal: NodeJS.Signals): void => {
    if (detachedProcessGroup && process.platform !== 'win32' && typeof proc.pid === 'number') {
      try {
        process.kill(-proc.pid, signal)
        return
      } catch {
        /* Fall back to the direct child when the group is already gone. */
      }
    }
    try {
      proc.kill(signal)
    } catch {
      /* The child may have exited between the state check and signal. */
    }
  }

  let escalationTimer: ReturnType<typeof setTimeout> | undefined
  let finalTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let finish!: (groupStopped: boolean) => void
  let killSentAt = 0
  const completion = new Promise<boolean>((resolve) => { finish = resolve })
  terminationCompletions.set(proc, completion)

  const checkFinished = (): void => {
    if (!parentAlive() && !groupAlive()) {
      if (escalationTimer) clearTimeout(escalationTimer)
      if (finalTimer) clearTimeout(finalTimer)
      if (pollTimer) clearTimeout(pollTimer)
      finish(true)
      return
    }
    // SIGKILL cannot be ignored, but a group may remain visible briefly as
    // unreaped zombies under container/PID-1 init. Bound cleanup waiting after
    // escalation and report that the kernel still sees the group.
    if (killSentAt > 0 && Date.now() - killSentAt >= 2000) {
      if (finalTimer) clearTimeout(finalTimer)
      if (pollTimer) clearTimeout(pollTimer)
      finish(false)
      return
    }
    pollTimer = setTimeout(checkFinished, 50)
  }

  send('SIGTERM')
  escalationTimer = setTimeout(() => {
    if (groupAlive() || parentAlive()) {
      send('SIGKILL')
      killSentAt = Date.now()
      finalTimer = setTimeout(checkFinished, 2000)
    }
    checkFinished()
  }, 1500)
  checkFinished()
  return completion
}
