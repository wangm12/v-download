export const COMPACT_WINDOW_TITLE = 'V-Download Mini'
export const COMPACT_HASH = '#/compact'

export function compactWindowOptions(): {
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  titleBarStyle: 'hiddenInset'
  frame: false
  maximizable: false
  fullscreenable: false
} {
  return {
    title: COMPACT_WINDOW_TITLE,
    width: 380,
    height: 560,
    minWidth: 320,
    minHeight: 420,
    titleBarStyle: 'hiddenInset',
    frame: false,
    maximizable: false,
    fullscreenable: false
  }
}

export function compactLoadHash(): string {
  return COMPACT_HASH
}

export function isCompactUtilityWindow(): true {
  return true
}
