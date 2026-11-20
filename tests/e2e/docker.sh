#!/bin/sh
# Regenerates the Linux visual baselines inside the official Playwright image, the same image the CI "e2e-shard" jobs run
# in, so local and CI screenshots match pixel for pixel. Never commit baselines made on macOS.
# Usage: pnpm e2e:update (every baseline, orphans removed) or pnpm e2e:update -g "<title>" (only the matching tests).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
# One source of truth for the image and its digest: the CI job.
image=$(sed -n 's/^ *image: \(mcr\.microsoft\.com\/playwright.*\)$/\1/p' "$root/.github/workflows/pr.yml")

# The repository is copied in read-only and installed fresh, so the host's macOS node_modules are never touched.
# amd64 like the CI runner: arm64 Chromium (Apple Silicon) antialiases differently, so its pixels never match CI.
docker run --rm --ipc=host --platform linux/amd64 \
  -v "$root:/src:ro" -v "$here/src:/out" \
  "$image" \
  sh -c '
    set -eu
    mkdir /work
    tar -C /src --exclude=node_modules --exclude=.next --exclude=.turbo --exclude=.git -cf - . | tar -C /work -xf -
    cd /work
    npm install --global --silent "$(node -p "require(\"./package.json\").packageManager")"
    pnpm install --frozen-lockfile --ignore-scripts --reporter=append-only
    # A full run starts from no baselines, so a renamed or deleted test leaves no orphan PNG behind.
    [ "$#" -eq 0 ] && rm -rf tests/e2e/src/*-snapshots
    set +e
    pnpm e2e --update-snapshots "$@"
    code=$?
    [ "$#" -eq 0 ] && rm -rf /out/*-snapshots
    cp -R tests/e2e/src/*-snapshots /out/
    exit $code
  ' sh "$@"
