VDL := vdl-server

.PHONY: install dev build mac clean lint ext commit push release help \
	vdl-install vdl-dev vdl-build vdl-start vdl-server vdl-tunnel \
	vdl-clean vdl-clean-serve vdl-clean-dl vdl-status \
	vdl-docker-build vdl-docker-up vdl-docker-down vdl-docker-logs

help:
	@echo "V-Download (desktop — repo root)"
	@echo "  make install   npm install (+ shared package + extension constants)"
	@echo "  make dev       electron-vite dev"
	@echo "  make build     electron-vite build"
	@echo "  make mac       build + electron-builder --mac"
	@echo "  make clean     rm out/, dist/, vite cache"
	@echo "  make ext       reminder to reload Chrome extension"
	@echo "  make release   build + mac"
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
	npm run dev

build:
	npm run build

mac:
	npm run build:mac

clean:
	rm -rf out dist node_modules/.cache

lint:
	@echo "(no lint script in package.json)"

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
