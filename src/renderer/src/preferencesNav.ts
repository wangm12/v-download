/** Preferences sidebar sections (v2 IA); primary group + Advanced separated in UI. */

export type PrefSection = 'general' | 'downloads' | 'browser' | 'sites' | 'advanced'

export const PREF_SECTION_PRIMARY: { id: PrefSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'browser', label: 'Browser' },
  { id: 'sites', label: 'Sites' }
]

export const PREF_SECTION_ADVANCED: { id: PrefSection; label: string } = {
  id: 'advanced',
  label: 'Advanced'
}

/** Main content header per section (v2 mockup tone). */
export const PREF_SECTION_HEADER: Record<
  PrefSection,
  { title: string; subtitle: string }
> = {
  general: {
    title: 'General',
    subtitle: 'Default behavior, format picker, and library organization.'
  },
  downloads: {
    title: 'Downloads',
    subtitle: 'Queue speed, delay between starts, default format, and save location.'
  },
  browser: {
    title: 'Browser',
    subtitle: 'Chrome companion, cookie sync, and profiles for logged-in sites.'
  },
  sites: {
    title: 'Sites',
    subtitle: 'Per-site rules and defaults for matching domains.'
  },
  advanced: {
    title: 'Advanced',
    subtitle: 'Engine paths and diagnostics.'
  }
}
