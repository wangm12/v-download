// @ts-nocheck
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  GENERAL_SECTION_CLASS,
  PREFERENCES_SECTION_TITLES,
  PREFERENCES_WORKSPACE_CLASS,
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
expect(GENERAL_SECTION_CLASS.includes('lg:col-span-2'), 'General must span the desktop workspace')
expect(componentSource.includes('className={PREFERENCES_WORKSPACE_CLASS}'), 'General must use the workspace class')
expect(componentSource.includes('className={GENERAL_SECTION_CLASS}'), 'General must use the full-width class')
expect(PREFERENCES_SECTION_TITLES.includes('Behavior'), 'Behavior section is missing')
expect(PREFERENCES_SECTION_TITLES.includes('Per-site defaults'), 'Sites section is missing')
expect(PREFERENCES_SECTION_TITLES.length === 11, 'unexpected Preferences section count')
const forbiddenMarkers = [['Coming', ' soon'], ['road', 'map'], ['not persisted', ' yet']].map((parts) => parts.join(''))
for (const marker of forbiddenMarkers) {
  expect(!componentSource.toLowerCase().includes(marker.toLowerCase()), `placeholder found: ${marker}`)
}

console.log('PreferencesPanel presentation structure passed')
