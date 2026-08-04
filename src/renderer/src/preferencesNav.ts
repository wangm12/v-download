/** Preferences sidebar sections; everyday choices stay above low-frequency controls. */

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

/** Short page copy keeps the settings surface scannable. */
export const PREF_SECTION_HEADER: Record<
  PrefSection,
  { title: string; subtitle: string }
> = {
  general: {
    title: 'General',
    subtitle: 'Choose what happens when you download.'
  },
  downloads: {
    title: 'Downloads',
    subtitle: 'Choose where files go, default formats, and speed.'
  },
  browser: {
    title: 'Browser',
    subtitle: 'Connect the browser you use for logged-in sites.'
  },
  sites: {
    title: 'Sites',
    subtitle: 'Set defaults for specific websites.'
  },
  advanced: {
    title: 'Advanced',
    subtitle: 'Troubleshooting and special workflows.'
  }
}
