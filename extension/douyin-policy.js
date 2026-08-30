/* Shared Douyin overlay + resolve-tab policy for isolated, MAIN, and SW. */
;(function (g) {
  'use strict'

  const BRIDGE_HELLO_TYPE = 'V_DOWNLOAD_BRIDGE_HELLO'

  function overlayDataHasPlayUrls(data) {
    return Boolean(
      data &&
      Array.isArray(data.formats) &&
      data.formats.some((row) => row && typeof row.url === 'string' && row.url)
    )
  }

  function itemMatchesAwemeId(item, targetId) {
    if (!item || targetId == null || targetId === '') return false
    const id = String(item.awemeId || item.aweme_id || item.id || '').trim()
    return id === String(targetId)
  }

  function shouldCacheOverlayItem(item, targetId) {
    return itemMatchesAwemeId(item, targetId)
  }

  function shouldLockOverlayExtract(data, currentVid) {
    if (!overlayDataHasPlayUrls(data)) return false
    if (currentVid && data.awemeId !== String(currentVid)) return false
    return true
  }

  function overlayExtractKey(href, vid) {
    return `${href || ''}|${vid || ''}`
  }

  function readyTabBindDecision(command, tabId) {
    if (!command || !Number.isInteger(tabId)) return { action: 'ignore' }
    if (Number.isInteger(command.targetTabId) && command.targetTabId !== tabId) {
      return { action: 'ignore' }
    }
    if (!Number.isInteger(command.targetTabId)) {
      return { action: 'bind', openedByResolver: false }
    }
    return { action: 'bind', openedByResolver: command.openedByResolver === true }
  }

  function createdTabBindDecision(command, createdTabId) {
    if (!command || !Number.isInteger(createdTabId)) return { action: 'discard' }
    if (Number.isInteger(command.targetTabId) && command.targetTabId !== createdTabId) {
      return { action: 'discard' }
    }
    return { action: 'bind', openedByResolver: true }
  }

  function existingTabIsEphemeral(tabId, pendingCommands) {
    if (!Number.isInteger(tabId)) return false
    return (pendingCommands || []).some((command) => (
      command && command.targetTabId === tabId && command.openedByResolver === true
    ))
  }

  function shouldCloseCreatedTab(command, occupyingOthers) {
    if (!command?.openedByResolver || !Number.isInteger(command.targetTabId)) return false
    return !(occupyingOthers || []).some((entry) => entry && entry.targetTabId === command.targetTabId)
  }

  function transferEphemeralFlag(finishing, occupants) {
    const list = Array.isArray(occupants) ? occupants : []
    if (!finishing?.openedByResolver || !Number.isInteger(finishing.targetTabId)) return list
    for (const entry of list) {
      if (entry && entry.targetTabId === finishing.targetTabId) entry.openedByResolver = true
    }
    return list
  }

  function acceptBridgeHello(storedNonce, incomingNonce) {
    const next = String(incomingNonce || '')
    if (storedNonce) return storedNonce
    return next
  }

  function isAuthorizedBridgeMessage(storedNonce, messageNonce) {
    return Boolean(storedNonce) && storedNonce === messageNonce
  }

  g.VDownloadDouyinPolicy = {
    BRIDGE_HELLO_TYPE,
    overlayDataHasPlayUrls,
    itemMatchesAwemeId,
    shouldCacheOverlayItem,
    shouldLockOverlayExtract,
    overlayExtractKey,
    readyTabBindDecision,
    createdTabBindDecision,
    existingTabIsEphemeral,
    shouldCloseCreatedTab,
    transferEphemeralFlag,
    acceptBridgeHello,
    isAuthorizedBridgeMessage
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
