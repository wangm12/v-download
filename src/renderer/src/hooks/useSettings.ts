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
  ytdlpPath: '',
  ffmpegPath: ''
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
