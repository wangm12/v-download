import assert from 'node:assert/strict'
import {
  APP_LOCALES,
  catalogs,
  flattenCatalogKeys,
  normalizeUiLanguagePreference,
  resolveUiLanguage,
  translate
} from '../src/i18n/catalog'
import i18n, { changeAppLanguage } from '../src/renderer/src/i18n'

const REQUIRED_SAMPLE_KEYS = [
  'nav.library',
  'nav.downloads',
  'queue.title',
  'queue.pauseAll',
  'queue.completedCount',
  'queue.remainingCount',
  'queue.hideItems',
  'queue.showItems',
  'queue.moreVideos',
  'queue.removePlaylist',
  'queue.playlistType',
  'queue.profileType',
  'prefs.expert.job',
  'prefs.expert.startedLabel',
  'prefs.expert.endedLabel',
  'prefs.expert.jobState.running',
  'prefs.expert.jobState.completed',
  'prefs.expert.jobState.failed',
  'prefs.expert.jobState.cancelled',
  'playlist.deleteTitle',
  'playlist.removeListOnly',
  'bottomBar.status',
  'admit.alreadyDownloaded',
  'admit.chooseFormat',
  'admit.alreadyQueuedCount',
  'format.textNoteHint',
  'format.galleryCount',
  'format.source',
  'format.downloadAria',
  'format.bulkStarted',
  'prefs.saveFiles.errUnknownToken',
  'prefs.chromeCookie.loadUnpacked',
  'prefs.expert.started',
  'prefs.inAppLogin.accountConnected',
  'douyin.importSending',
  'douyin.loadingPage',
  'url.apiUnavailable',
  'url.noLinkInClipboard',
  'prefs.language.description',
  'language.system',
  'prefs.theme.description',
  'theme.system',
  'tray.show',
  'tray.pauseAll',
  'notify.completeTitle',
  'notify.errorTitle',
  'quit.message',
  'menu.preferences',
  'menu.quit'
] as const

async function main(): Promise<void> {
  const [enKeys, cnKeys, twKeys] = APP_LOCALES.map((locale) => {
    const keys = flattenCatalogKeys(catalogs[locale])
    return { locale, keys, set: new Set(keys) }
  })

  assert.ok(enKeys.keys.length > 20, 'catalog must cover primary chrome, not only nav')
  assert.deepEqual(cnKeys.keys, enKeys.keys, 'zh-CN keys must match en')
  assert.deepEqual(twKeys.keys, enKeys.keys, 'zh-TW keys must match en')

  for (const key of REQUIRED_SAMPLE_KEYS) {
    for (const { locale, set } of [enKeys, cnKeys, twKeys]) {
      assert.ok(set.has(key), `missing ${key} in ${locale}`)
      const value = translate(locale, key)
      assert.notEqual(value, key, `${locale} ${key} must be translated`)
      assert.ok(value.trim().length > 0, `${locale} ${key} must not be empty`)
    }
  }

  assert.ok(!enKeys.set.has('nav.sniff'), 'nav.sniff must stay absent')
  assert.equal(i18n.t('nav.sniff'), 'nav.sniff')

  assert.equal(translate('en', 'nav.library'), 'Library')
  assert.equal(translate('zh-CN', 'nav.library'), '媒体库')
  assert.equal(translate('zh-TW', 'nav.library'), '媒體庫')

  assert.match(translate('en', 'prefs.language.description'), /app|interface|menu|notification/i)
  assert.doesNotMatch(translate('en', 'prefs.language.description'), /navigation only|main navigation/i)
  assert.equal(translate('en', 'language.system'), 'System')
  assert.equal(translate('zh-CN', 'language.system'), '系统')
  assert.equal(translate('zh-TW', 'language.system'), '系統')
  assert.equal(translate('en', 'theme.system'), 'System')
  assert.match(translate('en', 'prefs.theme.description'), /light|dark|system|device|appearance/i)

  assert.equal(normalizeUiLanguagePreference('system'), 'system')
  assert.equal(normalizeUiLanguagePreference('zh-TW'), 'zh-TW')
  assert.equal(normalizeUiLanguagePreference('nope'), 'en')
  assert.equal(resolveUiLanguage('system', 'zh-TW'), 'zh-TW')
  assert.equal(resolveUiLanguage('system', 'zh-CN'), 'zh-CN')
  assert.equal(resolveUiLanguage('system', 'en-US'), 'en')
  assert.equal(resolveUiLanguage('en', 'zh-HK'), 'en')
  assert.equal(resolveUiLanguage('zh-CN', 'en-GB'), 'zh-CN')

  assert.equal(i18n.t('nav.downloads'), 'Downloads')
  assert.equal(i18n.t('nav.library'), 'Library')
  await changeAppLanguage('zh-CN')
  assert.equal(i18n.t('nav.downloads'), '下载')
  assert.equal(i18n.t('nav.library'), '媒体库')
  assert.equal(i18n.t('queue.title'), translate('zh-CN', 'queue.title'))
  await changeAppLanguage('zh-TW')
  assert.equal(i18n.t('nav.downloads'), '下載')
  assert.equal(i18n.t('nav.library'), '媒體庫')
  await changeAppLanguage('en')
  assert.equal(i18n.t('nav.downloads'), 'Downloads')
  await changeAppLanguage('system')
  assert.ok(['en', 'zh-CN', 'zh-TW'].includes(i18n.language), 'System language must resolve to a catalog locale')
  await changeAppLanguage('en')
  assert.equal(i18n.t('nav.downloads'), 'Downloads')
  assert.equal(i18n.t('tray.show'), 'Show')
  assert.equal(i18n.t('notify.completeTitle'), 'Download complete')

  assert.equal(translate('en', 'bottomBar.status', { downloads: 3, complete: 1 }), '3 Downloads · 1 Complete')
  assert.equal(translate('en', 'admit.alreadyDownloaded'), 'Already downloaded.')
  assert.equal(translate('en', 'queue.moreVideos', { count: 4 }), '... and 4 more videos')
  assert.equal(translate('en', 'format.downloadAria', { quality: '1080p', container: 'MP4' }), 'Download 1080p MP4')
  assert.equal(translate('zh-CN', 'admit.alreadyDownloaded'), '已经下载过了。')
  assert.equal(translate('zh-TW', 'admit.alreadyDownloaded'), '已經下載過了。')
  assert.equal(translate('en', 'queue.playlistType'), 'Playlist')
  assert.equal(translate('zh-CN', 'queue.playlistType'), '播放列表')
  assert.equal(translate('zh-TW', 'queue.playlistType'), '播放清單')
  assert.equal(translate('en', 'prefs.expert.job'), 'Job')
  assert.equal(translate('en', 'prefs.expert.startedLabel'), 'Started:')
  assert.equal(translate('en', 'prefs.expert.endedLabel'), 'Ended:')
  assert.equal(translate('en', 'prefs.expert.jobState.running'), 'Running')
  assert.equal(translate('en', 'prefs.expert.jobState.completed'), 'Completed')
  assert.equal(translate('en', 'prefs.expert.jobState.failed'), 'Failed')
  assert.equal(translate('en', 'prefs.expert.jobState.cancelled'), 'Cancelled')
  assert.equal(translate('zh-CN', 'prefs.expert.job'), '任务')
  assert.equal(translate('zh-CN', 'prefs.expert.startedLabel'), '开始：')
  assert.equal(translate('zh-CN', 'prefs.expert.endedLabel'), '结束：')
  assert.equal(translate('zh-CN', 'prefs.expert.jobState.running'), '进行中')
  assert.equal(translate('zh-TW', 'prefs.expert.job'), '任務')
  assert.equal(translate('zh-TW', 'prefs.expert.startedLabel'), '開始：')
  assert.equal(translate('zh-TW', 'prefs.expert.endedLabel'), '結束：')
  assert.equal(translate('zh-TW', 'prefs.expert.jobState.running'), '進行中')

  console.log(`i18n tests passed (${enKeys.keys.length} keys × ${APP_LOCALES.length} locales)`)
}

void main()
