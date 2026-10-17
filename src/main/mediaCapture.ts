import { randomBytes } from 'crypto'
import type { MediaCaptureCommand } from '@v-download/shared'
import * as downloads from './downloadManager'
import type { CapturedMediaInput } from './mediaInspection'

const TTL = 10 * 60 * 1000
interface CaptureSession {
  command: MediaCaptureCommand
  taskId: string
  outputDir: string
  taskRevision: string
  origin?: string
  acceptedInput?: string
  busy?: boolean
}
const sessions = new Map<string, CaptureSession>()
function prune(): void { for (const [id, s] of sessions) if (s.command.expiresAt <= Date.now()) sessions.delete(id) }

export function beginMediaCapture(taskId: string, pageUrl?: string): MediaCaptureCommand {
  prune()
  const state = downloads.mediaCaptureState(taskId)
  const sourcePage = pageUrl ?? state.pageUrl
  if (typeof sourcePage !== 'string' || sourcePage.length > 8192 || /[\u0000-\u0020\u007f]/.test(sourcePage)) throw new Error('Enter a valid HTTP(S) source page')
  const parsedPage = new URL(sourcePage)
  if (!/^https?:$/.test(parsedPage.protocol) || parsedPage.username || parsedPage.password) throw new Error('Enter a valid HTTP(S) source page')
  for (const [id, s] of sessions) if (s.taskId === taskId) sessions.delete(id)
  if (sessions.size >= 64) throw new Error('Too many browser capture sessions. Close another session first.')
  const command: MediaCaptureCommand = { requestId: randomBytes(24).toString('hex'), pageUrl: parsedPage.href,
    title: state.task.title, planName: state.planName, exactSource: state.exactSource, expiresAt: Date.now() + TTL }
  sessions.set(command.requestId, { command, taskId, outputDir: state.outputDir, taskRevision: state.revision })
  return command
}
export function cancelMediaCapture(taskId: string): void {
  for (const [id, s] of sessions) if (s.taskId === taskId) sessions.delete(id)
}
export function cancelCapturedMediaSession(requestId: string, origin: string): void {
  const session = sessions.get(requestId)
  if (session?.origin === origin) sessions.delete(requestId)
}
export function mediaCaptureCommand(requestId: string, origin: string): MediaCaptureCommand | undefined {
  prune()
  const session = sessions.get(requestId)
  if (!session || session.acceptedInput || (session.origin && session.origin !== origin)) return undefined
  session.origin = origin
  return session.command
}
export async function completeMediaCapture(requestId: string, input: CapturedMediaInput, origin: string): Promise<void> {
  prune()
  const session = sessions.get(requestId)
  if (!session || session.origin !== origin) throw new Error('Capture session expired. Return to the task and start again.')
  const identity = JSON.stringify([input.url, input.type, input.referer, input.sourceContext?.pageUrl, input.sourceContext?.documentUrl])
  if (session.acceptedInput === identity) return // Idempotent retry after a lost response.
  if (session.acceptedInput || session.busy) throw new Error('This capture session is already being submitted.')
  if (!input.sourceContext || input.sourceContext.pageUrl !== session.command.pageUrl) throw new Error('The candidate belongs to another page. Return to the source page or start a new capture.')
  session.busy = true
  try {
    await downloads.recaptureTask(session.taskId, input, session.taskRevision, session.outputDir,
      () => sessions.get(requestId) === session && session.command.expiresAt > Date.now())
    session.acceptedInput = identity
  } finally { session.busy = false }
}
