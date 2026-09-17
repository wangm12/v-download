#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

cd "${project_root}"

# 1. Check working directory status
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "error: working tree has uncommitted changes. Please commit or stash before releasing." >&2
    exit 1
fi

current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ "${current_branch}" != "main" ]]; then
    echo "error: releases must be cut from the 'main' branch (currently on '${current_branch:-detached HEAD}')" >&2
    exit 1
fi

echo "==> Fetching latest changes and tags from origin..."
git fetch origin main --tags

# Ensure local main is up-to-date with origin/main
local_head=$(git rev-parse HEAD)
remote_head=$(git rev-parse origin/main)
if [[ "${local_head}" != "${remote_head}" ]]; then
    echo "error: local main (${local_head::7}) is not in sync with origin/main (${remote_head::7}). Please push or pull first." >&2
    exit 1
fi

# 2. Determine target version & release notes
current_pkg_version="$(node -p "require('./package.json').version")"
latest_tag="$(git tag -l "v*" 2>/dev/null | sort -V | tail -n 1 || true)"
base_v="${latest_tag#v}"
if [[ -z "${base_v}" ]]; then
    base_v="${current_pkg_version}"
fi

major="$(echo "${base_v}" | cut -d. -f1)"
minor="$(echo "${base_v}" | cut -d. -f2)"
patch="$(echo "${base_v}" | cut -d. -f3)"
suggested_patch="${major}.${minor}.$((patch + 1))"
suggested_minor="${major}.$((minor + 1)).0"
suggested_major="$((major + 1)).0.0"

raw_version="${1:-${VERSION:-}}"

if [[ -z "${raw_version}" ]]; then
    echo ""
    echo "================================================================"
    echo "  📦 V-Download Release Wizard"
    echo "================================================================"
    echo "  Current version:      ${base_v} (latest tag: ${latest_tag:-none})"
    echo ""
    echo "  Semantic Version Guide (X.Y.Z):"
    echo "    • Patch [bugfix]:   ${suggested_patch} (default - press Enter)"
    echo "    • Minor [feature]:  ${suggested_minor}"
    echo "    • Major [breaking]: ${suggested_major}"
    echo "================================================================"
    echo ""

    if [[ -t 0 ]]; then
        read -rp "👉 Enter version to release [default: ${suggested_patch}]: " input_version
        raw_version="${input_version:-${suggested_patch}}"
    else
        raw_version="${suggested_patch}"
    fi
fi

# Normalize: strip leading 'v' then prefix with 'v'
clean_version="${raw_version#v}"
tag="v${clean_version}"

if ! [[ "${clean_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo "error: invalid semantic version '${raw_version}'. Expected format: X.Y.Z or vX.Y.Z (e.g. 1.1.8)" >&2
    exit 1
fi

# 3. Check if tag already exists
if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
    echo "error: tag '${tag}' already exists locally." >&2
    exit 1
fi

if git ls-remote --tags origin "refs/tags/${tag}" | grep -q "${tag}"; then
    echo "error: tag '${tag}' already exists on origin." >&2
    exit 1
fi

# 4. Prompt for Release Notes
release_notes="${NOTES:-}"
if [[ -z "${release_notes}" ]] && [[ -t 0 ]]; then
    echo ""
    echo "----------------------------------------------------------------"
    echo "📝 Enter release notes for ${tag}"
    echo "   (Describe what changed, or press Enter to auto-generate from commits):"
    echo "----------------------------------------------------------------"
    read -rp "Release notes: " input_notes
    release_notes="${input_notes:-}"
fi

tag_message="Release ${tag}"
if [[ -n "${release_notes}" ]]; then
    tag_message="${tag}: ${release_notes}"
fi

# 5. Confirmation prompt
if [[ -t 0 ]]; then
    echo ""
    echo "================================================================"
    echo "  🚀 Ready to publish release: ${tag}"
    if [[ -n "${release_notes}" ]]; then
        echo "  Notes: ${release_notes}"
    else
        echo "  Notes: (Auto-generated from git commit history)"
    fi
    echo "================================================================"
    read -rp "Proceed with tagging and trigger GitHub Release? [y/N]: " confirm
    if [[ "${confirm}" != "y" ]] && [[ "${confirm}" != "Y" ]]; then
        echo "Release cancelled."
        exit 0
    fi
fi

# 6. Sync version across package.json and extension/manifest.json if needed
current_pkg_version="$(node -p "require('./package.json').version")"
if [[ "${current_pkg_version}" != "${clean_version}" ]]; then
    echo "==> Bumping package.json to ${clean_version}..."
    npm version --no-git-tag-version "${clean_version}"

    echo "==> Bumping extension/manifest.json to ${clean_version}..."
    node -e "
      const fs = require('fs');
      const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
      manifest.version = '${clean_version}';
      fs.writeFileSync('extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    "

    # Also sync MCP_SERVER_VERSION if files exist
    node -e "
      const fs = require('fs');
      for (const file of ['src/main/remoteMcpModel.ts', 'scripts/v-download-mcp-stdio.mjs']) {
        if (fs.existsSync(file)) {
          let content = fs.readFileSync(file, 'utf8');
          content = content.replace(/export const MCP_SERVER_VERSION = '[^']+'/, \"export const MCP_SERVER_VERSION = '${clean_version}'\");
          fs.writeFileSync(file, content);
        }
      }
    "

    git add package.json package-lock.json extension/manifest.json src/main/remoteMcpModel.ts scripts/v-download-mcp-stdio.mjs
    git commit -m "chore(release): bump version to ${clean_version}"
    echo "==> Pushing release commit to origin/main..."
    git push origin main
fi

# 7. Create and push tag
echo "==> Creating tag ${tag}..."
git tag -a "${tag}" -m "${tag_message}"

echo "==> Pushing tag ${tag} to origin..."
git push origin "${tag}"

repo_url="$(git config --get remote.origin.url 2>/dev/null | sed -E 's|^git@github.com:|https://github.com/|; s|\.git$||' || echo "https://github.com/wangm12/v-download")"

echo ""
echo "================================================================"
echo "  🎉 Successfully published release tag: ${tag}"
echo "================================================================"
echo "GitHub Actions will now automatically build and publish the release."
echo ""
echo "🔗 Watch progress: ${repo_url}/actions/workflows/release.yml"
echo "📦 View release:   ${repo_url}/releases/tag/${tag}"
echo "================================================================"
