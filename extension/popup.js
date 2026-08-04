document.addEventListener('DOMContentLoaded', () => {
  showLastDownloadError()
  chrome.runtime.sendMessage({ type: 'GET_MEDIA' }, (response) => {
    const { media = [], tabUrl = '', tabTitle = '' } = response || {}
    renderMedia(media, tabUrl, tabTitle)
  })
})

const ERROR_TTL_MS = 10 * 60 * 1000

function isFreshError(err) {
  if (!err || typeof err.message !== 'string') return false
  const ts = Number(err.t || 0)
  return Number.isFinite(ts) && Date.now() - ts < ERROR_TTL_MS
}

function clearStoredLastDownloadError(done) {
  chrome.runtime.sendMessage({ type: 'CLEAR_LAST_DOWNLOAD_ERROR' }, () => {
    if (chrome.runtime.lastError) {
      chrome.storage.local.remove('lastDownloadError', done)
      return
    }
    if (typeof done === 'function') done()
  })
}

function showLastDownloadError() {
  const container = document.getElementById('last-error')
  const messageEl = document.getElementById('last-error-message')
  const dismissBtn = document.getElementById('dismiss-last-error')
  if (!container || !messageEl || !dismissBtn) return

  const hideError = () => {
    messageEl.textContent = ''
    container.style.display = 'none'
  }

  if (!dismissBtn.dataset.bound) {
    dismissBtn.dataset.bound = '1'
    dismissBtn.addEventListener('click', () => {
      clearStoredLastDownloadError(hideError)
    })
  }

  chrome.storage.local.get(['lastDownloadError'], (data) => {
    const err = data && data.lastDownloadError
    if (isFreshError(err)) {
      messageEl.textContent = err.message
      container.style.display = 'flex'
    } else {
      hideError()
      if (err) {
        clearStoredLastDownloadError()
      }
    }
  })
}

function renderMedia(media, tabUrl, tabTitle) {
  media = globalThis.VDownloadMediaPatterns.mergeCandidates(media)
  const list = document.getElementById('list')
  const empty = document.getElementById('empty')
  const footer = document.getElementById('footer')
  const count = document.getElementById('count')
  const headerTitle = document.getElementById('header-title')
  const selectionBar = document.getElementById('selection-bar')
  const selectedCount = document.getElementById('selected-count')
  const selectAllBtn = document.getElementById('select-all-btn')
  const deselectAllBtn = document.getElementById('deselect-all-btn')
  const downloadBtn = document.getElementById('download-btn')
  let pendingRetryItems = []
  let inFlight = false

  if (!list || !empty || !footer || !count || !selectionBar || !selectedCount || !selectAllBtn || !deselectAllBtn || !downloadBtn) return

  while (list.firstChild) {
    list.removeChild(list.firstChild)
  }

  if (headerTitle && tabTitle) {
    headerTitle.textContent = tabTitle
    headerTitle.title = tabTitle
  }

  if (media.length === 0) {
    empty.style.display = 'flex'
    footer.style.display = 'none'
    selectionBar.style.display = 'none'
    count.textContent = ''
    return
  }

  empty.style.display = 'none'
  footer.style.display = 'flex'
  selectionBar.style.display = 'flex'
  count.textContent = media.length

  media.forEach((item, index) => {
    const row = document.createElement('div')
    row.className = 'media-item'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    checkbox.id = `media-${index}`
    checkbox.dataset.index = index

    const info = document.createElement('label')
    info.htmlFor = `media-${index}`
    info.className = 'media-info'

    const name = document.createElement('div')
    name.className = 'media-name'
    name.textContent = getDisplayName(item.url)
    name.title = name.textContent

    const meta = document.createElement('div')
    meta.className = 'media-meta'

    const domain = document.createElement('span')
    domain.className = 'media-domain'
    try {
      domain.textContent = new URL(item.url).hostname
    } catch {
      domain.textContent = ''
    }

    const typeBadge = document.createElement('span')
    typeBadge.className = `media-type type-${item.type}`
    typeBadge.textContent = item.type.toUpperCase()

    const size = document.createElement('span')
    size.className = 'media-size'
    size.textContent = item.size ? formatSize(item.size) : 'Unknown size'

    const confidence = document.createElement('span')
    confidence.textContent = item.confidence ? `${item.confidence}% confidence` : 'Detected'

    meta.appendChild(domain)
    meta.appendChild(typeBadge)
    meta.appendChild(size)
    meta.appendChild(confidence)
    info.appendChild(name)
    info.appendChild(meta)

    const singleDownloadBtn = document.createElement('button')
    singleDownloadBtn.type = 'button'
    singleDownloadBtn.className = 'media-download-one'
    singleDownloadBtn.textContent = 'Download'

    singleDownloadBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      triggerDownload([item])
    })

    row.appendChild(checkbox)
    row.appendChild(info)
    row.appendChild(singleDownloadBtn)
    list.appendChild(row)
  })

  const triggerDownload = async (items) => {
    if (!Array.isArray(items) || items.length === 0) return
    if (inFlight) return

    const status = document.getElementById('send-status')
    if (status) status.textContent = `Sending ${items.length} item${items.length === 1 ? '' : 's'}…`
    downloadBtn.textContent = 'Sending…'
    inFlight = true
    downloadBtn.disabled = true

    // Give immediate visible feedback before any async work or popup-closing
    // side effect. The anchor must still run in this click's user gesture.
    const wakeFromGesture = globalThis.__vdownloadWakeFromUserGesture
    const surfacedWake = typeof wakeFromGesture === 'function' ? wakeFromGesture() === true : false

    chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_MEDIA',
        items,
        tabUrl,
        tabTitle,
        surfacedWake
      },
      (response) => {
        const results = Array.isArray(response?.results) ? response.results : []
        const validResults = results.length === items.length
        const failed = validResults ? results.map((result, index) => (!result?.ok ? index + 1 : null)).filter(Boolean) : items.map((_, index) => index + 1)
        const succeeded = results.filter((result) => result?.ok).length
        if (chrome.runtime.lastError || !response || !response.ok || !validResults || failed.length) {
          const detail = results.length ? ` ${succeeded} succeeded, ${failed.length} failed (items ${failed.join(', ')}).` : ''
          const categories = [...new Set(results.filter((result) => !result?.ok).map((result) => result?.category).filter(Boolean))]
          const categoryLabels = { 'app-unavailable': 'app unavailable', 'invalid-media-candidate': 'invalid media candidate', 'authorization-required': 'authorization required', 'network-retryable': 'network retryable', 'app-rejected': 'app rejected' }
          const categoryText = categories.length ? ` ${categories.map((category) => categoryLabels[category] || 'download error').join(', ')}.` : ''
          const msg = (response?.error || 'The app did not accept every item.') + categoryText + detail + ' Retry the selected items.'
          if (status) status.textContent = msg
          downloadBtn.disabled = false
          inFlight = false
          downloadBtn.textContent = 'Retry selected'
          pendingRetryItems = failed.map((index) => items[index - 1]).filter(Boolean)
          return
        }
        pendingRetryItems = []
        inFlight = false
        if (status) status.textContent = `Sent ${succeeded || items.length}/${items.length}; all items accepted.`
        setTimeout(() => window.close(), 500)
      }
    )
  }

  const updateSelectionUi = () => {
    pendingRetryItems = []
    const rows = list.querySelectorAll('.media-item')
    rows.forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]')
      row.dataset.selected = String(checkbox?.checked === true)
    })
    const selected = list.querySelectorAll('input[type="checkbox"]:checked').length
    selectedCount.textContent = `${selected}/${media.length} selected`
    downloadBtn.disabled = selected === 0
    downloadBtn.textContent = selected > 0 ? `Download Selected (${selected})` : 'Download Selected'
  }

  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', updateSelectionUi)
  })

  selectAllBtn.onclick = () => {
    list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = true
    })
    updateSelectionUi()
  }

  deselectAllBtn.onclick = () => {
    list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false
    })
    updateSelectionUi()
  }

  updateSelectionUi()

  downloadBtn.onclick = () => {
    const checkboxes = list.querySelectorAll('input[type="checkbox"]:checked')
    const selected = pendingRetryItems.length ? pendingRetryItems : Array.from(checkboxes).map((cb) => media[cb.dataset.index])

    if (selected.length === 0) return
    triggerDownload(selected)
  }
}

function getDisplayName(url) {
  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').pop()
    if (filename && filename.length > 0 && filename !== '/') {
      const decoded = decodeURIComponent(filename)
      return decoded.length > 60 ? decoded.substring(0, 57) + '...' : decoded
    }
  } catch {}
  return url.length > 60 ? url.substring(0, 57) + '...' : url
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}
