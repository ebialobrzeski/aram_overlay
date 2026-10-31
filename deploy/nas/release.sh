#!/bin/sh
# Build the Windows installer + portable exe on the NAS and publish them to the GitHub release of a tag.
#
#   ./release.sh               newest v* tag on origin
#   ./release.sh v0.2.0        that tag
#   ./release.sh v0.2.0 --no-publish   build only (files land in release/)
#
# Needs: docker; deploy/nas/.env with GH_TOKEN (classic token, "repo" scope) for publishing.
# git is optional (a container is used when it is missing, like staffium's deploy.sh).
# The build runs in electron-builder's official image, which cross-builds Windows targets on Linux.
set -eu
cd "$(dirname "$0")"
ENV_DIR=$(pwd)
cd ../..
REPO=$(pwd)

log() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m!!\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not found"

git_() {
  if command -v git >/dev/null; then git "$@"
  else docker run --rm -v "$REPO":/repo -w /repo alpine/git "$@"
  fi
}

TAG=""
PUBLISH=always
for a in "$@"; do
  case "$a" in
    --no-publish) PUBLISH=never ;;
    *) TAG=$a ;;
  esac
done

if [ -f "$ENV_DIR/.env" ]; then set -a; . "$ENV_DIR/.env"; set +a; fi
if [ "$PUBLISH" = always ] && [ -z "${GH_TOKEN:-}" ]; then
  die "GH_TOKEN missing: copy deploy/nas/env.example to deploy/nas/.env and put a GitHub token in it (or use --no-publish)"
fi

log "Fetching tags"
git_ fetch --tags --force origin
[ -n "$TAG" ] || TAG=$(git_ tag --list 'v*' --sort=-v:refname | head -n 1)
[ -n "$TAG" ] || die "no v* tag found"
git_ rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "tag $TAG does not exist on origin"

log "Checking out $TAG"
git_ -c advice.detachedHead=false checkout -q --force "$TAG"
git_ clean -fdxq -e deploy/nas/.env -e release/

VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' package.json)
[ "v$VERSION" = "$TAG" ] || log "WARNING: package.json version ($VERSION) does not match the tag ($TAG); the release will be v$VERSION"

IMAGE=${BUILDER_IMAGE:-electronuserland/builder:wine}
log "Building in $IMAGE (npm ci, tests, electron-builder --win, publish=$PUBLISH)"
docker run --rm \
  -v "$REPO":/project \
  -v aram-overlay-npm-cache:/root/.npm \
  -v aram-overlay-electron-cache:/root/.cache/electron \
  -v aram-overlay-builder-cache:/root/.cache/electron-builder \
  -e GH_TOKEN="${GH_TOKEN:-}" \
  -e ELECTRON_BUILDER_PUBLISH="$PUBLISH" \
  -w /project "$IMAGE" sh -c '
    set -e
    npm ci --no-audit --no-fund
    npm test
    node scripts/build.mjs
    npx electron-builder --win --publish "$ELECTRON_BUILDER_PUBLISH"
  '

log "Artifacts:"
ls -l release/*.exe 2>/dev/null || true
if [ "$PUBLISH" = always ]; then
  log "Published to https://github.com/ebialobrzeski/aram_overlay/releases/tag/v$VERSION"
fi
