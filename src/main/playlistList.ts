import { spawn } from 'child_process'
import {
  addYtdlpCookieArgs,
  getYtdlpPath,
  normalizeThumbnailUrl,
  collectPlaylistMetaFromJson,
  fetchThumbnailForPageUrl,
  type VideoInfo
} from './ytdlp'

export interface PlaylistEntryRow {
  id: string
  title: string
  channel: string
  thumbnail: string
  duration: number
  pageUrl: string
  playlistIndex?: number
}

export interface PlaylistListResult {
  items: PlaylistEntryRow[]
  playlistTitle: string
  playlistChannel: string
  sourceUrl: string
}

function spawnEnv(): Record<string, string> {
  return { ...(process.env as Record<string, string>) }
}

function bilibiliBvFromUrl(url: string): string | null {
  const m = url.match(/\/video\/(BV[\w]+)/i)
  return m?.[1] ?? null
}

function isBilibiliAnthology(items: PlaylistEntryRow[]): boolean {
  if (items.length < 2) return false
  const bvs = new Set(
    items.map((i) => bilibiliBvFromUrl(i.pageUrl)).filter((bv): bv is string => Boolean(bv))
  )
  return bvs.size === 1
}

async function enrichMissingThumbnails(
  items: PlaylistEntryRow[],
  sourceUrl: string,
  cookiesPath?: string,
  ytdlpPath?: string
): Promise<void> {
  if (items.every((i) => i.thumbnail)) return
  if (!/bilibili\.com|b23\.tv/i.test(sourceUrl)) return

  if (isBilibiliAnthology(items)) {
    const sample = items.find((i) => i.pageUrl)?.pageUrl ?? sourceUrl
    const thumb = await fetchThumbnailForPageUrl(sample, cookiesPath, ytdlpPath)
    if (!thumb) return
    for (const item of items) {
      if (!item.thumbnail) item.thumbnail = thumb
    }
    return
  }

  const missing = items.filter((i) => !i.thumbnail && i.pageUrl)
  const concurrency = 4
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
      while (idx < missing.length) {
        const item = missing[idx++]!
        const thumb = await fetchThumbnailForPageUrl(item.pageUrl, cookiesPath, ytdlpPath)
        if (thumb) item.thumbnail = thumb
      }
    })
  )
}

function entryDisplayTitle(
  json: Record<string, unknown>,
  playlistTitle?: string
): string {
  const raw = String(json.title ?? '').trim()
  if (raw && raw !== 'Unknown') return raw

  const idx = typeof json.playlist_index === 'number' ? json.playlist_index : undefined
  const series = String(json.playlist_title ?? playlistTitle ?? '').trim()
  if (series && idx != null) {
    return `${series} · p${String(idx).padStart(2, '0')}`
  }
  if (idx != null) return `Part ${idx}`

  const id = String(json.id ?? '').trim()
  if (id) return id
  return 'Untitled'
}

function jsonToPlaylistRow(
  json: Record<string, unknown>,
  playlistTitle?: string,
  playlistChannel?: string
): PlaylistEntryRow {
  const thumbnails = json.thumbnails as Array<{ url: string }> | undefined
  const rawThumb = thumbnails?.[0]?.url ?? (json.thumbnail as string) ?? ''
  const channel = String(
    json.channel ?? json.uploader ?? json.playlist_uploader ?? playlistChannel ?? ''
  )

  return {
    id: String(json.id ?? ''),
    title: entryDisplayTitle(json, playlistTitle),
    channel,
    thumbnail: normalizeThumbnailUrl(rawThumb),
    duration: typeof json.duration === 'number' ? json.duration : 0,
    pageUrl: String(json.webpage_url ?? json.url ?? ''),
    playlistIndex: typeof json.playlist_index === 'number' ? json.playlist_index : undefined
  }
}

/** Fast flat list for YouTube/Bilibili playlists, channels, and multi-part anthologies. */
export async function listPlaylistEntries(
  url: string,
  cookiesPath?: string,
  ytdlpPath?: string
): Promise<PlaylistListResult> {
  const path = getYtdlpPath(ytdlpPath)
  const args: string[] = [
    '--dump-json',
    '--flat-playlist',
    '--no-download',
    '--no-warnings',
    '--no-check-certificate'
  ]

  addYtdlpCookieArgs(url, args, cookiesPath)
  args.push(url)

  const result = await new Promise<PlaylistListResult>((resolve, reject) => {
    const proc = spawn(path, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`yt-dlp list failed (code ${code}): ${stderr || stdout}`))
        return
      }

      try {
        const lines = stdout.trim().split('\n').filter(Boolean)
        const items: PlaylistEntryRow[] = []
        const meta = {
          playlistTitle: undefined as string | undefined,
          playlistChannel: undefined as string | undefined,
          playlistCount: 0
        }

        for (const line of lines) {
          const json = JSON.parse(line) as Record<string, unknown>
          if (json._type === 'playlist') {
            meta.playlistTitle = String(json.title ?? meta.playlistTitle ?? '')
            meta.playlistCount = (json.n_entries as number) ?? meta.playlistCount
            continue
          }
          if (json._type === 'video' || json._type === 'url' || json.id) {
            collectPlaylistMetaFromJson(json, meta)
            items.push(jsonToPlaylistRow(json, meta.playlistTitle, meta.playlistChannel))
          }
        }

        if (items.length === 0) {
          reject(new Error('No videos found in this playlist or channel'))
          return
        }

        const playlistTitle =
          meta.playlistTitle?.trim() ||
          items[0]?.title ||
          'Playlist'
        const playlistChannel =
          meta.playlistChannel?.trim() || items.find((i) => i.channel)?.channel || ''

        resolve({
          items,
          playlistTitle,
          playlistChannel,
          sourceUrl: url
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })

    proc.on('error', (err) => reject(err))
  })

  await enrichMissingThumbnails(result.items, url, cookiesPath, ytdlpPath)
  return result
}

/** Map full getVideoInfo entries into picker rows (e.g. after slow Bilibili anthology fetch). */
export function playlistRowsFromVideoInfo(
  entries: VideoInfo[],
  playlistTitle: string,
  playlistChannel: string,
  sourceUrl: string
): PlaylistListResult {
  return {
    items: entries.map((e, i) => ({
      id: e.id || e.webpage_url || String(i),
      title: e.title || `Part ${i + 1}`,
      channel: e.channel || playlistChannel,
      thumbnail: e.thumbnail,
      duration: e.duration,
      pageUrl: e.webpage_url,
      playlistIndex: i + 1
    })),
    playlistTitle,
    playlistChannel,
    sourceUrl
  }
}
