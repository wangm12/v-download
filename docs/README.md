# V-Download docs

Start here. Each living file has one job.

| Read | When |
|------|------|
| [PRODUCT_DIRECTION.md](./PRODUCT_DIRECTION.md) | Strategy, guardrails, open backlog |
| [REMOTE_JOB_API.md](./REMOTE_JOB_API.md) | HTTP jobs + MCP on `:18766` |
| [MANUAL_TESTING.md](./MANUAL_TESTING.md) | Release / regression checklist |
| [download-engines.md](./download-engines.md) | yt-dlp vs ffmpeg vs Douyin routing |
| [download-reliability.md](./download-reliability.md) | Runbook, resume, Douyin fallback research |
| [douyin-bulk.md](./douyin-bulk.md) | Profile picker + optional Python bulk |
| [DEBUG.md](./DEBUG.md) | `make dev` logs and `worklog.txt` |
| [RELEASE.md](./RELEASE.md) | macOS packaging, signing, GitHub Actions |
| [PRIVACY.md](./PRIVACY.md) | Extension cookies and local data |
| [DESIGN_PLAN.md](./DESIGN_PLAN.md) | Monochrome UI plan (pixels: [`design/v-download-v1/`](../design/v-download-v1/), settings pack: [`design/v-download-v2/`](../design/v-download-v2/)) |

`npm test` at the repo root runs the automated suite (parsers, queue, Remote API, UI contracts, security). Pull requests run the same suite in [`.github/workflows/test.yml`](../.github/workflows/test.yml). Heavier packaging checks are `npm run test:release-gates` and `npm run verify:release`.

Open Superpowers specs (Library Phase A, output templates) live under [superpowers/specs/](./superpowers/specs/). Finished notes are in [superpowers/archive/](./superpowers/archive/).
