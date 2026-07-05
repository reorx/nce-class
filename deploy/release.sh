#!/usr/bin/env bash
# Release nce-class to server.name: update code, build image on the server,
# extract web/dist for Caddy, run migration with the NEW image, restart.
# With --miniapp/-m, also upload the weapp build to WeChat afterwards
# (miniprogram-ci; then set 体验版/提审 manually in the mp console).
# See kb/plans/2026-07-02-nce-class-deploy.md.
# (2026-07-03: host switched server.name → server.name after server.name died)
set -euo pipefail

HOST=server.name
MINIAPP=0
for arg in "$@"; do
  case "$arg" in
    --miniapp|-m) MINIAPP=1 ;;
    *) HOST="$arg" ;;
  esac
done

ssh "$HOST" bash -s <<'EOF'
set -euo pipefail
cd /opt/apps/nce-class

git fetch origin master
git reset --hard origin/master

docker compose build

# Copy the freshly built web/dist out of the image and swap it in for Caddy.
cid=$(docker create nce-class:latest)
rm -rf webdist.new
docker cp "$cid:/app/web/dist" webdist.new
docker rm "$cid" >/dev/null
rm -rf webdist.old
[ -d webdist ] && mv webdist webdist.old
mv webdist.new webdist
rm -rf webdist.old

# Migrate with the new image BEFORE switching containers; a failure here
# leaves the old container running untouched. </dev/null is load-bearing:
# without it `compose run` attaches stdin and swallows the rest of this
# heredoc script (up -d would silently never run).
docker compose run --rm -T app pnpm --filter server db:migrate </dev/null

docker compose up -d
docker image prune -f >/dev/null
EOF

sleep 3
curl -fsS https://service.domain/api/health && echo ' ✓ deploy ok'

# --- weapp upload (opt-in: --miniapp / -m) ---------------------------------
# Runs AFTER the server deploy so the new API is live before the new client.
# Uploads from the LOCAL working tree (the key never leaves this machine),
# while the server deploys origin/master — so warn if they may differ.
if [ "$MINIAPP" = 1 ]; then
  cd "$(dirname "$0")/.."

  KEY=tmp/private.wx19490e22f3580fb0.key
  if [ ! -f "$KEY" ]; then
    echo "!! missing $KEY — mp 后台「小程序代码上传」重新下载后放到该路径" >&2
    exit 1
  fi

  if [ -n "$(git status --porcelain)" ] || [ -n "$(git log origin/master..HEAD --oneline 2>/dev/null)" ]; then
    echo '!! 本地有未提交/未推送改动：weapp 将按本地代码构建，与服务器 (origin/master) 可能不一致' >&2
  fi

  # miniprogram-ci breaks on node 25 (homebrew); prefer nvm's node 24 if present.
  NODE24_BIN=$(ls -d "$HOME"/.nvm/versions/node/v24*/bin 2>/dev/null | tail -1 || true)
  [ -n "$NODE24_BIN" ] && export PATH="$NODE24_BIN:$PATH"

  pnpm --filter miniapp upload:weapp
  echo ' ✓ weapp uploaded — mp 后台「版本管理」把该版本设为体验版或提审'
fi
