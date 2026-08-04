import { createHash } from 'node:crypto'

const CHROME_EXTENSION_ID_ALPHABET = 'abcdefghijklmnop'

/**
 * Chrome derives an unpacked extension ID from the absolute extension folder
 * path. This lets a packaged app authorize the exact extension folder that it
 * ships, while production Web Store IDs remain in extension-config.
 */
export function getUnpackedChromeExtensionId(extensionPath: string): string {
  const digest = createHash('sha256').update(extensionPath).digest()
  let id = ''
  for (let i = 0; i < 16; i++) {
    const byte = digest[i] ?? 0
    id += CHROME_EXTENSION_ID_ALPHABET[byte >> 4]
    id += CHROME_EXTENSION_ID_ALPHABET[byte & 0x0f]
  }
  return id
}
