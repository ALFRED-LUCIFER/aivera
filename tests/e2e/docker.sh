#!/bin/sh
# Regenerates the Linux visual baselines inside the official Playwright image, the same image the CI "e2e" job runs in,
# so local and CI screenshots match pixel for pixel. Never commit baselines made on macOS. Usage: pnpm e2e:update
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
version=$(node -p "require('$here/node_modules/@playwright/test/package.json').version")

# The repository is copied in read-only and installed fresh, so the host's macOS node_modules are never touched.
# amd64 like the CI runner: arm64 Chromium (Apple Silicon) antialiases differently, so its pixels never match CI.
docker run --rm --ipc=host --platform linux/amd64 \
  -v "$root:/src:ro" -v "$here/src:/out" \
  "mcr.microsoft.com/playwright:v$version-noble" \
  sh -c '
    set -eu
    mkdir /work
    tar -C /src --exclude=node_modules --exclude=.next --exclude=.turbo --exclude=.git -cf - . | tar -C /work -xf -
    cd /work
    npm install --global --silent "$(node -p "require(\"./package.json\").packageManager")"
    pnpm install --frozen-lockfile --ignore-scripts --reporter=append-only
    set +e
    pnpm e2e --update-snapshots "$@"
    code=$?
    cp -R tests/e2e/src/*-snapshots /out/
    exit $code
  ' sh "$@"
