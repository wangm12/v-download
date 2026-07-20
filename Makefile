VDL := vdl-server

.PHONY: install dev build mac mac-arm64 mac-x64 clean lint ext commit push release verify-release help \
	vdl-install vdl-dev vdl-build vdl-start vdl-server vdl-tunnel \
	vdl-clean vdl-clean-serve vdl-clean-dl vdl-status \
	vdl-docker-build vdl-docker-up vdl-docker-down vdl-docker-logs

help:
	@echo "V-Download (desktop — repo root)"
	@echo "  make install   npm install (+ shared package + extension constants)"
	@echo "  make dev       node scripts/dev.mjs (Electron native preflight + electron-vite dev + host ABI restore; verbose env + tee logs/dev-latest.log)"
	@echo "  make build     electron-vite build"
	@echo "  make mac       build + electron-builder --mac"
	@echo "  make clean     rm out/, dist/, vite cache"
	@echo "  make ext       reminder to reload Chrome extension"
	@echo "  make release   build + mac"
	@echo "  make verify-release  fail-closed packaging/signing/engine/update checks"
	@echo ""
	@echo "vdl-server (delegates to $(VDL)/Makefile; run from repo root)"
	@echo "  make vdl-install       npm install in vdl-server"
	@echo "  make vdl-dev           polling dev (tsx watch)"
	@echo "  make vdl-build         tsc in vdl-server"
	@echo "  make vdl-start         node dist (after build)"
	@echo "  make vdl-server        Cloudflare tunnel + server (see vdl-server/scripts)"
	@echo "  make vdl-tunnel        tunnel only"
	@echo "  make vdl-clean         clean tmp serve + dl"
	@echo "  make vdl-clean-serve   clean tmp/serve only"
	@echo "  make vdl-clean-dl      clean tmp/dl only"
	@echo "  make vdl-status        tmp disk usage"
	@echo "  make vdl-docker-build  docker compose build (cwd $(VDL))"
	@echo "  make vdl-docker-up     docker compose up -d"
	@echo "  make vdl-docker-down   docker compose down"
	@echo "  make vdl-docker-logs   docker compose logs -f"

install:
	npm install

dev:
	@mkdir -p logs
	@echo "=== V-Download dev — full log also in logs/dev-latest.log ==="
	@V_DOWNLOAD_VERBOSE=1 ELECTRON_ENABLE_LOGGING=1 npm run dev 2>&1 | tee logs/dev-latest.log

build:
	npm run build

mac:
	npm run build:mac

mac-arm64:
	npm run build:mac:arm64

mac-x64:
	npm run build:mac:x64

clean:
	rm -rf out dist node_modules/.cache
	rm -f logs/*.log

typecheck:
	npm run typecheck

test:
	npm test

lint:
	npm run lint

# Reload extension in Chrome (prints reminder)
ext:
	@echo "Extension files updated. Reload at chrome://extensions"
	@echo "  extension/background.js"
	@echo "  extension/popup.html"
	@echo "  extension/popup.js"
	@echo "  extension/popup.css"

commit:
	git add -A && git commit

push:
	git push origin main

# Build then package for macOS in one step
release: build mac

verify-release:
	npm run verify:release

# --- vdl-server (Telegram bot) — same targets as vdl-server/Makefile, from repo root ---

vdl-install:
	cd $(VDL) && npm install

vdl-dev:
	$(MAKE) -C $(VDL) dev

vdl-build:
	$(MAKE) -C $(VDL) build

vdl-start:
	$(MAKE) -C $(VDL) start

vdl-server:
	$(MAKE) -C $(VDL) server

vdl-tunnel:
	$(MAKE) -C $(VDL) tunnel

vdl-clean:
	$(MAKE) -C $(VDL) clean

vdl-clean-serve:
	$(MAKE) -C $(VDL) clean-serve

vdl-clean-dl:
	$(MAKE) -C $(VDL) clean-dl

vdl-status:
	$(MAKE) -C $(VDL) status

vdl-docker-build:
	$(MAKE) -C $(VDL) docker-build

vdl-docker-up:
	$(MAKE) -C $(VDL) docker-up

vdl-docker-down:
	$(MAKE) -C $(VDL) docker-down

vdl-docker-logs:
	$(MAKE) -C $(VDL) docker-logs
