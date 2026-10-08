import { existsSync, mkdirSync } from 'fs'
import * as settings from './settings'
import { terminateDownloadProcess } from './downloadTypes'
import { spawnManagedProcess } from './managedChildProcesses'

export interface DouyinBulkRunOptions {
  /** Profile or collection URL (passed to douyin-downloader `-u`). */
  url: string
}

/**
 * Run [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader) as a subprocess when
 * `douyinBulkRunPyPath` and `douyinBulkConfigPath` are set in settings.
 * Expects `run.py` at `RunPyPath` and a valid `config.yml` at `ConfigPath`.
 */
export function runDouyinBulkCli(options: DouyinBulkRunOptions): {
  promise: Promise<{ code: number | null; stderr: string }>
  cancel: () => Promise<boolean>
} {
  const runPy = settings.get('douyinBulkRunPyPath').trim()
  const config = settings.get('douyinBulkConfigPath').trim()
  if (!runPy || !config) {
    return {
      promise: Promise.reject(new Error('Douyin bulk: set douyinBulkRunPyPath and douyinBulkConfigPath in settings')),
      cancel: () => Promise.resolve(true)
    }
  }
  if (!existsSync(runPy)) {
    return {
      promise: Promise.reject(new Error(`Douyin bulk: run.py not found: ${runPy}`)),
      cancel: () => Promise.resolve(true)
    }
  }
  if (!existsSync(config)) {
    return {
      promise: Promise.reject(new Error(`Douyin bulk: config not found: ${config}`)),
      cancel: () => Promise.resolve(true)
    }
  }

  const bulkOut = settings.get('douyinBulkOutputPath').trim()
  const downloadDir = settings.get('downloadDir').trim()
  const outPath = bulkOut || downloadDir
  if (outPath) {
    try {
      mkdirSync(outPath, { recursive: true })
    } catch {
      /* downloader may still create; ignore mkdir errors */
    }
  }

  const python = process.platform === 'win32' ? 'python' : 'python3'
  const threads = settings.get('douyinBulkThreads')
  const args = [runPy, '-c', config, '-u', options.url, '-p', outPath || downloadDir, '-t', String(threads)]
  if (settings.get('douyinBulkVerboseWarnings')) {
    args.push('--show-warnings')
  }

  const proc = spawnManagedProcess(python, args, {
    // This downloader can print progress continuously; its stdout is not part
    // of the job result, so pipe it to nowhere rather than risk backpressure.
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env },
    detached: process.platform !== 'win32',
  })

  let stderr = ''
  proc.stderr?.on('data', (c: Buffer) => {
    stderr = `${stderr}${c.toString('utf8')}`.slice(-4000)
  })

  let cancellation: Promise<boolean> | null = null
  const cancel = () => {
    cancellation ??= terminateDownloadProcess(proc, true)
    return cancellation
  }

  const promise = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    let spawnError: Error | null = null
    proc.once('error', (error) => { spawnError = error })
    proc.once('close', async (code) => {
      if (cancellation && !(await cancellation)) {
        stderr = `${stderr}\nBulk process group remained visible after SIGKILL.`.slice(-4000)
      }
      if (spawnError) reject(spawnError)
      else resolve({ code, stderr })
    })
  })

  return { promise, cancel }
}
