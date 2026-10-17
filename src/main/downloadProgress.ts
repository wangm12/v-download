import type { DownloadRequestSnapshot } from './downloadRequestSnapshot'
import type { DownloadTask } from './downloadManager'

export type ProgressExtras = {
  speed?: string
  eta?: string
  totalSize?: string | null
  phase?: string | null
}

/** Slim IPC payload — avoids shipping full task metadata/thumbnails on every progress tick. */
export function downloadProgressPayload(task: DownloadTask, extras?: ProgressExtras, taskChanged = false): Record<string, unknown> {
  const request = task.metadata.downloadRequest as DownloadRequestSnapshot | undefined
  const stateChange = taskChanged || ['resolving', 'ready', 'complete', 'error', 'cancelled', 'paused', 'interrupted'].includes(task.status)
  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    speed: extras?.speed ?? '',
    eta: extras?.eta ?? '',
    totalSize: extras?.totalSize ?? null,
    phase: extras?.phase ?? null,
    ...(stateChange || (task.status === 'downloading' && task.progress <= 1) ? { outputDir: task.outputDir ?? null } : {}),
    ...(task.filePath != null || stateChange ? { filePath: task.filePath } : {}),
    ...(task.title ? { title: task.title } : {}),
    ...(stateChange
      ? {
          format: task.format,
          quality: task.quality,
          selection: request?.selection ?? null,
          sourceContext: task.metadata.sourceContext ?? null,
          mediaUrl: (task.metadata.candidate as { url?: string } | undefined)?.url ?? null,
          recaptureAt: task.metadata.recaptureAt ?? null,
          planName: request?.plan?.name ?? null,
          planId: request?.plan?.id ?? null,
          error: task.error,
          errorCode: task.errorCode ?? null,
          thumbnail: task.thumbnail,
          duration: task.duration,
          channel: task.metadata.channel ?? null,
        }
      : {}),
  }
}
