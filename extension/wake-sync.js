/**
 * Opens vdownload://wake in the same user-gesture turn as a click on the page (or in the
 * extension popup). Chrome then attributes the external protocol to that origin and can
 * offer "Always allow … to open links of this type", and it avoids a second wake from the
 * service worker (tabs.create) when the background passes surfacedWake: true.
 */
;(function () {
  'use strict'

  var WAKE = 'vdownload://wake'

  function wakeFromUserGesture() {
    try {
      var a = document.createElement('a')
      a.href = WAKE
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      var root = document.documentElement || document.body
      if (!root) return
      root.appendChild(a)
      a.click()
      root.removeChild(a)
    } catch (_) {}
  }

  globalThis.__vdownloadWakeFromUserGesture = wakeFromUserGesture
})()
