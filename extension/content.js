(function () {
  'use strict'

  const BUTTON_ID = 'ytdl-download-btn'
  const SVG_DOWNLOAD = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

  function createDownloadButton() {
    if (document.getElementById(BUTTON_ID)) return

    const btn = document.createElement('button')
    btn.id = BUTTON_ID
    btn.className = 'ytdl-btn'
    btn.title = 'Download with YT Download'
    btn.innerHTML = SVG_DOWNLOAD

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const url = window.location.href
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', url })
      showFeedback(btn)
    })

    return btn
  }

  function showFeedback(btn) {
    btn.classList.add('ytdl-btn-active')
    setTimeout(() => btn.classList.remove('ytdl-btn-active'), 800)
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return

    const btn = createDownloadButton()
    if (!btn) return

    const owner = document.querySelector('#owner')
    if (owner) {
      owner.appendChild(btn)
      return
    }

    const actions = document.querySelector('#actions #top-level-buttons-computed')
    if (actions) {
      actions.insertBefore(btn, actions.firstChild)
      return
    }

    const actionsContainer = document.querySelector('#actions')
    if (actionsContainer) {
      actionsContainer.insertBefore(btn, actionsContainer.firstChild)
    }
  }

  function watchForNavigation() {
    let lastUrl = ''

    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href
        if (isWatchPage()) {
          setTimeout(injectButton, 1000)
        }
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
  }

  function isWatchPage() {
    return window.location.pathname === '/watch'
  }

  const checkInterval = setInterval(() => {
    if (isWatchPage() && !document.getElementById(BUTTON_ID)) {
      injectButton()
    }
  }, 2000)

  if (isWatchPage()) {
    setTimeout(injectButton, 1500)
  }

  watchForNavigation()

  window.addEventListener('beforeunload', () => {
    clearInterval(checkInterval)
  })
})()
