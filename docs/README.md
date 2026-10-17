# V-Download docs

Start here. Current behavior, future implementation, and historical evidence are kept separate. Updated 2026-10-16.

## Current status and planned work

| Read | Purpose |
| --- | --- |
| [DESKTOP_STATUS.md](DESKTOP_STATUS.md) | Delivered desktop / Chrome changes, installation evidence, and known limits |
| [plans/web-download.md](plans/web-download.md) | Active website implementation plan; **not implemented**; milestones, compatibility, and E2E acceptance |
| [research/web-hosting-auth-2026-10-16.md](research/web-hosting-auth-2026-10-16.md) | Website feasibility and operation without the user's local Chrome session |
| [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) | Product scope and guardrails |

## Maintained reference

| Read | When |
|------|------|
| [REMOTE_JOB_API.md](REMOTE_JOB_API.md) | HTTP jobs + MCP on `:18766`; Cursor server `v-download` |
| [MANUAL_TESTING.md](MANUAL_TESTING.md) | Release / regression checklist |
| [download-engines.md](download-engines.md) | yt-dlp vs ffmpeg vs Douyin routing |
| [download-reliability.md](download-reliability.md) | Runbook, resume, Douyin fallback research |
| [douyin-bulk.md](douyin-bulk.md) | Profile picker + optional Python bulk |
| [DEBUG.md](DEBUG.md) | `make dev` logs and `worklog.txt` |
| [RELEASE.md](RELEASE.md) | macOS packaging, signing, GitHub Actions |
| [PRIVACY.md](PRIVACY.md) | Extension cookies and local data |
| [DESIGN_PLAN.md](DESIGN_PLAN.md) | Current desktop UI specification; older design exports are visual history |

## Historical evidence

[Desktop research and acceptance archive](archive/2026-10-desktop/README.md) contains the Downie comparison, delivered changes, installation reviews, and preserved evidence. Old feature rankings are historical suggestions, not active tasks. [Earlier UI review](reviews/ui-2026-10-03/README.md) and [stability review](reviews/2026-09-26-full-review.md) retain their original scope.

Links in maintained reports use repository-relative paths so they work in the checkout and on GitHub. Historical command output and raw evidence may still name the original local test paths.

`npm test` at the repo root runs the automated suite (parsers, queue, Remote API, UI contracts, security). Pull requests run the same suite in [`.github/workflows/test.yml`](../.github/workflows/test.yml). Heavier packaging checks are `npm run test:release-gates` and `npm run verify:release`.
