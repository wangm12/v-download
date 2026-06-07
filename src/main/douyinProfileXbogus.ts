/**
 * X-Bogus signing for Douyin web API (ported from reference MIT douyin-downloader / Evil0ctal algorithm).
 */
import { createHash } from 'crypto'
import { DOUYIN_DESKTOP_UA } from './douyinParseUtils'

const ARRAY_LOOKUP: (number | null)[] = [
  ...Array(48).fill(null),
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ...Array(7).fill(null),
  ...Array(26).fill(null),
  10, 11, 12, 13, 14, 15,
]

const CHARACTER = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe='
const UA_KEY = Buffer.from([0, 1, 12])

function md5StrToArray(md5Str: string): number[] {
  if (md5Str.length > 32) {
    return [...md5Str].map((c) => c.charCodeAt(0))
  }
  const out: number[] = []
  for (let idx = 0; idx < md5Str.length; idx += 2) {
    const hi = ARRAY_LOOKUP[md5Str.charCodeAt(idx)] ?? 0
    const lo = ARRAY_LOOKUP[md5Str.charCodeAt(idx + 1)] ?? 0
    out.push((hi << 4) | lo)
  }
  return out
}

function md5Bytes(input: string | number[]): string {
  const data = typeof input === 'string' ? md5StrToArray(input) : input
  return createHash('md5').update(Buffer.from(data)).digest('hex')
}

function md5Encrypt(urlPath: string): number[] {
  const hashed = md5Bytes(md5StrToArray(md5Bytes(urlPath)))
  return md5StrToArray(hashed)
}

function rc4Encrypt(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) % 256
    ;[s[i], s[j]] = [s[j]!, s[i]!]
  }
  const out = Buffer.alloc(data.length)
  let i = 0
  j = 0
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) % 256
    j = (j + s[i]!) % 256
    ;[s[i], s[j]] = [s[j]!, s[i]!]
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) % 256]!
  }
  return out
}

function encodingConversion(values: number[]): string {
  return Buffer.from(values).toString('latin1')
}

function encodingConversion2(a: number, b: number, c: string): string {
  return String.fromCharCode(a) + String.fromCharCode(b) + c
}

function calculation(a1: number, a2: number, a3: number): string {
  const x3 = ((a1 & 255) << 16) | ((a2 & 255) << 8) | (a3 & 255)
  return (
    CHARACTER[(x3 & 16515072) >> 18]! +
    CHARACTER[(x3 & 258048) >> 12]! +
    CHARACTER[(x3 & 4032) >> 6]! +
    CHARACTER[x3 & 63]!
  )
}

/** Append `X-Bogus` to a full URL that already includes `?query`. */
export function signDouyinUrlWithXBogus(fullUrlWithQuery: string, userAgent = DOUYIN_DESKTOP_UA): string {
  const uaMd5Array = md5StrToArray(
    md5Bytes(
      rc4Encrypt(UA_KEY, Buffer.from(userAgent, 'latin1')).toString('base64')
    )
  )
  const emptyMd5Array = md5StrToArray(md5Bytes(md5StrToArray('d41d8cd98f00b204e9800998ecf8427e')))
  const urlMd5Array = md5Encrypt(fullUrlWithQuery)

  const timer = Math.floor(Date.now() / 1000)
  const ct = 536919696

  const newArray: number[] = [
    64,
    0, // int(0.00390625) in reference xor loop
    1,
    12,
    urlMd5Array[14]!,
    urlMd5Array[15]!,
    emptyMd5Array[14]!,
    emptyMd5Array[15]!,
    uaMd5Array[14]!,
    uaMd5Array[15]!,
    (timer >> 24) & 255,
    (timer >> 16) & 255,
    (timer >> 8) & 255,
    timer & 255,
    (ct >> 24) & 255,
    (ct >> 16) & 255,
    (ct >> 8) & 255,
    ct & 255,
  ]

  let xorResult = newArray[0]!
  for (const value of newArray.slice(1)) {
    xorResult ^= value
  }
  newArray.push(xorResult)

  const array3: number[] = []
  const array4: number[] = []
  for (let idx = 0; idx < newArray.length; idx += 2) {
    array3.push(newArray[idx]!)
    if (idx + 1 < newArray.length) array4.push(newArray[idx + 1]!)
  }
  const merged = [...array3, ...array4]

  const garbled = encodingConversion2(
    2,
    255,
    rc4Encrypt(
      Buffer.from('ÿ', 'latin1'),
      Buffer.from(encodingConversion(merged), 'latin1')
    ).toString('latin1')
  )

  let xb = ''
  for (let idx = 0; idx < garbled.length; idx += 3) {
    xb += calculation(garbled.charCodeAt(idx), garbled.charCodeAt(idx + 1), garbled.charCodeAt(idx + 2))
  }

  return `${fullUrlWithQuery}&X-Bogus=${xb}`
}
