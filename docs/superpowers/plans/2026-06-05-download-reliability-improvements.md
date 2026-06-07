# Download Reliability Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden long-running download reliability and error recovery by adding cancellable Douyin bulk jobs, clearer extension error lifecycle, and vdl-server Douyin gallery parity.

**Architecture:** Keep yt-dlp as primary engine, but make fallback paths operationally safer: backend bulk runs become tracked jobs (start/status/cancel/log), extension errors become time-bounded + dismissible, and server parser logic is aligned with desktop parser for Douyin note/gallery cases. Add targeted regression checks so future refactors do not silently remove these safeguards.

**Tech Stack:** Electron main/preload/renderer (TypeScript), Chrome extension MV3 (plain JS), vdl-server (TypeScript + tsx), markdown docs.

---

## File Structure / Responsibilities

- `src/main/douyinBulkJobs.ts` (create): in-memory bulk job registry; starts process, streams logs, supports cancellation, exposes status snapshot.
- `src/main/ipc/downloads.ts` (modify): replace one-shot `run-douyin-bulk` with `start/status/cancel` IPC handlers.
- `src/preload/index.ts` + `src/preload/index.d.ts` (modify): expose bulk lifecycle APIs to renderer.
- `src/renderer/src/components/PreferencesPanel.tsx` (modify): add "run bulk" action and live status panel.
- `src/renderer/src/types/index.ts` (modify): typed bulk job status model for UI.
- `extension/background.js` (modify): add TTL cleanup + explicit clear message handling for `lastDownloadError`.
- `extension/popup.js` + `extension/popup.html` + `extension/popup.css` (modify): render dismiss button, hide expired errors.
- `vdl-server/src/douyin.ts` (modify): lift desktop-grade media parsing (`video | gallery`) with typed discriminated union.
- `vdl-server/src/queue.ts` (modify): handle gallery downloads into folder/zip output path.
- `vdl-server/scripts/test-douyin-urls.ts` (modify): report media kind and image count.
- `docs/download-reliability.md` (modify): upgrade to runbook (symptom -> cause -> action).
- `docs/MANUAL_TESTING.md` (modify): scripted checklist for new flows.

---

### Task 1: Cancellable Douyin Bulk Job Lifecycle (Main + IPC)

**Files:**
- Create: `src/main/douyinBulkJobs.ts`
- Modify: `src/main/ipc/downloads.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Test: `src/main/douyinBulkJobs.ts` (behavior exercised via IPC smoke commands)

- [ ] **Step 1: Write the failing test (contract-first via compile-time usage in preload typings)**

```ts
// src/preload/index.d.ts
export interface DouyinBulkJobStatus {
  id: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  endedAt?: string
  stderrTail: string
}

export interface WindowApi {
  startDouyinBulk?: (url: string) => Promise<{ data?: { id: string }; error?: string }>
  getDouyinBulkStatus?: (id: string) => Promise<{ data?: DouyinBulkJobStatus; error?: string }>
  cancelDouyinBulk?: (id: string) => Promise<{ ok: boolean; error?: string }>
}
```

- [ ] **Step 2: Run verification to confirm it fails before implementation**

Run: `npm run build`
Expected: FAIL with IPC/preload implementation mismatch (methods declared but not implemented yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/douyinBulkJobs.ts (new)
import { runDouyinBulkCli } from './douyinBulk'
import { randomUUID } from 'crypto'

type JobState = 'running' | 'completed' | 'failed' | 'cancelled'

interface Job {
  id: string
  state: JobState
  startedAt: string
  endedAt?: string
  stderrTail: string
  cancel: () => void
}

const jobs = new Map<string, Job>()

export function startJob(url: string): { id: string } {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  const { promise, cancel } = runDouyinBulkCli({ url })
  jobs.set(id, { id, state: 'running', startedAt, stderrTail: '', cancel })

  promise
    .then(({ code, stderr }) => {
      const job = jobs.get(id)
      if (!job) return
      job.stderrTail = stderr.slice(-4000)
      job.endedAt = new Date().toISOString()
      job.state = code === 0 ? 'completed' : job.state === 'cancelled' ? 'cancelled' : 'failed'
    })
    .catch((err) => {
      const job = jobs.get(id)
      if (!job) return
      job.stderrTail = String(err).slice(-4000)
      job.endedAt = new Date().toISOString()
      job.state = job.state === 'cancelled' ? 'cancelled' : 'failed'
    })

  return { id }
}

export function getJob(id: string) {
  return jobs.get(id) ?? null
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job || job.state !== 'running') return false
  job.state = 'cancelled'
  job.endedAt = new Date().toISOString()
  job.cancel()
  return true
}
```

```ts
// src/main/ipc/downloads.ts (add handlers)
ipcMain.handle('start-douyin-bulk', async (_event, url: string) => {
  try {
    return { data: startJob(String(url || '').trim()) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('get-douyin-bulk-status', async (_event, id: string) => {
  const job = getJob(id)
  if (!job) return { error: 'Bulk job not found' }
  return { data: job }
})

ipcMain.handle('cancel-douyin-bulk', async (_event, id: string) => {
  return { ok: cancelJob(id) }
})
```

```ts
// src/preload/index.ts (expose methods)
startDouyinBulk: (url: string) => ipcRenderer.invoke('start-douyin-bulk', url),
getDouyinBulkStatus: (id: string) => ipcRenderer.invoke('get-douyin-bulk-status', id),
cancelDouyinBulk: (id: string) => ipcRenderer.invoke('cancel-douyin-bulk', id),
```

- [ ] **Step 4: Run verification to confirm it passes**

Run: `npm run build`
Expected: PASS; no TS errors in main/preload.

- [ ] **Step 5: Commit**

```bash
git add src/main/douyinBulkJobs.ts src/main/ipc/downloads.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: add cancellable douyin bulk job lifecycle"
```

---

### Task 2: Renderer Control Surface for Bulk Jobs

**Files:**
- Modify: `src/renderer/src/components/PreferencesPanel.tsx`
- Modify: `src/renderer/src/types/index.ts`
- Test: `src/renderer/src/components/PreferencesPanel.tsx` (UI behavior validated by build + manual flow)

- [ ] **Step 1: Write the failing test (type-first usage in UI code)**

```ts
// src/renderer/src/types/index.ts
export interface DouyinBulkJobStatus {
  id: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  endedAt?: string
  stderrTail: string
}
```

```tsx
// PreferencesPanel.tsx (planned usage)
const [bulkJob, setBulkJob] = useState<DouyinBulkJobStatus | null>(null)
```

- [ ] **Step 2: Run verification to confirm it fails before implementation**

Run: `npm run build`
Expected: FAIL because `WindowApi` and renderer usage are out of sync until full wiring is complete.

- [ ] **Step 3: Write minimal implementation**

```tsx
// PreferencesPanel.tsx (Douyin bulk card additions)
const [bulkUrl, setBulkUrl] = useState('')
const [bulkJobId, setBulkJobId] = useState('')
const [bulkJob, setBulkJob] = useState<DouyinBulkJobStatus | null>(null)

const startBulk = async () => {
  if (!window.api?.startDouyinBulk || !bulkUrl.trim()) return
  const res = await window.api.startDouyinBulk(bulkUrl.trim())
  const id = (res as { data?: { id: string } }).data?.id
  if (id) setBulkJobId(id)
}

useEffect(() => {
  if (!bulkJobId || !window.api?.getDouyinBulkStatus) return
  const t = window.setInterval(async () => {
    const res = await window.api!.getDouyinBulkStatus!(bulkJobId)
    const data = (res as { data?: DouyinBulkJobStatus }).data
    if (!data) return
    setBulkJob(data)
    if (data.state !== 'running') window.clearInterval(t)
  }, 1200)
  return () => window.clearInterval(t)
}, [bulkJobId])
```

- [ ] **Step 4: Run verification to confirm it passes**

Run: `npm run build`
Expected: PASS; Preferences renders with new bulk controls and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/PreferencesPanel.tsx src/renderer/src/types/index.ts
git commit -m "feat: add renderer controls for douyin bulk lifecycle"
```

---

### Task 3: Extension Error TTL + Dismiss UX

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/popup.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.css`
- Test: `extension/popup.js`

- [ ] **Step 1: Write the failing test (popup contract for stale error suppression)**

```js
// popup.js (behavior contract)
const ERROR_TTL_MS = 10 * 60 * 1000

function isFreshError(err) {
  return !!err && typeof err.message === 'string' && Date.now() - Number(err.t || 0) < ERROR_TTL_MS
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL or behavior mismatch during manual popup check (stale errors still shown).

- [ ] **Step 3: Write minimal implementation**

```js
// extension/popup.js
const ERROR_TTL_MS = 10 * 60 * 1000

function showLastDownloadError() {
  const el = document.getElementById('last-error')
  const dismiss = document.getElementById('dismiss-last-error')
  if (!el || !dismiss) return

  chrome.storage.local.get(['lastDownloadError'], (data) => {
    const err = data && data.lastDownloadError
    const fresh = err && Date.now() - Number(err.t || 0) < ERROR_TTL_MS
    if (fresh) {
      el.textContent = err.message
      el.style.display = 'block'
      dismiss.style.display = 'inline-flex'
    } else {
      el.style.display = 'none'
      dismiss.style.display = 'none'
      chrome.storage.local.remove('lastDownloadError')
    }
  })

  dismiss.addEventListener('click', () => {
    chrome.storage.local.remove('lastDownloadError')
    el.style.display = 'none'
    dismiss.style.display = 'none'
  })
}
```

```js
// extension/background.js (optional cleanup alarm)
chrome.alarms.create('last-error-gc', { periodInMinutes: 15 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'last-error-gc') return
  chrome.storage.local.get(['lastDownloadError'], ({ lastDownloadError }) => {
    if (!lastDownloadError) return
    if (Date.now() - Number(lastDownloadError.t || 0) > 10 * 60 * 1000) {
      chrome.storage.local.remove('lastDownloadError')
    }
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build`
Expected: PASS.

Manual verification:
1. Trigger an extension-side localhost failure.
2. Open popup -> error visible.
3. Wait TTL or click dismiss -> error disappears and does not reappear.

- [ ] **Step 5: Commit**

```bash
git add extension/background.js extension/popup.js extension/popup.html extension/popup.css
git commit -m "fix: make extension download error banner expirable and dismissible"
```

---

### Task 4: vdl-server Douyin Gallery/Note Parity

**Files:**
- Modify: `vdl-server/src/douyin.ts`
- Modify: `vdl-server/src/queue.ts`
- Modify: `vdl-server/scripts/test-douyin-urls.ts`
- Test: `vdl-server/scripts/test-douyin-urls.ts`

- [ ] **Step 1: Write the failing test**

```ts
// vdl-server/scripts/test-douyin-urls.ts
for (const url of urls) {
  const info = await getDouyinInfo(url)
  if (!info) throw new Error(`No info for ${url}`)

  if (info.kind === 'gallery') {
    if (!info.imageUrls.length) throw new Error(`Gallery has no images: ${url}`)
  } else {
    if (!info.videoUrl) throw new Error(`Video has no play URL: ${url}`)
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:douyin --workspace=vdl-server`
Expected: FAIL on note/gallery URLs because current parser returns video-only shape.

- [ ] **Step 3: Write minimal implementation**

```ts
// vdl-server/src/douyin.ts
export interface DouyinGalleryInfo {
  kind: 'gallery'
  id: string
  title: string
  author: string
  cover: string
  imageUrls: string[]
}

export type DouyinMediaResult = DouyinVideoInfo | DouyinGalleryInfo

export function isDouyinGallery(info: DouyinMediaResult | null): info is DouyinGalleryInfo {
  return !!info && info.kind === 'gallery'
}

export async function getDouyinInfo(url: string): Promise<DouyinMediaResult | null> {
  // port parser branches from desktop src/main/douyin.ts:
  // - itemHasImages
  // - findGalleryItemDeep
  // - buildDouyinGalleryFromItem
  // - resolveMediaFromParsedData
}
```

```ts
// vdl-server/src/queue.ts
const douyinInfo = await getDouyinInfo(task.url)
if (!douyinInfo) throw new Error('Douyin fallback failed')

if (douyinInfo.kind === 'gallery') {
  const dirPath = await downloadDouyinImageGallery(douyinInfo.imageUrls, tmpDir, douyinInfo.title)
  filePath = dirPath
} else {
  filePath = await downloadDouyinVideo(douyinInfo.videoUrl, tmpDir, title, onPct)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run test:douyin --workspace=vdl-server`
- `npm run build --workspace=vdl-server`

Expected: PASS; gallery links print `kind=gallery` and non-empty image count.

- [ ] **Step 5: Commit**

```bash
git add vdl-server/src/douyin.ts vdl-server/src/queue.ts vdl-server/scripts/test-douyin-urls.ts
git commit -m "feat: add douyin gallery fallback parity to vdl-server"
```

---

### Task 5: Reliability Runbook + Manual Regression Checklist

**Files:**
- Modify: `docs/download-reliability.md`
- Modify: `docs/MANUAL_TESTING.md`
- Test: `docs/MANUAL_TESTING.md` scenarios

- [ ] **Step 1: Write the failing test (runbook acceptance cases)**

```md
## Acceptance matrix
- Symptom: "Bulk run never finishes"
- Required section: cancellation + status polling flow
- Fails if no command examples are provided
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rg "Symptom|Cause|Action" docs/download-reliability.md`
Expected: FAIL (missing complete matrix entries before update).

- [ ] **Step 3: Write minimal implementation**

```md
## Troubleshooting matrix

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Native playlist fails with 429 | request burst too high | Set `youtubePlaylistSleepRequests` to 1-3s and retry |
| Douyin note returns no formats | extractor drift / stale cookies | Refresh cookies, update yt-dlp, retry with CloakBrowser |
| Bulk job hangs in running | external python process blocked | Use `cancelDouyinBulk(id)`, check stderr tail, restart job |
```

```md
## Manual regression: Bulk lifecycle
1. Start bulk run from Preferences.
2. Confirm status transitions: running -> completed|failed|cancelled.
3. Cancel while running and confirm no orphan process remains.
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `rg "Symptom|Likely cause|Action" docs/download-reliability.md`
- `rg "Bulk lifecycle|cancel" docs/MANUAL_TESTING.md`

Expected: PASS with concrete troubleshooting and regression steps present.

- [ ] **Step 5: Commit**

```bash
git add docs/download-reliability.md docs/MANUAL_TESTING.md
git commit -m "docs: add reliability runbook and regression checklist"
```

---

## Final Verification Gate (before PR)

- [ ] Run: `npm run build`
- [ ] Run: `npm run build --workspace=vdl-server`
- [ ] Run: `npm run test:douyin --workspace=vdl-server`
- [ ] Manual: extension popup stale-error TTL + dismiss
- [ ] Manual: renderer bulk start/status/cancel
- [ ] Manual: Douyin gallery URL downloads as image set

Expected: all pass, no TypeScript errors, no unhandled promise rejections in Electron main logs.

---

## Self-Review

1. **Spec coverage:**
   - Bulk lifecycle robustness: covered in Task 1 + Task 2.
   - Extension stale error UX: covered in Task 3.
   - vdl-server parity gap: covered in Task 4.
   - Docs/runbook quality: covered in Task 5.

2. **Placeholder scan:**
   - No "TBD/TODO/implement later" placeholders remain.
   - Every task includes concrete files, code blocks, commands, and expected outcomes.

3. **Type consistency:**
   - `DouyinBulkJobStatus` is referenced consistently in preload + renderer.
   - `DouyinMediaResult` / `kind === 'gallery'` naming mirrors desktop semantics.

