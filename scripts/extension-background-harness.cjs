// Browser API boundary for production worker tests; network can be real or injected.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
exports.backgroundHarness = function ({ fetch, storage = {}, extensionId = 'test-extension', tabs = [{ id: 1, url: 'https://fixture.test/', title: 'Fixture' }], getFrame = async () => null, directory = path.resolve(__dirname, '../extension') }) {
  let listener
  const wakes = []
  const event = () => { const handlers = []; return { addListener(fn) { handlers.push(fn) }, async emit(...args) { for (const fn of handlers) await fn(...args); await new Promise(setImmediate) } } }
  const area = {
    get(keys, callback) { const data = Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(storage)).filter(k => k in storage).map(k => [k, storage[k]])); if (callback) callback(data); return Promise.resolve(data) },
    set(values, callback) { Object.assign(storage, values); callback?.(); return Promise.resolve() },
    remove(keys, callback) { for (const key of [keys].flat()) delete storage[key]; callback?.(); return Promise.resolve() }
  }
  const chrome = {
    storage: { local: area, session: area },
    runtime: { id: extensionId, lastError: null, onMessage: { addListener(fn) { listener = fn } }, onInstalled: event(), onStartup: event(), getURL: file => `chrome-extension://${extensionId}/${file}` },
    action: { onClicked: event(), setBadgeText() {}, setBadgeBackgroundColor() {}, setIcon() {}, setTitle() {} },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), query(options, callback) { callback?.(tabs); return Promise.resolve(tabs) }, create(options, callback) { wakes.push(options); callback?.({ id: 2 }); return Promise.resolve({ id: 2 }) }, remove(id, callback) { callback?.() }, sendMessage() {} },
    webRequest: { onCompleted: event(), onBeforeRequest: event(), onErrorOccurred: event() },
    webNavigation: { onCommitted: event(), onHistoryStateUpdated: event(), getFrame },
    alarms: { create() {}, onAlarm: event() }, cookies: { getAll: async () => [] }, scripting: { executeScript: async () => [] }
  }
  const context = vm.createContext({ chrome, console: { log() {}, warn() {}, error() {}, info() {} }, fetch, Response, Headers, Request, AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout })
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context, { filename: file }))
  vm.runInContext(fs.readFileSync(path.join(directory, 'background.js'), 'utf8'), context, { filename: 'background.js' })
  return { storage, wakes, events: { completed: chrome.webRequest.onCompleted, beforeRequest: chrome.webRequest.onBeforeRequest, tabUpdated: chrome.tabs.onUpdated, frameCommitted: chrome.webNavigation.onCommitted, frameHistory: chrome.webNavigation.onHistoryStateUpdated }, message(message, sender = {}) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Worker response timeout')), 15000); const keep = listener(message, sender, result => { clearTimeout(timer); resolve(result) }); if (!keep) { clearTimeout(timer); } }) } }
}
