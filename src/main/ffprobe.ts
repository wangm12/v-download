import type { ChildProcess, SpawnOptions } from 'child_process'
import { spawnManagedProcess } from './managedChildProcesses'
import { terminateDownloadProcess } from './downloadTypes'

type ProbeResult = { ok: true; metadata: unknown } | { ok: false; cancelled?: boolean; error: string }

/** Bounded, cancellable metadata probe. The caller can retain ownership for its cleanup path. */
export async function probeMediaMetadata(
  executable: string, args: string[], options: SpawnOptions, signal?: AbortSignal,
  onSpawn?: (child: ChildProcess, stop: () => Promise<boolean>) => void
): Promise<ProbeResult> {
  if (signal?.aborted) return { ok: false, cancelled: true, error: 'Probe cancelled' }
  let child: ChildProcess
  try { child = spawnManagedProcess(executable, args, options) }
  catch (error) { return { ok: false, error: `Could not start ffprobe: ${String(error)}` } }
  let termination: Promise<boolean> | undefined
  const stop = () => termination ??= terminateDownloadProcess(child, true)
  onSpawn?.(child, stop)
  return await new Promise<ProbeResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let failure = ''
    let settled = false
    let stopping = false
    const finish = (result: ProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const failAndStop = (error: string, cancelled = false) => {
      if (stopping || settled) return
      stopping = true
      failure = error
      void stop().then(
        (cleaned) => finish({ ok: false, error: cleaned ? error : `${error}; process cleanup could not be confirmed`, cancelled }),
        () => finish({ ok: false, error: `${error}; process cleanup failed`, cancelled })
      )
    }
    const onAbort = () => failAndStop('Probe cancelled', true)
    const timeout = setTimeout(() => failAndStop('ffprobe timed out after 15 seconds'), 15_000)
    timeout.unref?.()
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 64 * 1024) { failAndStop('ffprobe output exceeded its safety limit'); return }
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-64 * 1024) })
    child.once('error', (error) => { failure = error.message })
    child.once('close', (code) => {
      if (stopping) return // The stop owner resolves only after process-family cleanup.
      if (signal?.aborted) { onAbort(); return }
      if (failure) { finish({ ok: false, error: failure }); return }
      if (code !== 0) {
        const detail = stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n')
        finish({ ok: false, error: detail ? `ffprobe could not read the media: ${detail}` : `ffprobe exited with code ${code}` })
        return
      }
      try { finish({ ok: true, metadata: JSON.parse(stdout) }) }
      catch { finish({ ok: false, error: 'ffprobe returned malformed media metadata' }) }
    })
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}
