#!/usr/bin/env bash
#
# vo-autoheal.sh — restart virtualoffice-app when it goes unhealthy.
#
# WHY THIS EXISTS: `restart: unless-stopped` only reacts to a container that
# EXITS. A Next.js process that is alive but wedged (event-loop stall, leaked
# handles, upstream hang) keeps the container "running" forever, so the compose
# restart policy never fires. Docker has no restart-on-unhealthy policy, which
# makes the image's HEALTHCHECK observational on its own — this cron is what
# turns it into self-healing.
#
# SCOPE — this script covers the wedged-but-alive mode ONLY, and deliberately so:
#   * a container that EXITS is `unless-stopped`'s job;
#   * a container stopped by a dying dockerd is `live-restore: true`'s job
#     (/etc/docker/daemon.json on 165, added after the 2026-07-29 outage where a
#     dockerd panic stopped all ~52 containers and NOTHING self-healed — an
#     exited container is not "unhealthy", so this script correctly did nothing).
# An EMPTY /var/log/vo-autoheal.log therefore means the app was never unhealthy.
# It is the expected result, NOT evidence that the cron is broken.
#
# Cron (on 165):  */5 * * * * /root/vo-autoheal.sh >> /var/log/vo-autoheal.log 2>&1
# Installed copy: /root/vo-autoheal.sh ; canonical copy: this repo's deploy/.
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

CONTAINER=virtualoffice-app
COOLDOWN=900                      # seconds; don't restart more than once per 15 min
STAMP=/run/vo-autoheal.last
TAG="[vo-autoheal]"
ts() { date '+%F %T'; }

status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER" 2>/dev/null)

# No container, or an image built before the HEALTHCHECK landed: nothing to do.
# Stay silent so the log only ever contains real events.
[ -z "$status" ] && exit 0
[ "$status" != "unhealthy" ] && exit 0

# Cooldown: if the app is crash-looping, restarting every 5 minutes just hides
# the problem and churns the container. Back off and leave it unhealthy so the
# state is visible in `docker ps`.
now=$(date +%s)
if [ -f "$STAMP" ]; then
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$COOLDOWN" ]; then
    echo "$(ts) $TAG $CONTAINER still unhealthy but restarted $((now - last))s ago (cooldown ${COOLDOWN}s) — leaving it alone"
    exit 0
  fi
fi

probe=$(docker inspect -f '{{json .State.Health.Log}}' "$CONTAINER" 2>/dev/null | tr -d '\n' | tail -c 300)
echo "$(ts) $TAG $CONTAINER is unhealthy — recent probes: $probe"
echo "$now" > "$STAMP"

if docker restart "$CONTAINER" >/dev/null 2>&1; then
  echo "$(ts) $TAG restarted $CONTAINER"
else
  echo "$(ts) $TAG ERROR: docker restart $CONTAINER failed"
  exit 1
fi
