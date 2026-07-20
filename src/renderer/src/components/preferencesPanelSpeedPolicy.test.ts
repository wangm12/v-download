import { getQueueConcurrencyPolicy } from '@v-download/shared'
import { DOWNLOAD_SPEED_MODES, getDownloadSpeedPresentation, getEffectiveIndividualLimit } from './preferencesPanelPresentation'

const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

expect(DOWNLOAD_SPEED_MODES.join(',') === 'balanced,turbo,gentle', 'speed modes must stay in presentation order')
expect(JSON.stringify(getDownloadSpeedPresentation('balanced').policy) === JSON.stringify(getQueueConcurrencyPolicy('balanced')), 'balanced policy must come from shared policy')
expect(getDownloadSpeedPresentation('turbo').description.includes('Same 12-task cap'), 'Turbo must explain the shared task cap')
expect(getDownloadSpeedPresentation('turbo').description.includes('16 fragment slots'), 'Turbo must explain fragment concurrency')
expect(getDownloadSpeedPresentation('gentle').policy.theoreticalMax === 2, 'Gentle theoretical maximum must come from shared policy')
expect(getEffectiveIndividualLimit('balanced', 1) === 1, 'configured individual limit 1 must be preserved')
expect(getEffectiveIndividualLimit('balanced', 2) === 2, 'configured individual limit 2 must be preserved')
expect(getEffectiveIndividualLimit('balanced', 10) === 3, 'balanced individual limit must clamp to shared policy')
expect(getEffectiveIndividualLimit('gentle', 3) === 1, 'gentle individual limit must remain 1')
expect(getEffectiveIndividualLimit('balanced', 0) === 1, 'individual limit must clamp to minimum 1')
expect(getEffectiveIndividualLimit('balanced', Number.NaN) === 3, 'NaN must fall back to the shared policy limit')
expect(getEffectiveIndividualLimit('balanced', Number.POSITIVE_INFINITY) === 3, 'positive infinity must clamp to the shared policy limit')
expect(getEffectiveIndividualLimit('balanced', Number.NEGATIVE_INFINITY) === 1, 'negative infinity must clamp to the minimum')
expect(getEffectiveIndividualLimit('balanced', '2.8') === 2, 'finite persisted values must follow scheduler flooring semantics')

console.log('PreferencesPanel speed policy presentation passed')
