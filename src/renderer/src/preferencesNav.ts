/** Preferences sidebar sections; everyday choices stay above low-frequency controls. */

export type PrefSection = 'general' | 'downloads' | 'browser' | 'sites' | 'mcp' | 'advanced'

export const PREF_SECTION_PRIMARY: PrefSection[] = ['general', 'downloads', 'browser', 'sites']

export const PREF_SECTION_MCP: PrefSection = 'mcp'

export const PREF_SECTION_ADVANCED: PrefSection = 'advanced'
