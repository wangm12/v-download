// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_SKILL_FILENAME,
  AGENT_SKILL_MARKDOWN,
  AGENT_SKILL_NAME,
  triggerTextDownload
} from './agentSkillPresentation'

const shipped = readFileSync(
  join(process.cwd(), '.cursor/skills/v-download/SKILL.md'),
  'utf8'
)

assert.equal(AGENT_SKILL_FILENAME, 'SKILL.md')
assert.equal(AGENT_SKILL_NAME, 'v-download')
assert.equal(shipped, AGENT_SKILL_MARKDOWN, 'shipped Cursor skill must match the MCP-tab download payload')
assert.match(AGENT_SKILL_MARKDOWN, /^---\nname: v-download\n/)
assert.doesNotMatch(AGENT_SKILL_MARKDOWN, /this repo|stdio bridge/i)

const clicks: string[] = []
const fakeLink = {
  href: '',
  download: '',
  rel: '',
  click() {
    clicks.push(`${this.download}:${this.href}`)
  },
  remove() {}
}
const fakeDoc = {
  createElement(tag: string) {
    assert.equal(tag, 'a')
    return fakeLink
  },
  body: { appendChild(node: typeof fakeLink) { assert.equal(node, fakeLink) } }
}
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
URL.createObjectURL = () => 'blob:skill'
URL.revokeObjectURL = (url) => { assert.equal(url, 'blob:skill') }
try {
  triggerTextDownload(AGENT_SKILL_FILENAME, AGENT_SKILL_MARKDOWN, fakeDoc as unknown as Document)
} finally {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
}
assert.deepEqual(clicks, [`${AGENT_SKILL_FILENAME}:blob:skill`])

console.log('agent skill presentation tests passed')
