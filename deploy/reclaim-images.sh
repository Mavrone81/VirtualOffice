#!/bin/sh
# Remove this repository's superseded images from the deploy host.
#
# Runs ONLY after a deploy has been verified (see the CI/CD workflow) — never
# speculatively. Deploying by immutable per-commit tag is correct and it accumulates:
# ~400MB per merge, and the host's `docker image prune -f` cron removes DANGLING images
# only, so it will never reclaim a tagged one. The host's disk is finite and shared
# with other applications, so this repository's superseded images must be cleaned up.
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
#   * 🔴 prints "reclaim-images: complete" on EVERY path that finishes (F7b). Because
#     the script always exits 0, its exit code cannot distinguish "ran and removed
#     nothing" — the normal healthy case — from "never ran, or was cut off mid-way by
#     a dropped connection". Only this sentinel can: the caller asserts it and warns
#     loudly when it is absent. A silent skip on a finite, shared disk is exactly the
#     failure this line exists to make visible.
#   * POSIX sh. This runs on the deploy host, whose shell is not ours to assume —
#     `set -o pipefail` is a bash-ism that aborts dash on line 1, which looks
#     identical to the script running and finding nothing to do.
#   * 🔴 REPORTS A DELTA, NEVER CAPACITY STATE. This repository is public and its
#     Actions logs are public with it — a live "used/free/%" figure teaches anyone
#     reading a deploy log exactly how close the shared host is to full. Images
#     removed (and reclaimed space, ONLY when the docker command we already ran
#     reports it itself) answer the operator's actual question ("did reclaim
#     work?") without publishing the host's capacity. A `df`-measured before/after
#     byte delta was tried and dropped: it measures the WHOLE filesystem, so
#     unrelated activity on a shared host swamps the real signal — one run reported
#     "freed -8192 byte(s)" for a removal that freed nothing (a shared-layer tag),
#     which reads as a regression when nothing regressed. Future emission only:
#     the figures this replaced are already in git history and in every past run's
#     own logs, which is a separate purge-plan item for the owner to decide on,
#     not fixed by this change.
#
# Usage: IMAGE=<repo> DEPLOY_SHA=<sha> sh deploy/reclaim-images.sh
set -u

: "${IMAGE:?IMAGE must be set}"
: "${DEPLOY_SHA:?DEPLOY_SHA must be set}"

removed_count=0
reclaimed_space=""

report() {
  # $1 = images removed this run (already known when called)
  if [ -n "$reclaimed_space" ]; then
    echo "reclaim: removed ${1} image(s) (${reclaimed_space})"
  else
    echo "reclaim: removed ${1} image(s)"
  fi
  echo "reclaim-images: complete"
}

# Newest first, by creation time — NOT by line order. An earlier version sorted on the
# awk record number, which selected the OLDEST image as "previous" and deleted the
# genuinely previous build: the exact thing keeping a previous image exists to prevent.
ROWS="$(docker images --filter "reference=${IMAGE}" --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' 2>/dev/null | sort -r)"

if [ -z "$ROWS" ]; then
  echo "no ${IMAGE} images present — nothing to do"
  report 0
  exit 0
fi

# Assert the filter did what we think BEFORE removing anything.
BAD="$(printf '%s\n' "$ROWS" | awk -F'|' -v r="$IMAGE" '{split($2,a,":"); if (a[1] != r) print $2}')"
if [ -n "$BAD" ]; then
  echo "::warning::Refusing to remove anything: the image filter returned rows outside ${IMAGE} ($(printf '%s' "$BAD" | tr '\n' ' ')). Not deleting on a shared host when the filter is not understood."
  report 0
  exit 0
fi

PREV="$(printf '%s\n' "$ROWS" | awk -F'|' -v c="$DEPLOY_SHA" '{split($2,a,":"); if (a[2] != "latest" && a[2] != c) print $2}' | head -1)"

# `< tmpfile`, not a pipe, so the loop runs in THIS shell, not a subshell — a piped
# `while` would lose $removed_count the moment the loop ends (POSIX subshell scoping),
# which is exactly the count this change needs to report.
ROWS_FILE="$(mktemp)"
trap 'rm -f "$ROWS_FILE"' EXIT
printf '%s\n' "$ROWS" > "$ROWS_FILE"

while IFS='|' read -r _created ref; do
  tag="${ref##*:}"
  if [ "$tag" = "latest" ] || [ "$tag" = "$DEPLOY_SHA" ] || [ "$ref" = "$PREV" ]; then
    echo "keep    $ref"
    continue
  fi
  RMI_OUT="$(docker rmi "$ref" 2>&1)"
  if [ $? -eq 0 ]; then
    echo "removed $ref"
    removed_count=$((removed_count + 1))
    # `docker rmi` does not print a reclaimed-space line today (checked: only
    # "Untagged:"/"Deleted:" lines with digests, even for a fully-deleted image)
    # — this stays as a live check, not a dead code path, in case that changes.
    SPACE_LINE="$(printf '%s\n' "$RMI_OUT" | grep -i 'reclaimed space' | head -1)"
    if [ -n "$SPACE_LINE" ]; then
      reclaimed_space="${reclaimed_space:+${reclaimed_space}, }${SPACE_LINE}"
    fi
  else
    echo "::warning::could not remove $ref (in use or has children) — left in place"
  fi
done < "$ROWS_FILE"

echo "kept: :latest, ${DEPLOY_SHA} (current), ${PREV:-none} (previous — rollback without a rebuild)"
report "$removed_count"
exit 0
