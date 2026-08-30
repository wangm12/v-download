// @ts-nocheck
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  GENERAL_SECTION_CLASS,
  PREFERENCES_SECTION_TITLES,
  PREFERENCES_WORKSPACE_CLASS,
  canPersistSiteRule,
  hasSingleColumnPolicy
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
expect(PREFERENCES_SECTION_TITLES.includes('Download behavior'), 'Download behavior section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Per-site rules'), 'Sites section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Queue behavior'), 'Queue behavior disclosure is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Network / engine'), 'Network / engine disclosure is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Playlists'), 'Playlists disclosure is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Chrome cookie sync'), 'Chrome cookie sync card is missing')
expect(PREFERENCES_SECTION_TITLES.includes('In-app account login'), 'In-app account login card is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Expert tools'), 'Expert tools section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Remote Job API'), 'Remote Job API section is missing')
expect(PREFERENCES_SECTION_TITLES.length === 13, 'unexpected Preferences section count')
expect(canPersistSiteRule('youtube.com'), 'named site rules must persist')
expect(!canPersistSiteRule('   '), 'empty site-rule domains must stay local')
expect(!componentSource.includes('More download controls'), 'Downloads must not keep the old combined disclosure')
expect(componentSource.includes('Expert tools'), 'Douyin bulk must live under Expert tools')
expect(componentSource.includes('Chrome cookie sync'), 'Browser must split Chrome cookie sync')
expect(componentSource.includes('In-app account login'), 'Browser must split in-app account login')
const forbiddenMarkers = [['Coming', ' soon'], ['road', 'map'], ['not persisted', ' yet']].map((parts) => parts.join(''))
for (const marker of forbiddenMarkers) {
  expect(!componentSource.toLowerCase().includes(marker.toLowerCase()), `placeholder found: ${marker}`)
}

console.log('PreferencesPanel presentation structure passed')
