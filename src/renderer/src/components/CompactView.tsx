import { useCallback, useEffect, useState } from 'react'
import { ClipboardPaste } from 'lucide-react'
import { useDownloads } from '@/hooks/useDownloads'
import { useSettings } from '@/hooks/useSettings'
import { useUrlHandler } from '@/hooks/useUrlHandler'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { extractUrlFromClipboard } from '@/utils/youtube'
import { isPlaylistUrl } from '@/utils/youtube'
import { noteMetadataFromVideoInfo, withIncludeNote } from '@/utils/noteMetadata'
import { FormatDialog } from './FormatDialog'
import { DouyinProfilePickerDialog } from './DouyinProfilePickerDialog'
import { CollectionPickerDialog } from './CollectionPickerDialog'
import {
  COMPACT_WINDOW_TITLE,
  compactActiveDownloads,
  compactProgressLine,
  oneShotClipboardFill
} from './compactViewPresentation'
import { useTranslation } from 'react-i18next'
import type { TaskDownloadOverrides } from './taskOverridesPresentation'

export function CompactView() {
  const { t } = useTranslation()
  const { downloads } = useDownloads()
  const { settings } = useSettings()
  const {
    errorMsg,
    showFormatDialog,
    showDouyinProfilePicker,
    douyinProfileUrl,
    showCollectionPicker,
    collectionPickerUrl,
    pendingVideoInfo,
    pendingResolverId,
    pendingEntries,
    pendingPlaylistMeta,
    queueCount,
    handleUrl,
    handlePaste,
    applyBulkNotice,
    clearPending,
    clearQueue,
    setShowFormatDialog,
    closeDouyinProfilePicker,
    closeCollectionPicker
  } = useUrlHandler(settings)
  const [urlField, setUrlField] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const active = compactActiveDownloads(downloads)

  useEffect(() => {
    let cancelled = false
    void window.api?.readClipboard().then((text) => {
      if (cancelled) return
      setUrlField((current) => oneShotClipboardFill(current, text, extractUrlFromClipboard))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const submitUrl = useCallback(async (raw: string) => {
    const url = extractUrlFromClipboard(raw) || raw.trim()
    if (!url) return
    setUrlField(url)
    await handleUrl(url)
  }, [handleUrl])

  const onPasteUrl = useCallback(async () => {
    if (urlField.trim()) {
      await submitUrl(urlField)
      return
    }
    await handlePaste()
  }, [handlePaste, submitUrl, urlField])

  useKeyboardShortcuts({
    onPaste: () => {
      void onPasteUrl()
    }
  })

  const handleDownload = useCallback(
    async (
      _url: string,
      format: string,
      quality: string,
      includeNote = true,
      overrides?: TaskDownloadOverrides
    ) => {
      if (!window.api) return
      const taskFields = {
        ...(overrides?.outputDir ? { outputDir: overrides.outputDir } : {}),
        ...(overrides?.proxyUrl ? { proxyUrl: overrides.proxyUrl } : {}),
        ...(overrides?.customHeaders ? { customHeaders: overrides.customHeaders } : {})
      }
      try {
        if (pendingResolverId && pendingVideoInfo) {
          const imgs = pendingVideoInfo.image_urls
          const galleryType = pendingVideoInfo._type
          const isGallery =
            (galleryType === 'douyin_gallery' || galleryType === 'xhs_gallery') && Boolean(imgs?.length)
          const imageMetaKey = galleryType === 'xhs_gallery' ? 'xhsImageUrls' : 'douyinImageUrls'
          const noteMeta = noteMetadataFromVideoInfo(pendingVideoInfo)
          await window.api.promoteInfoResolve({
            id: pendingResolverId,
            url: pendingVideoInfo.webpage_url || _url,
            title: pendingVideoInfo.title || 'Download',
            format,
            quality,
            thumbnail: pendingVideoInfo.thumbnail,
            duration: pendingVideoInfo.duration,
            ...taskFields,
            metadata: withIncludeNote(
              isGallery
                ? { [imageMetaKey]: imgs, channel: pendingVideoInfo.channel ?? '', ...noteMeta }
                : {
                    ...(pendingVideoInfo.channel ? { channel: pendingVideoInfo.channel } : {}),
                    ...(pendingVideoInfo.id ? { ytdlpId: pendingVideoInfo.id } : {}),
                    ...noteMeta
                  },
              includeNote
            )
          })
        } else if (pendingEntries && pendingEntries.length > 0) {
          const playlistTitle = pendingPlaylistMeta?.title ?? 'Playlist'
          const listUrl = pendingPlaylistMeta?.url ?? ''
          const useNativePlaylist =
            settings.youtubePlaylistMode === 'native' && listUrl && isPlaylistUrl(listUrl)
          if (useNativePlaylist) {
            await window.api.startDownload({
              url: listUrl,
              title: playlistTitle,
              format,
              quality,
              thumbnail: pendingEntries[0]?.thumbnail,
              duration: pendingEntries[0]?.duration ?? 0,
              playlistId: playlistTitle,
              ...taskFields,
              metadata: withIncludeNote({
                nativeYoutubePlaylist: true,
                channel: pendingEntries[0]?.channel ?? ''
              }, includeNote)
            })
          } else {
            for (let i = 0; i < pendingEntries.length; i++) {
              const entry = pendingEntries[i]
              await window.api.startDownload({
                url: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`,
                title: entry.title,
                format,
                quality,
                thumbnail: entry.thumbnail,
                duration: entry.duration,
                playlistId: playlistTitle,
                playlistIndex: i,
                playlistTitle,
                ...taskFields,
                metadata: entry.id ? { ytdlpId: entry.id } : undefined
              })
            }
          }
        } else {
          const title = pendingVideoInfo?.title ?? 'Unknown'
          const pageUrl = pendingVideoInfo?.webpage_url ?? _url
          const imgs = pendingVideoInfo?.image_urls
          const galleryType = pendingVideoInfo?._type
          const isGallery =
            (galleryType === 'douyin_gallery' || galleryType === 'xhs_gallery') && Boolean(imgs?.length)
          const imageMetaKey = galleryType === 'xhs_gallery' ? 'xhsImageUrls' : 'douyinImageUrls'
          const noteMeta = pendingVideoInfo ? noteMetadataFromVideoInfo(pendingVideoInfo) : {}
          await window.api.startDownload({
            url: pageUrl,
            title,
            format,
            quality,
            thumbnail: pendingVideoInfo?.thumbnail,
            duration: pendingVideoInfo?.duration,
            ...taskFields,
            metadata: withIncludeNote(
              isGallery
                ? { [imageMetaKey]: imgs, channel: pendingVideoInfo?.channel ?? '', ...noteMeta }
                : {
                    ...(pendingVideoInfo?.channel ? { channel: pendingVideoInfo.channel } : {}),
                    ...(pendingVideoInfo?.id ? { ytdlpId: pendingVideoInfo.id } : {}),
                    ...noteMeta
                  },
              includeNote
            )
          })
        }
      } finally {
        clearPending()
      }
    },
    [clearPending, pendingEntries, pendingPlaylistMeta, pendingResolverId, pendingVideoInfo, settings.youtubePlaylistMode]
  )

  return (
    <div className="flex h-screen min-h-0 flex-col bg-window text-foreground">
      <header
        className="flex h-[52px] shrink-0 items-center border-b border-border px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-[76px] shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13px] font-semibold">{COMPACT_WINDOW_TITLE.split(' ')[0]}</p>
          <p className="text-[11px] text-muted-foreground">{t('compact.mini')}</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div
          className={`flex shrink-0 flex-col rounded-panel border border-dashed px-3 py-3 ${
            dropActive ? 'border-border-strong bg-selection' : 'border-divider-subtle bg-surface'
          }`}
          onDragOver={(event) => {
            event.preventDefault()
            setDropActive(true)
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDropActive(false)
            const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
            void submitUrl(text)
          }}
        >
          <p className="text-[13px] font-semibold">{t('compact.dropTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('compact.dropHint')}</p>
          <label className="sr-only" htmlFor="compact-url-field">{t('compact.url')}</label>
          <input
            id="compact-url-field"
            value={urlField}
            onChange={(event) => setUrlField(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitUrl(urlField)
              }
            }}
            placeholder="https://"
            className="v-input mt-3"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={() => void onPasteUrl()}
            className="v-button-primary mt-2 w-full"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ClipboardPaste className="h-4 w-4" aria-hidden />{t(urlField.trim() ? 'ui.continue' : 'ui.pasteLink')}
          </button>
          {errorMsg ? <p className="mt-2 text-[11px] text-error">{errorMsg}</p> : null}
        </div>

        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('compact.nowDownloading')}</h2>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {active.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('compact.noActive')}</p>
            ) : (
              active.map((item) => (
                <div key={item.id} className="rounded-button bg-surface px-3 py-2">
                  <p className="truncate text-[13px] font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{compactProgressLine(item)}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-control">
                    <div className="h-full bg-progress" style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="grid shrink-0 grid-cols-2 gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            disabled={active.length === 0}
            onClick={() => void window.api?.pauseAll()}
            className="v-button-secondary"
          >
            {t('compact.pauseAll')}
          </button>
          <button
            type="button"
            onClick={() => void window.api?.showMainWindow?.()}
            className="v-button-secondary"
          >
            {t('compact.openFull')}
          </button>
        </div>
      </div>

      {showDouyinProfilePicker && douyinProfileUrl ? (
        <DouyinProfilePickerDialog
          profileUrl={douyinProfileUrl}
          settings={settings}
          onClose={closeDouyinProfilePicker}
          onQueued={({ notice, ids }) => applyBulkNotice(notice, ids?.[0])}
        />
      ) : null}
      {showCollectionPicker && collectionPickerUrl ? (
        <CollectionPickerDialog
          sourceUrl={collectionPickerUrl}
          settings={settings}
          onClose={closeCollectionPicker}
          onQueued={({ notice, ids }) => applyBulkNotice(notice, ids?.[0])}
        />
      ) : null}
      {showFormatDialog && pendingVideoInfo ? (
        <FormatDialog
          key={pendingResolverId || pendingVideoInfo.webpage_url || pendingVideoInfo.id}
          videoInfo={pendingVideoInfo}
          settings={settings}
          onClose={() => {
            setShowFormatDialog(false)
            clearPending()
          }}
          onDownload={handleDownload}
          queueCount={queueCount}
          onSkipAll={() => {
            clearQueue()
            setShowFormatDialog(false)
            clearPending()
          }}
        />
      ) : null}
    </div>
  )
}
