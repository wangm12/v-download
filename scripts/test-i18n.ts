import assert from 'node:assert/strict'
import i18n, { changeAppLanguage } from '../src/renderer/src/i18n'

async function main(): Promise<void> {
  assert.equal(i18n.t('nav.downloads'), 'Downloads')
  assert.equal(i18n.t('nav.sniff'), 'nav.sniff')
  assert.equal(i18n.t('nav.library'), 'nav.library')
  await changeAppLanguage('zh-CN')
  assert.equal(i18n.t('nav.downloads'), '下载')
  await changeAppLanguage('zh-TW')
  assert.equal(i18n.t('nav.downloads'), '下載')
  await changeAppLanguage('en')
  assert.equal(i18n.t('nav.downloads'), 'Downloads')

  console.log('i18n tests passed')
}

void main()
