.PHONY: install dev build mac mac-arm64 mac-x64 clean lint ext commit push release verify-release help

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

install:
	npm install

dev:
	@mkdir -p logs
	@echo "=== V-Download dev — full log also in logs/dev-latest.log ==="
	@V_DOWNLOAD_VERBOSE=1 ELECTRON_ENABLE_LOGGING=1 npm run dev 2>&1 | tee logs/dev-latest.log

build:
	npm run build

run:
	npm run dev

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
