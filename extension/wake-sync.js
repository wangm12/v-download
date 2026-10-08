/**
 * Opens vdownload://wake in the same user-gesture turn as a page click. Chrome attributes
 * the external protocol to that origin and can offer "Always allow … to open links of this
 * type". The background skips its own wake when the caller passes surfacedWake: true.
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
      return true
    } catch (_) { return false }
  }

  globalThis.__vdownloadWakeFromUserGesture = wakeFromUserGesture
})()
