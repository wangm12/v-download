import { app, nativeImage, NativeImage } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { tmpdir } from 'os'

let idleIcon: NativeImage | null = null
let pendingTimeout: ReturnType<typeof setTimeout> | null = null
let lastUpdateTime = 0
let latestPercent = 0
let latestSpeedBytes = 0
let isActive = false

const THROTTLE_MS = 2000
const TMP_SVG = join(tmpdir(), 'vdl-dock-progress.svg')
const TMP_PNG = join(tmpdir(), 'vdl-dock-progress.png')

const ARROW_PATH =
  'M 440 236 h 144 a 40 40 0 0 1 40 40 v 292 l 12 0 c 14 0 18 20 8 30 L 544 800 c -14 22 -50 22 -64 0 L 320 598 c -10 -10 -6 -30 8 -30 l 12 0 V 276 a 40 40 0 0 1 40 -40 Z'

function resourcePath(relative: string): string {
  return join(__dirname, '../../resources', relative)
}

export function init(): void {
  if (process.platform !== 'darwin') return

  const idlePath = resourcePath('icon.png')
  idleIcon = nativeImage.createFromPath(idlePath)
  if (idleIcon && !idleIcon.isEmpty()) {
    app.dock.setIcon(idleIcon)
  }
  app.dock.setBadge('')
}

function generateSvg(percent: number, speedText: string): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const hasSpeed = !!speedText

  // Arrow spans y=236..800
  const fillTop = 236
  const fillBottom = hasSpeed ? 915 : 800
  const fillRange = fillBottom - fillTop
  const fillY = fillBottom - Math.round(fillRange * (clamped / 100))
  const fillHeight = fillBottom - fillY

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="tile" x1="20%" y1="4%" x2="82%" y2="96%">
      <stop offset="0%" stop-color="#F4F0E9"/>
      <stop offset="55%" stop-color="#E4DED4"/>
      <stop offset="100%" stop-color="#C8C1B7"/>
    </linearGradient>
    <clipPath id="fill">
      <rect x="0" y="${fillY}" width="1024" height="${fillHeight}"/>
    </clipPath>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#tile)"/>
  <path d="${ARROW_PATH}" fill="#1A1A1D" opacity="0.18"/>`

  if (hasSpeed) {
    svg += `
  <rect x="112" y="785" width="800" height="130" rx="65" fill="#1A1A1D" opacity="0.12"/>
  <g clip-path="url(#fill)">
    <path d="${ARROW_PATH}" fill="#1A1A1D"/>
    <rect x="112" y="785" width="800" height="130" rx="65" fill="#1A1A1D"/>
  </g>
  <text x="512" y="855" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system, Helvetica Neue, sans-serif"
        font-size="100" font-weight="bold" fill="#F4F0E9">${speedText}</text>`
  } else {
    svg += `
  <g clip-path="url(#fill)">
    <path d="${ARROW_PATH}" fill="#1A1A1D"/>
  </g>`
  }

  svg += '\n</svg>'
  return svg
}

function doUpdate(): void {
  if (process.platform !== 'darwin') return

  lastUpdateTime = Date.now()
  const speedText = formatBadgeSpeed(latestSpeedBytes)
  const svg = generateSvg(latestPercent, speedText)

  try {
    writeFileSync(TMP_SVG, svg)
  } catch {
    return
  }

  execFile('rsvg-convert', ['-w', '512', '-h', '512', TMP_SVG, '-o', TMP_PNG], (err) => {
    if (err) return
    try {
      const img = nativeImage.createFromPath(TMP_PNG)
      if (!img.isEmpty()) {
        app.dock.setIcon(img)
      }
    } catch {
      /* ignore */
    }
  })
}

export function updateProgress(percent: number, speedBytes: number, activeCount?: number): void {
  if (process.platform !== 'darwin') return

  latestPercent = percent
  latestSpeedBytes = speedBytes
  isActive = true

  if (activeCount != null && activeCount > 0) {
    app.dock.setBadge(activeCount > 99 ? '99+' : String(activeCount))
  } else {
    app.dock.setBadge('')
  }

  const now = Date.now()
  const elapsed = now - lastUpdateTime

  if (elapsed >= THROTTLE_MS) {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout)
      pendingTimeout = null
    }
    doUpdate()
  } else if (!pendingTimeout) {
    pendingTimeout = setTimeout(() => {
      pendingTimeout = null
      doUpdate()
    }, THROTTLE_MS - elapsed)
  }
}

export function reset(): void {
  if (process.platform !== 'darwin') return

  if (pendingTimeout) {
    clearTimeout(pendingTimeout)
    pendingTimeout = null
  }

  latestPercent = 0
  latestSpeedBytes = 0
  isActive = false

  if (idleIcon && !idleIcon.isEmpty()) {
    app.dock.setIcon(idleIcon)
  }
  app.dock.setBadge('')
}

export function formatBadgeSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return ''

  const KiB = 1024
  const MiB = 1024 * KiB
  const GiB = 1024 * MiB

  if (bytesPerSec >= GiB) return `${(bytesPerSec / GiB).toFixed(2)}GiB/s`
  if (bytesPerSec >= MiB) return `${(bytesPerSec / MiB).toFixed(2)}MiB/s`
  if (bytesPerSec >= KiB) return `${(bytesPerSec / KiB).toFixed(1)}KiB/s`
  return `${Math.round(bytesPerSec)}B/s`
}
