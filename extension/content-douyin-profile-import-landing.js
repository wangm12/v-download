;(function () {
  'use strict'

  const status = document.getElementById('status')
  const requestId = new URL(location.href).searchParams.get('requestId') || ''
  const encodedCommand = document
    .querySelector('meta[name="vdownload-douyin-profile-import-command"]')
    ?.getAttribute('content') || ''

  function decodeCommand(value) {
    if (!value || value.length > 131072) return null
    try {
      const binary = atob(value)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const command = JSON.parse(new TextDecoder().decode(bytes))
      return command && typeof command === 'object' ? command : null
    } catch {
      return null
    }
  }

  if (!/^[a-f0-9]{20,80}$/i.test(requestId)) {
    if (status) status.textContent = 'Invalid V-Download profile import request.'
    return
  }

  const command = decodeCommand(encodedCommand)
  if (!command || command.requestId !== requestId) {
    if (status) status.textContent = 'This V-Download profile import request has expired. Return to the app and retry.'
    return
  }

  if (status) status.textContent = 'Connecting to your logged-in Douyin tab…'

  chrome.runtime.sendMessage({ type: 'REQUEST_DOUYIN_PROFILE_IMPORT', requestId, command }, (response) => {
    if (chrome.runtime.lastError) {
      if (status) status.textContent = 'Could not reach the V-Download extension.'
      return
    }
    if (!response?.ok) {
      if (status) status.textContent = response?.error || 'Could not start profile import.'
      return
    }
    if (status) status.textContent = 'Import started in your logged-in Douyin tab. This tab will close shortly.'
    setTimeout(() => window.close(), 700)
  })
})()
