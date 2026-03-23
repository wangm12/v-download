#!/usr/bin/env node

// Generates 11 dock icon frames (0%–100% in 10% steps) with
// a "fill from bottom to top" clip effect.
// Requires `rsvg-convert` on PATH.

const { execSync } = require('child_process')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const OUT_DIR = join(__dirname, '..', 'resources', 'progress')
mkdirSync(OUT_DIR, { recursive: true })

const ARROW =
  'M448,200 L576,200 Q596,200 596,220 L596,500 L700,500 Q730,500 710,530 L532,740 Q512,764 492,740 L314,530 Q294,500 324,500 L428,500 L428,220 Q428,200 448,200 Z'

function buildSvg(percent) {
  const fillTop = 200
  const fillBottom = 876
  const fillRange = fillBottom - fillTop
  const fillHeight = Math.round(fillRange * (percent / 100))

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#27272A"/>
      <stop offset="100%" style="stop-color:#18181B"/>
    </linearGradient>
    <clipPath id="fill">
      <rect x="0" y="${fillTop}" width="1024" height="${fillHeight}"/>
    </clipPath>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="220" ry="220" fill="url(#bg)"/>
  <path d="${ARROW}" fill="white" opacity="0.15"/>
  <rect x="280" y="800" width="464" height="76" rx="38" fill="white" opacity="0.15"/>
  <g clip-path="url(#fill)">
    <path d="${ARROW}" fill="white" opacity="0.95"/>
    <rect x="280" y="800" width="464" height="76" rx="38" fill="white" opacity="0.95"/>
  </g>
</svg>`
}

const STEPS = 11
for (let i = 0; i < STEPS; i++) {
  const pct = i * 10
  const svgPath = join(OUT_DIR, `icon-${pct}.svg`)
  const pngPath = join(OUT_DIR, `icon-${pct}.png`)

  writeFileSync(svgPath, buildSvg(pct))
  execSync(`rsvg-convert -w 512 -h 512 "${svgPath}" -o "${pngPath}"`)
  execSync(`rm "${svgPath}"`)

  console.log(`  icon-${pct}.png  (fill ${pct}%)`)
}

console.log(`\nGenerated ${STEPS} frames in ${OUT_DIR}`)
