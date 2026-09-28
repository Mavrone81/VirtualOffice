#!/bin/sh
# Deploy one exact commit of this application on the deploy host.
#
# Called by the CI/CD workflow's "Deploy over SSH" step, AFTER that step has pinned the
# host checkout to $DEPLOY_SHA. So the copy of this script that runs is always the one
# belonging to the commit being deployed — the same property deploy/reclaim-images.sh
# already relies on.
#
# 🔴 Why this is a file and not an inline heredoc in the workflow (F7b):
# the step around it is now attempted up to three times, and GitHub Actions has no loop
# and no YAML anchors — a retried `uses:` step has to be written out once per attempt.
# Inline, that meant THREE copies of this body in ci-cd.yml, which is a drift hazard:
# the copies stay identical only for as long as everyone remembers to edit all three.
# As a file it is written once, reviewable in a diff, and runnable in a test.
#
# 🔴 IDEMPOTENCY — the honest statement, not a blanket claim (F7b).
# This script is RE-RUNNABLE, which is not the same as "a retry is free":
#   * `docker compose pull` and `up -d` are re-runnable, and `prisma migrate deploy`
#     skips migrations it has already applied.
#   * BUT a retry after a PARTIAL step runs that step again, it does not no-op. A retry
#     after `up -d app` already succeeded will RECREATE the container: a brief extra
#     restart. That is a small availability cost, not a correctness risk.
#   * A retry is therefore safe to take, but it is not free — do not read "idempotent"
#     as "retrying costs nothing".
#
# POSIX sh. This runs on the deploy host, whose shell is not ours to assume —
# `set -o pipefail` is a bash-ism that aborts dash on line 1, which would look
# identical to the script running and succeeding quietly.
#
# Usage (from /root/VirtualOffice, checkout already pinned to $DEPLOY_SHA):
#   GHCR_TOKEN=... GHCR_USER=... APP_IMAGE=... DEPLOY_SHA=... sh deploy/deploy-app.sh
set -eu

: "${GHCR_TOKEN:?GHCR_TOKEN must be set}"
: "${GHCR_USER:?GHCR_USER must be set}"
: "${APP_IMAGE:?APP_IMAGE must be set}"
: "${DEPLOY_SHA:?DEPLOY_SHA must be set}"

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

# F7/A: pull and run the immutable per-commit tag, never `:latest`.
# `:latest` is mutable and is whatever build pushed last, which is not necessarily
# this one — that is how an older build won on 2026-09-28. APP_IMAGE is already the
# compose seam (docker-compose.prod.yml: image: ${APP_IMAGE:-...:latest}) and is
# exported for BOTH pull and up, so the container that starts is the one just pulled.
export APP_IMAGE
docker compose -f docker-compose.prod.yml pull app

# Apply pending migrations (deploy-only, never seeds) from the pinned source BEFORE
# swapping the app, so the schema is ready when the new code starts. --build picks up
# new migrations.
docker compose -f docker-compose.prod.yml --profile tools run --rm --build migrate
docker compose -f docker-compose.prod.yml up -d app

docker image prune -f
docker logout ghcr.io

echo "deploy-app: complete for ${DEPLOY_SHA}"
