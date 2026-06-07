import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import * as settings from './settings'

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
  cancel: () => void
} {
  const runPy = settings.get('douyinBulkRunPyPath').trim()
  const config = settings.get('douyinBulkConfigPath').trim()
  if (!runPy || !config) {
    return {
      promise: Promise.reject(new Error('Douyin bulk: set douyinBulkRunPyPath and douyinBulkConfigPath in settings')),
      cancel: () => {}
    }
  }
  if (!existsSync(runPy)) {
    return {
      promise: Promise.reject(new Error(`Douyin bulk: run.py not found: ${runPy}`)),
      cancel: () => {}
    }
  }
  if (!existsSync(config)) {
    return {
      promise: Promise.reject(new Error(`Douyin bulk: config not found: ${config}`)),
      cancel: () => {}
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

  const proc = spawn(python, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  let stderr = ''
  proc.stderr?.on('data', (c: Buffer) => {
    stderr += c.toString()
  })

  const cancel = () => {
    try {
      proc.kill('SIGTERM')
    } catch {
      proc.kill('SIGKILL')
    }
  }

  const promise = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stderr }))
  })

  return { promise, cancel }
}
