import { useState, useEffect, useCallback } from 'react'
import type { SettingsData } from '@/types'

const DEFAULT_SETTINGS: SettingsData = {
  downloadDir: '',
  concurrency: 3,
  showFormatDialog: true,
  playlistSubfolder: true,
  defaultVideoQuality: '1080',
  defaultAudioQuality: '320',
  sleepInterval: 3,
  cookiesFromBrowser: 'chrome',
  douyinUseCloakBrowser: false,
  youtubePlaylistMode: 'native',
  youtubePlaylistSleepRequests: 0,
  youtubePlaylistMaxDownloads: 0,
  douyinBulkRunPyPath: '',
  douyinBulkConfigPath: '',
  douyinBulkOutputPath: '',
  douyinBulkThreads: 5,
  douyinBulkVerboseWarnings: false,
  ytdlpPath: '',
  ffmpegPath: '',
  directMediaEngine: 'auto',
  concurrentFragments: 5,
  downloadSpeedMode: 'balanced',
  turboRiskAcknowledged: false,
  ytdlpExternalDownloader: ''
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)

  const loadSettings = useCallback(() => {
    if (typeof window === 'undefined' || !window.api) return
    window.api.getSettings().then((res) => {
      const data = (res as { data?: SettingsData })?.data ?? res
      if (data) setSettings((prev) => ({ ...prev, ...data }))
    })
  }, [])

  useEffect(() => {
    loadSettings()
    if (!window.api?.onSettingsChanged) return
    const unsub = window.api.onSettingsChanged(() => loadSettings())
    return unsub
  }, [loadSettings])

  return { settings, loadSettings }
}
