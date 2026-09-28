#!/bin/sh
# Report how many attempts an SSH step actually used, and make a degrading host VISIBLE.
#
# 🔴 This is the half of the F7b retry that stops it from being harmful (F7b).
# A retry that silently succeeds on the third try turns a host problem into a green
# tick: the deploy works, nobody is told, and the signal that the box is degrading is
# destroyed by the very thing meant to survive it. The retry buys availability; this
# script pays for it by making "needed 3 attempts" look DIFFERENT from "worked first
# time" in the run summary, every single time.
#
# Reads the three attempt outcomes from the environment (A1/A2/A3, each one of
# success | failure | skipped) and the step label as $1.
#
# Outcome semantics are GitHub's: with `continue-on-error: true` a failed step has
# outcome=failure but conclusion=success, which is what lets the next attempt run.
set -eu

LABEL="${1:?a step label is required}"

# A step that never ran reports `skipped`; treat an empty value the same way, so this
# can never mistake "no data" for "an attempt happened".
a1="${A1:-skipped}"
a2="${A2:-skipped}"
a3="${A3:-skipped}"

attempts=0
last="none"
for o in "$a1" "$a2" "$a3"; do
  case "$o" in
    success|failure)
      attempts=$((attempts + 1))
      last="$o"
      ;;
  esac
done

echo "${LABEL}: attempt outcomes = ${a1} / ${a2} / ${a3}"
echo "${LABEL}: attempts used = ${attempts} of 3"

# 🔴 Liveness. `attempts = 0` means no attempt executed at all — which otherwise looks
# exactly like a healthy run that simply had nothing to report. A restraint result
# ("nothing failed") is indistinguishable from a script that never ran unless something
# asserts that it ran.
if [ "$attempts" -eq 0 ]; then
  echo "::warning::${LABEL}: NO SSH attempt ran, although the deploy secrets were present. This is not a healthy run — it means the attempt steps were skipped, not that everything was fine."
  exit 0
fi

if [ "$last" = "failure" ]; then
  echo "::error::${LABEL}: FAILED after all ${attempts} attempts. This is a persistent failure, not a transient handshake reset — the retry did not mask it and the job fails."
  exit 0
fi

if [ "$attempts" -gt 1 ]; then
  echo "::warning::${LABEL}: succeeded only on attempt ${attempts} of 3. The deploy went through, but the SSH host is degrading — a run that needs retries is NOT a healthy run. If this keeps happening, the host is the problem, not the pipeline."
  exit 0
fi

echo "${LABEL}: succeeded on the first attempt (healthy)."
