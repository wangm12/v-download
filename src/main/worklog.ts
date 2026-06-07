import { app } from 'electron'
import { appendFileSync, mkdirSync, existsSync, renameSync, statSync } from 'fs'
import { join, dirname } from 'path'

const MAX_BYTES_BEFORE_ROTATE = 4 * 1024 * 1024

let worklogFilePath = ''
let handlersInstalled = false

function rotateIfNeeded(): void {
  if (!worklogFilePath || !existsSync(worklogFilePath)) return
  try {
    const st = statSync(worklogFilePath)
    if (st.size < MAX_BYTES_BEFORE_ROTATE) return
    const dir = dirname(worklogFilePath)
    const prev = join(dir, 'worklog-prev.txt')
    if (existsSync(prev)) {
      try {
        renameSync(prev, join(dir, 'worklog-prev-old.txt'))
      } catch {
        /* ignore */
      }
    }
    renameSync(worklogFilePath, prev)
  } catch {
    /* ignore */
  }
}

/**
 * Release / packaged builds: append JSON lines to `userData/logs/worklog.txt`.
 * Dev (`!app.isPackaged`): print structured lines to stderr so `make dev` + tee capture them.
 */
export function initWorklog(): void {
  if (app.isPackaged) {
    try {
      const dir = join(app.getPath('userData'), 'logs')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      worklogFilePath = join(dir, 'worklog.txt')
      appendFileSync(
        worklogFilePath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          event: 'session_start',
          version: app.getVersion(),
          platform: process.platform,
          execPath: app.getPath('exe')
        })}\n`,
        'utf-8'
      )
    } catch (err) {
      console.error('[worklog] init failed:', err)
    }
  }

  if (handlersInstalled) return
  handlersInstalled = true

  process.on('uncaughtException', (err) => {
    worklogError('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    worklogError('unhandledRejection', err)
  })
}

function appendLine(obj: Record<string, unknown>): void {
  const line = `${JSON.stringify(obj)}\n`
  if (!app.isPackaged) {
    console.log(`[worklog] ${line.trimEnd()}`)
    return
  }
  if (!worklogFilePath) return
  try {
    rotateIfNeeded()
    appendFileSync(worklogFilePath, line, 'utf-8')
  } catch (err) {
    console.error('[worklog] append failed:', err)
  }
}

/** Structured diagnostic (file in release; stderr in dev). */
export function worklog(event: string, data?: Record<string, unknown>): void {
  appendLine({
    ts: new Date().toISOString(),
    event,
    ...data
  })
}

export function worklogError(event: string, err: unknown, extra?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  appendLine({
    ts: new Date().toISOString(),
    event,
    error: message,
    stack,
    ...extra
  })
  console.error(`[worklog] ${event}:`, message)
}

/** Human-readable path to the release worklog (after init). */
export function getWorklogPathForDisplay(): string {
  if (!app.isPackaged) return '(dev — see terminal / logs/dev-*.log from make dev)'
  return worklogFilePath || join(app.getPath('userData'), 'logs', 'worklog.txt')
}
