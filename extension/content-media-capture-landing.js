;(function () {
  const requestId = new URL(location.href).searchParams.get('requestId') || ''
  const status = document.getElementById('status')
  if (!/^[a-f0-9]{48}$/.test(requestId)) { if (status) status.textContent = 'Invalid capture request.'; return }
  chrome.runtime.sendMessage({ type: 'REQUEST_MEDIA_CAPTURE', requestId }, (response) => {
    if (status) status.textContent = chrome.runtime.lastError || !response?.ok
      ? response?.error || 'Could not connect. Return to the task and start again.'
      : 'Source page opened. Play the media, then click the V-Download extension to choose a replacement. The original task keeps its plan and output folder.'
  })
})()
