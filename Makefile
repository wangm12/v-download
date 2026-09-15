.PHONY: install dev build mac mac-arm64 mac-x64 linux linux-arm64 deb appimage clean lint ext commit push release verify-release help

help:
	@echo "V-Download (desktop — repo root)"
	@echo "  make install   npm install (+ shared package + extension constants)"
	@echo "  make dev       node scripts/dev.mjs (Electron native preflight + electron-vite dev + host ABI restore; verbose env + tee logs/dev-latest.log)"
	@echo "  make build     electron-vite build"
	@echo "  make mac       build + electron-builder --mac"
	@echo "  make deb       build Linux .deb (npm run build:linux:deb)"
	@echo "  make linux     build Linux .deb + .AppImage (npm run build:linux)"
	@echo "  make clean     rm out/, dist/, vite cache, .release-staging"
	@echo "  make ext       reminder to reload Chrome extension"
	@echo "  make test      npm test"
	@echo "  make release   Build release packages (auto-detects macOS vs Linux)"
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

dmg: mac

mac-arm64:
	npm run build:mac:arm64

mac-x64:
	npm run build:mac:x64

linux:
	npm run build:linux

linux-arm64:
	npm run build:linux:arm64

deb:
	npm run build:linux:deb

appimage:
	npm run build:linux:appimage

clean:
	rm -rf out dist node_modules/.cache .release-staging
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

# Package installers: auto-detects host OS (macOS -> dmg/zip; Linux -> deb/AppImage)
release:
ifeq ($(shell uname -s),Darwin)
	npm run build:mac
else
	npm run build:linux
endif

verify-release:
	npm run verify:release
