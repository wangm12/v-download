# Docs cleanup — design

**Status:** implemented 2026-09-02  
**Product:** one living file per job; archive completed Superpowers notes

## Decision

Keep `docs/` flat. Do not split into user/developer/product folders. Deduplicate overlapping backlog pages, archive finished Superpowers work, and fix navigation.

## Living guides

| File | Job |
|------|-----|
| `docs/README.md` | Index |
| `PRODUCT_DIRECTION.md` | Strategy, guardrails, open backlog |
| `DESIGN_PLAN.md` | Monochrome UI plan |
| `REMOTE_JOB_API.md` | REST + MCP contract |
| `MANUAL_TESTING.md` | Release checklist |
| `DEBUG.md` / `RELEASE.md` / `PRIVACY.md` | Ops, packaging, privacy |
| `download-engines.md` | Routing + settings |
| `download-reliability.md` | Runbook + remaining Douyin research |
| `douyin-bulk.md` | Profile picker + Python escape hatch |

## Merge / drop

- Delete `FUTURE_ENHANCEMENTS.md`. Product backlog stays in `PRODUCT_DIRECTION.md`. Douyin fallback / remaining parse notes move into `download-reliability.md`. Optional CLI is a Product Direction non-goal (call the running app on `:18766`).
- Do not merge engines + reliability. Cross-link; trim repeated Douyin/playlist prose.

## Archive → `docs/superpowers/archive/`

- MCP facade spec + plan (living contract: `REMOTE_JOB_API.md`)
- Resolve + note.md spec + plan
- `2026-06-05-download-reliability-improvements.md`

Leave in `specs/` / `plans/`: Library Phase A, output templates.

## Navigation

- Root README / README-CN point at `docs/README.md` and Product Direction; drop Future Enhancements; list the real `docs/` tree.
- Restore Chinese `## 使用方法`.
- Fix duplicate step numbers in `MANUAL_TESTING.md`.
- Mark MCP shipped in Product Direction.

## Out of scope

- Rewriting `REMOTE_JOB_API.md` or the design pack.
- Translating English living guides into Chinese.
- Audience-based folder split.
