#!/usr/bin/env bash
# Release nce-class to server.name: update code, build image on the server,
# extract web/dist for Caddy, run migration with the NEW image, restart.
# See kb/plans/2026-07-02-nce-class-deploy.md.
set -euo pipefail

HOST=server.name

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
# leaves the old container running untouched.
docker compose run --rm app pnpm --filter server db:migrate

docker compose up -d
docker image prune -f >/dev/null
EOF

sleep 3
curl -fsS https://service.domain/api/health && echo ' ✓ deploy ok'
