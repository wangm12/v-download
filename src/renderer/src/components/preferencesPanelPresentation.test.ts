// @ts-nocheck
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  GENERAL_SECTION_CLASS,
  LANGUAGE_PREFERENCE_VALUES,
  PREFERENCES_SECTION_TITLES,
  PREFERENCES_WORKSPACE_CLASS,
  THEME_PREFERENCE_VALUES,
  canPersistSiteRule,
  hasSingleColumnPolicy,
  languageSelectValue,
  outputTemplateError,
  previewOutputPath,
  themeSelectValue
} from './preferencesPanelPresentation'

const componentSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/PreferencesPanel.tsx'),
  'utf8'
)

const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

expect(hasSingleColumnPolicy(PREFERENCES_WORKSPACE_CLASS), 'workspace must provide desktop and single-column policies')
expect(GENERAL_SECTION_CLASS.includes('w-full'), 'General must use the single-column workspace')
expect(componentSource.includes('className={PREFERENCES_WORKSPACE_CLASS}'), 'General must use the workspace class')
expect(componentSource.includes('className={GENERAL_SECTION_CLASS}'), 'General must use the full-width class')
expect(PREFERENCES_SECTION_TITLES.includes('Language'), 'Language section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Theme'), 'Theme section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Download behavior'), 'Download behavior section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Startup and notifications'), 'Startup and notifications section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Per-site rules'), 'Sites section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Queue behavior'), 'Queue behavior disclosure is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Network / engine'), 'Network / engine disclosure is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Playlists'), 'Playlists disclosure is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Chrome cookie sync'), 'Chrome cookie sync card is missing')
expect(PREFERENCES_SECTION_TITLES.includes('In-app account login'), 'In-app account login card is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Expert tools'), 'Expert tools section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Remote Job API'), 'Remote Job API section is missing')
expect(PREFERENCES_SECTION_TITLES.length === 16, 'unexpected Preferences section count')
expect(LANGUAGE_PREFERENCE_VALUES[0] === 'system', 'Language System must be first')
expect(THEME_PREFERENCE_VALUES[0] === 'device', 'Theme System must be first')
expect(languageSelectValue('system') === 'system', 'Language select must keep System')
expect(languageSelectValue('zh-TW') === 'zh-TW', 'Language select must keep zh-TW')
expect(languageSelectValue('fr') === 'en', 'Unknown language falls back to English')
expect(themeSelectValue('device') === 'device', 'Theme select must keep System')
expect(themeSelectValue('light') === 'light', 'Theme select must keep Light')
expect(themeSelectValue('auto') === 'device', 'Unknown theme falls back to System')
expect(componentSource.includes('LANGUAGE_PREFERENCE_VALUES'), 'Language dropdown must use shared preference values')
expect(componentSource.includes('THEME_PREFERENCE_VALUES'), 'Theme dropdown must use shared preference values')
expect(componentSource.includes("t('prefs.theme.label')"), 'General must include Theme')
expect(componentSource.includes("t('language.system')"), 'Language dropdown must include System')
expect(componentSource.includes("t('theme.system')"), 'Theme dropdown must include System')
expect(outputTemplateError('{title} [{id}]', 'filename') === null, 'default filename template is valid')
expect(outputTemplateError('{title} {nope}', 'filename')?.key === 'prefs.saveFiles.errUnknownToken', 'unknown filename token must error')
expect(outputTemplateError('{author} %(id)s', 'folder')?.key === 'prefs.saveFiles.errRaw', 'raw interpolation must error')
expect(previewOutputPath({
  downloadDir: '/Users/me/Downloads',
  filenameTemplate: '{title} [{id}]',
  folderNameTemplate: '{author}',
  archiveByAuthor: true
}).includes('DemoAuthor'), 'preview must include sample author folder')
expect(canPersistSiteRule('youtube.com'), 'named site rules must persist')
expect(!canPersistSiteRule('   '), 'empty site-rule domains must stay local')
expect(!componentSource.includes('More download controls'), 'Downloads must not keep the old combined disclosure')
expect(componentSource.includes("t('prefs.startup.title')"), 'General must include Startup and notifications')
expect(componentSource.includes('http://127.0.0.1:8080'), 'Downloads proxy must use the onboarding placeholder')
expect(componentSource.includes("t('prefs.saveFiles.credentialsRejected')"), 'Downloads proxy must use the onboarding credentials copy')
expect(componentSource.includes("t('prefs.expert.title')"), 'Douyin bulk must live under Expert tools')
expect(componentSource.includes("t('prefs.chromeCookie.title')"), 'Browser must split Chrome cookie sync')
expect(componentSource.includes("t('prefs.inAppLogin.title')"), 'Browser must split in-app account login')
expect(componentSource.includes('filenameTemplate'), 'Save files must persist filenameTemplate')
expect(componentSource.includes("t('prefs.saveFiles.archiveByAuthor')"), 'Save files must include the author-archive toggle')
expect(componentSource.includes('previewOutputPath'), 'Save files must show a live filename preview')
const forbiddenMarkers = [['Coming', ' soon'], ['road', 'map'], ['not persisted', ' yet']].map((parts) => parts.join(''))
for (const marker of forbiddenMarkers) {
  expect(!componentSource.toLowerCase().includes(marker.toLowerCase()), `placeholder found: ${marker}`)
}

console.log('PreferencesPanel presentation structure passed')
