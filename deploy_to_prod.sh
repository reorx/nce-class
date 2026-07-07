#!/usr/bin/env bash
# Deploy nce-class to production (service.domain on server.name).
# Pre-flight: working tree must be clean; unpushed commits are pushed
# automatically (the server builds from origin/master, so what you see
# locally is what ships). Then delegates to deploy/release.sh.
# Usage: ./deploy_to_prod.sh [--miniapp|-m] [host]
set -euo pipefail
cd "$(dirname "$0")"

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != master ]; then
  echo "!! 当前在 $branch 分支，生产部署只发 master" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo '!! 工作区有未提交改动，先 commit 或 stash 再部署' >&2
  git status --short >&2
  exit 1
fi

git fetch origin master
if [ -n "$(git log HEAD..origin/master --oneline)" ]; then
  echo '!! origin/master 领先本地，先 git pull 再部署' >&2
  exit 1
fi
if [ -n "$(git log origin/master..HEAD --oneline)" ]; then
  echo '-- 本地有未推送提交，push 到 origin/master...'
  git push origin master
fi

exec bash deploy/release.sh "$@"
