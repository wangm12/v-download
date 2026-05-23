;(function () {
  const status = document.getElementById('status')
  if (status) status.textContent = 'Syncing cookies…'

  chrome.runtime.sendMessage({ type: 'FORCE_COOKIE_SYNC' }, (response) => {
    const el = document.getElementById('status')
    if (chrome.runtime.lastError) {
      if (el) {
        el.textContent =
          'Could not reach the V-Download extension. Open this page in Chrome with the extension installed.'
      }
      return
    }
    if (el) {
      if (response && response.ok) {
        el.textContent = 'Saved — this tab should close in a moment.'
      } else {
        el.textContent =
          `Sync did not complete: ${response && response.error ? response.error : 'unknown error'}`
      }
    }
  })
})()
