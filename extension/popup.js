document.addEventListener('DOMContentLoaded', () => {
  showLastDownloadError()
  initializeDownloadPlans()
  chrome.runtime.sendMessage({ type: 'GET_MEDIA' }, (response) => {
    const { media = [], tabUrl = '', tabTitle = '' } = response || {}
    renderMedia(media, tabUrl, tabTitle, response?.capture || null)
    if (chrome.runtime.lastError || response?.error) {
      const empty = document.getElementById('empty')
      const message = empty?.querySelector('p')
      const hint = empty?.querySelector('.hint')
      if (message) message.textContent = response?.error || 'Could not read media from this tab. Reopen the popup to retry.'
      if (hint) hint.style.display = 'none'
    }
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

function renderMedia(media, tabUrl, tabTitle, capture = null) {
  const patterns = globalThis.VDownloadMediaPatterns
  media = patterns.mergeCandidates(media)
  if (typeof patterns.classifyMediaRole === 'function') {
    try {
      media = patterns.classifyMediaRole(media, { pageTitle: tabTitle, pageUrl: tabUrl })
    } catch {
      /* keep unlabeled candidates if identity classification fails */
    }
  }
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
  const captureSection = document.getElementById('capture-session')
  const confirmation = document.getElementById('capture-confirm')
  if (captureSection) captureSection.hidden = !capture
  const planSelector = document.querySelector('.plan-selector')
  if (planSelector) planSelector.hidden = Boolean(capture)
  if (capture) {
    document.getElementById('capture-title').textContent = `Continue: ${capture.title}`
    document.getElementById('capture-description').textContent = `Keep the original ${capture.planName || 'download settings'} and output folder. Select ONE resource.${capture.exactSource ? ' The original task locks an exact format; an incompatible replacement will be rejected.' : ''}${capture.pageUrl !== tabUrl ? ' Return to the original source page before submitting.' : ''}`
    document.getElementById('capture-stop').onclick = () => chrome.runtime.sendMessage({ type: 'CANCEL_MEDIA_CAPTURE' }, (response) => {
      if (response?.ok) location.reload()
      else document.getElementById('send-status').textContent = response?.error || 'Could not leave capture mode.'
    })
  }

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
    checkbox.checked = !capture && item.role === 'main'
    checkbox.id = `media-${index}`
    checkbox.dataset.index = index

    const info = document.createElement('div')
    info.className = 'media-info'

    const name = document.createElement('label')
    name.htmlFor = checkbox.id
    name.className = 'media-name'
    name.textContent = item.displayTitle || getDisplayName(item.url)
    name.title = item.url

    const meta = document.createElement('div')
    meta.className = 'media-meta'

    const roleBadge = document.createElement('span')
    roleBadge.className = `media-role role-${item.role || 'unknown'}`
    roleBadge.textContent = typeof patterns.roleLabel === 'function' ? patterns.roleLabel(item.role) : (item.role || 'Detected')

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
    confidence.textContent = item.confidence ? `Match score ${item.confidence}/100` : 'Detected'

    meta.appendChild(roleBadge)
    meta.appendChild(domain)
    meta.appendChild(typeBadge)
    meta.appendChild(size)
    meta.appendChild(confidence)
    info.appendChild(name)
    info.appendChild(meta)
    appendMediaDetails(info, item, tabUrl)

    const singleDownloadBtn = document.createElement('button')
    singleDownloadBtn.type = 'button'
    singleDownloadBtn.className = 'media-download-one'
    singleDownloadBtn.textContent = capture ? 'Use source' : 'Download'

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
    if (capture && (items.length !== 1 || !confirmation?.checked || capture.pageUrl !== tabUrl)) {
      document.getElementById('send-status').textContent = 'Select one resource on the original page and confirm it is the same media.'
      return
    }

    const status = document.getElementById('send-status')
    if (status) status.textContent = `Sending ${items.length} item${items.length === 1 ? '' : 's'}…`
    downloadBtn.textContent = 'Sending…'
    inFlight = true
    downloadBtn.disabled = true

    chrome.runtime.sendMessage(
      capture ? { type: 'RECAPTURE_MEDIA', item: items[0], requestId: capture.requestId, confirmed: true } : {
        type: 'DOWNLOAD_MEDIA',
        items,
        tabUrl,
        tabTitle,
        // Let the service worker try the local app first. It can launch the
        // protocol wake only after the request fails, without closing this popup.
        surfacedWake: false
      },
      (response) => {
        if (capture) {
          inFlight = false
          downloadBtn.disabled = false
          if (chrome.runtime.lastError || !response?.ok) {
            if (status) status.textContent = response?.error || 'Could not continue the original task. Reopen the popup to retry.'
            downloadBtn.textContent = 'Retry replacement'
          } else {
            if (status) status.textContent = 'Original task restarted. Its plan and output folder were kept.'
            downloadBtn.disabled = true
            setTimeout(() => window.close(), 1000)
          }
          return
        }
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
    downloadBtn.disabled = capture ? selected !== 1 || !confirmation?.checked || capture.pageUrl !== tabUrl : selected === 0
    downloadBtn.textContent = capture ? 'Replace source & continue task' : selected > 0 ? `Download Selected (${selected})` : 'Download Selected'
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
  if (confirmation) confirmation.onchange = updateSelectionUi

  downloadBtn.onclick = () => {
    const checkboxes = list.querySelectorAll('input[type="checkbox"]:checked')
    const selected = pendingRetryItems.length ? pendingRetryItems : Array.from(checkboxes).map((cb) => media[cb.dataset.index])

    if (selected.length === 0) return
    triggerDownload(selected)
  }
}

function appendMediaDetails(container, item, tabUrl) {
  const details = document.createElement('details')
  details.className = 'candidate-details'
  details.addEventListener('click', (event) => event.stopPropagation())
  const summary = document.createElement('summary')
  summary.textContent = 'Details / Inspect'
  details.appendChild(summary)
  const paragraph = (value) => { const p = document.createElement('p'); p.textContent = value; return p }
  details.appendChild(paragraph(`Detected via ${item.source || 'browser observation'}${item.mime || item.mimeType ? ` · ${item.mime || item.mimeType}` : ''}. Match score is a heuristic, not verified quality.`))
  details.appendChild(paragraph(`Page: ${item.sourceContext?.pageUrl || tabUrl || 'Unknown'}`))
  details.appendChild(paragraph(`Request document: ${item.sourceContext?.documentUrl || 'Unknown'}`))
  details.appendChild(paragraph(`Media: ${item.url}`))
  const probe = document.createElement('button')
  probe.type = 'button'
  probe.textContent = 'Inspect media'
  const output = document.createElement('div')
  output.setAttribute('role', 'status')
  probe.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation()
    probe.disabled = true; probe.textContent = 'Inspecting…'
    output.replaceChildren(paragraph('Reading media information. No download task is created.'))
    chrome.runtime.sendMessage({ type: 'INSPECT_MEDIA', item }, (response) => {
      if (!details.isConnected) return
      probe.disabled = false; probe.textContent = 'Inspect again'
      if (chrome.runtime.lastError || !response?.ok || !response.data) {
        output.replaceChildren(paragraph(response?.error || 'Reload the V-Download extension and update or open the app, then try again.'))
        return
      }
      const data = response.data
      const rows = [paragraph(`Inspected now: ${data.kind} · Duration: ${data.duration ? data.duration.toFixed(1) + 's' : 'unknown'}`)]
      for (const stream of data.streams || []) rows.push(paragraph(`${stream.kind}: ${stream.codec || 'codec unknown'}${stream.kind === 'video' ? ` · ${stream.height ? `${stream.width || '?'}×${stream.height}` : 'resolution unknown'} · ${stream.fps ? stream.fps.toFixed(2) + ' fps' : 'fps unknown'}` : ''}${stream.language ? ` · ${stream.language}` : ''}`))
      if (!data.streams?.length) rows.push(paragraph('Tracks / resolution / codecs: unknown'))
      if (data.resources?.length) {
        rows.push(paragraph('Relationships read from this manifest:'))
        for (const resource of data.resources) rows.push(paragraph(`${resource.relation}${resource.height ? ` · ${resource.height}p` : ''}${resource.fps ? ` · ${resource.fps} fps` : ''}${resource.codecs ? ` · ${resource.codecs}` : ''}${resource.language ? ` · ${resource.language}` : ''}: ${resource.url}`))
      } else rows.push(paragraph('No linked resource relationship established. Other candidates remain independent.'))
      for (const warning of data.warnings || []) rows.push(paragraph(warning))
      rows.push(paragraph('Point-in-time result. Browser login does not prove engine access. The download plan still controls final quality.'))
      output.replaceChildren(...rows)
    })
  })
  details.appendChild(probe)
  details.appendChild(output)
  container.appendChild(details)
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

function initializeDownloadPlans() {
  const select = document.getElementById('download-plan')
  const status = document.getElementById('plan-status')
  const refresh = (acceptLatestRevision = false) => chrome.runtime.sendMessage({ type: 'GET_DOWNLOAD_PLANS' }, (result) => {
    if (!result?.ok) { status.textContent = result?.error || 'Open V-Download to load plans.'; return }
    chrome.storage.local.get(['downloadPlanId'], (stored) => {
      select.replaceChildren(new Option('Follow app default', ''))
      for (const plan of result.plans || []) {
        const option = new Option(plan.name + (result.defaultId === plan.id ? ' · App default' : ''), plan.id)
        option.dataset.revision = String(plan.revision)
        select.add(option)
      }
      if (stored.downloadPlanId && ![...select.options].some((option) => option.value === stored.downloadPlanId)) {
        select.add(new Option('Saved plan unavailable — choose another', stored.downloadPlanId))
        status.textContent = 'This saved plan was removed. Select another plan before downloading.'
      } else status.textContent = ''
      select.value = stored.downloadPlanId || ''
      if (acceptLatestRevision && select.selectedOptions[0]?.dataset.revision) chrome.storage.local.set({ downloadPlanRevision: Number(select.selectedOptions[0].dataset.revision) })
    })
  })
  select.addEventListener('change', () => {
    const option = select.selectedOptions[0]
    chrome.storage.local.set({ downloadPlanId: select.value, downloadPlanRevision: Number(option?.dataset.revision) || null })
    status.textContent = ''
  })
  document.getElementById('refresh-plans').addEventListener('click', () => refresh(true))
  refresh()
}
