;(function () {
  'use strict'

  const status = document.getElementById('status')
  const params = new URL(location.href).searchParams
  const requestId = params.get('requestId') || ''

  function decodeCommand(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 16_384) return null
    try {
      const padding = '='.repeat((4 - (value.length % 4)) % 4)
      const raw = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding))
      const command = {
        requestId: String(raw?.requestId || '').trim(),
        url: String(raw?.url || '').trim(),
        awemeId: String(raw?.awemeId || '').trim(),
      }
      if (command.requestId !== requestId || !/^\d{10,32}$/.test(command.awemeId)) return null
      const page = new URL(command.url)
      if (!/^https?:$/.test(page.protocol) || !/(?:^|\.)douyin\.com$|(?:^|\.)iesdouyin\.com$/i.test(page.hostname)) return null
      return command
    } catch {
      return null
    }
  }

  function setStatus(message) {
    if (status) status.textContent = message
  }

  function closeSelfSoon(delay = 150) {
    setTimeout(() => {
      try {
        chrome.tabs.getCurrent((tab) => {
          if (tab?.id !== undefined) {
            chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError)
            return
          }
          window.close()
        })
      } catch {
        try { window.close() } catch {}
      }
    }, delay)
  }

  if (!/^[a-f0-9]{20,80}$/i.test(requestId)) {
    setStatus('Invalid V-Download Douyin request.')
    closeSelfSoon()
    return
  }
  const command = decodeCommand(params.get('command') || '')
  if (!command) {
    setStatus('Invalid V-Download Douyin command.')
    closeSelfSoon()
    return
  }

  // The desktop app waits for a signed acknowledgement from the service worker.
  // This internal page is only a short-lived wake-up surface; it never loads
  // media and is launched as a background tab.
  try {
    chrome.runtime.sendMessage({ type: 'REQUEST_DOUYIN_RESOLVE', requestId, command }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('The V-Download extension needs to be reloaded.')
        closeSelfSoon(500)
        return
      }
      if (!response?.ok) {
        setStatus(response?.error || 'Could not start the Douyin resolver.')
        closeSelfSoon(500)
        return
      }
      setStatus('Resolver started in a muted background Douyin tab.')
      closeSelfSoon()
    })
  } catch {
    setStatus('The V-Download extension needs to be reloaded.')
    closeSelfSoon(500)
  }
})()
