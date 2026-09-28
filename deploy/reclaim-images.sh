#!/bin/sh
# Remove this repository's superseded images from the deploy host.
#
# Runs ONLY after a deploy has been verified (see the CI/CD workflow) — never
# speculatively. Deploying by immutable per-commit tag is correct and it accumulates:
# ~400MB per merge, and the host's `docker image prune -f` cron removes DANGLING images
# only, so it will never reclaim a tagged one. Measured on the deploy host 2026-09-28:
# / was 154G with 20G free (88% used), shared with other applications.
#
# 🔴 Constraints, each of which is load-bearing:
#   * scoped to ONE repository. A global prune on a shared host would delete other
#     tenants' images. The row set is asserted to belong to $IMAGE before anything is
#     removed, and the script aborts without deleting if it does not.
#   * keeps :latest, the current sha, and the newest OTHER sha — so the rollback in
#     deploy/ROLLBACK.md works without a rebuild.
#   * never `docker rmi -f`. An in-use image stays.
#   * always exits 0. A cleanup must not fail a deploy that already succeeded and
#     verified; problems are reported as warnings.
#   * POSIX sh. This runs on the deploy host, whose shell is not ours to assume —
#     `set -o pipefail` is a bash-ism that aborts dash on line 1, which looks
#     identical to the script running and finding nothing to do.
#
# Usage: IMAGE=<repo> DEPLOY_SHA=<sha> sh deploy/reclaim-images.sh
set -u

: "${IMAGE:?IMAGE must be set}"
: "${DEPLOY_SHA:?DEPLOY_SHA must be set}"

disk() { df -h / | awk 'NR==2{print $3" used, "$4" free ("$5")"}'; }
echo "disk before: $(disk)"

# Newest first, by creation time — NOT by line order. An earlier version sorted on the
# awk record number, which selected the OLDEST image as "previous" and deleted the
# genuinely previous build: the exact thing keeping a previous image exists to prevent.
ROWS="$(docker images --filter "reference=${IMAGE}" --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' 2>/dev/null | sort -r)"

if [ -z "$ROWS" ]; then
  echo "no ${IMAGE} images present — nothing to do"
  echo "disk after : $(disk)"
  exit 0
fi

# Assert the filter did what we think BEFORE removing anything.
BAD="$(printf '%s\n' "$ROWS" | awk -F'|' -v r="$IMAGE" '{split($2,a,":"); if (a[1] != r) print $2}')"
if [ -n "$BAD" ]; then
  echo "::warning::Refusing to remove anything: the image filter returned rows outside ${IMAGE} ($(printf '%s' "$BAD" | tr '\n' ' ')). Not deleting on a shared host when the filter is not understood."
  echo "disk after : $(disk)"
  exit 0
fi

PREV="$(printf '%s\n' "$ROWS" | awk -F'|' -v c="$DEPLOY_SHA" '{split($2,a,":"); if (a[2] != "latest" && a[2] != c) print $2}' | head -1)"

printf '%s\n' "$ROWS" | while IFS='|' read -r _created ref; do
  tag="${ref##*:}"
  if [ "$tag" = "latest" ] || [ "$tag" = "$DEPLOY_SHA" ] || [ "$ref" = "$PREV" ]; then
    echo "keep    $ref"
  elif docker rmi "$ref" >/dev/null 2>&1; then
    echo "removed $ref"
  else
    echo "::warning::could not remove $ref (in use or has children) — left in place"
  fi
done

echo "kept: :latest, ${DEPLOY_SHA} (current), ${PREV:-none} (previous — rollback without a rebuild)"
echo "disk after : $(disk)"
exit 0
