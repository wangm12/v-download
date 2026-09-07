import { useState, useEffect, useCallback } from 'react'
import { syncLanguageFromSettings } from '@/i18n'
import type { SettingsData } from '@/types'

const DEFAULT_SETTINGS: SettingsData = {
  downloadDir: '',
  concurrency: 3,
  showFormatDialog: true,
  playlistSubfolder: true,
  filenameTemplate: '{title} [{id}]',
  folderNameTemplate: '{author}',
  archiveByAuthor: false,
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
  ytdlpExternalDownloader: '',
  siteRules: [],
  proxyUrl: '',
  launchAtStartup: false,
  notifyOnComplete: true,
  notifyOnError: true,
  warnBeforeQuit: true,
  showTray: true,
  onboardingCompleted: false,
  remoteApiEnabled: false,
  remoteApiToken: '',
  remoteApiBind: '127.0.0.1',
  remoteApiPort: 18766,
  remoteApiMcpAllowWrite: false,
  remoteApiMcpRequireConfirm: true,
  uiLanguage: 'en'
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)

  const loadSettings = useCallback(() => {
    if (typeof window === 'undefined' || !window.api) return
    window.api.getSettings().then((res) => {
      const data = ((res as { data?: SettingsData }).data ?? res) as SettingsData
      if (data) {
        setSettings((prev) => ({ ...prev, ...data }))
        if (data.uiLanguage) syncLanguageFromSettings(data.uiLanguage)
      }
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
