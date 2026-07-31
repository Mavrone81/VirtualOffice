# Design — survive a dockerd death on 165 with `live-restore`

**Date:** 2026-08-01
**Status:** Approved (brainstorm), pending implementation plan
**Owner:** VirtualOffice (change is box-level on 165, driven from this repo's ops backlog)

## Problem

On **2026-07-29 at 04:02 UTC** dockerd panicked inside BuildKit during an on-box image
build. systemd restarted it two seconds later, but on the way down the daemon ran its
shutdown path and logged `stopping restart-manager` for every container. All ~52 running
containers on 165 ended `Exited (0)` / `(143)` / `(137)` — and **stayed exited for ~5 hours**.
VirtualOffice was one of them; the user saw `vo.urbanwerkzsg.com` → 502.

Nothing self-healed, and each layer was behaving exactly as designed:

| Layer | Covers | Why it missed |
|---|---|---|
| `restart: unless-stopped` (compose) | container crashes, host reboot | does **not** restart a container in the *stopped* state |
| `HEALTHCHECK` (Dockerfile) | nothing on its own | Docker has no restart-on-unhealthy policy — it is observational |
| `vo-autoheal.sh` (5-min cron) | wedged-but-alive (`unhealthy`) | an *exited* container is not unhealthy, it is gone |

An empty `/var/log/vo-autoheal.log` is therefore correct behaviour, not a broken cron.

The gap is **"stopped and staying stopped."** The 2026-07-26 ops hardening closed the
wedged-but-alive mode only.

## Decision

Fix the mechanism, not the symptom: enable Docker's `live-restore` so a daemon death stops
killing containers in the first place.

This was chosen over a stopped-container watchdog (a cron that restarts exited containers).
A watchdog resurrects VO in ≤5 minutes but leaves the other ~50 containers — IMS, CRM,
HRMS, mmcafe and the rest — down until a human notices, and it treats a symptom the daemon
can simply stop producing. `live-restore` protects every tenant on the box at once.

## The change

Create `/etc/docker/daemon.json` on 165. **The file does not currently exist**, so there is
no merge risk and no pre-existing key to preserve:

```json
{
  "live-restore": true
}
```

Apply with **`systemctl reload docker`** (SIGHUP) — per Docker's documentation this option is
reconfigurable at runtime, so it takes effect with **zero container downtime**. A full daemon
restart is not required to enable it.

### Exactly one key, on purpose

`daemon.json` not existing also means json-file logging is unrotated, a standing contributor
to the disk pressure that has twice threatened this box (and with it VO's backups). Adding
`log-driver`/`log-opts` in the same edit is deliberately **excluded**: this change is about to
be stress-tested with a real daemon restart, and a second variable would make any failure
ambiguous. Log rotation is recorded as a follow-up.

## Preconditions (all verified on the box, 2026-08-01)

| Condition | Required | Actual |
|---|---|---|
| `daemon.json` exists | — | does not exist (clean slate) |
| Swarm mode | inactive (live-restore is standalone-containers only) | `Swarm=inactive` |
| Platform | Linux | Linux |
| Docker client/server version | matched | `29.6.0` / `29.6.0` |
| `docker.service` `KillMode` | `process` (systemd must not kill the shims) | `KillMode=process` |
| Docker in unattended-upgrades | absent (a minor-version bump breaks re-attach) | absent |
| Storage driver | must not change while live-restored | `overlayfs`, unchanged |

## Verification

The enable step is zero-risk. Proving it survives a daemon death is not, and is the whole
point — an unverified self-heal is exactly what the HEALTHCHECK turned out to be in July.

1. **Pre-capture** — record every container's name, state and `.State.StartedAt`, plus the
   running count (65 at time of writing). This is the baseline that makes step 3 a proof
   rather than an impression.
2. **Enable** — write `daemon.json`, validate it parses, `systemctl reload docker`, then assert
   `docker info` reports `LiveRestoreEnabled=true`. If it still reports `false`, stop here —
   the change did not take, and nothing has been risked.
3. **Prove it** — `systemctl restart docker`, then re-read every container's `StartedAt`.
   - **Unchanged timestamps ⇒ containers were never killed ⇒ live-restore works.**
   - Changed timestamps, or any container in `exited`, means it did not.
4. **Re-probe** the health URLs: `https://vo.urbanwerkzsg.com/api/health` (200 + JSON),
   `https://form.bevorasg.com`, `https://ims.bevorasg.com`.

Step 3 deliberately reproduces the 07-29 mechanism. Its failure mode is bounded and already
rehearsed: it lands the box in precisely the known outage state, recovered with the
datastores-first batch sequence in the `droplet-165-outage-runbook` memory (~10 min, proven
once). `Restart=always` returns dockerd within ~2s either way.

Timing: run during the SGT small hours, the lowest-traffic window — 165 is multi-tenant and
carries another developer's live production app (`mmcafe`).

### Rollback

Delete `/etc/docker/daemon.json` (or set `"live-restore": false`) and `systemctl reload docker`.
Reverting is itself zero-downtime; it returns the box to today's behaviour, which is the
07-29 failure mode, so it is a last resort rather than a routine undo.

## Residual gaps (stated, not hidden)

- **A container that *exits while the daemon is down* is not restarted.** Restart policies are
  not evaluated during daemon downtime. The 07-29 window was ~2 seconds, so this is narrow —
  but it is not zero, and it is the one part of "stopped and staying stopped" that survives
  this change.
- **64K log-FIFO limit.** If the daemon is down long enough for a container to fill its log
  buffer, the container blocks on write and a full daemon restart is needed to flush it. Only
  bites on extended outages.
- **Patch releases only.** Upgrading dockerd across a minor version (29.6 → 29.7) while
  live-restored can prevent the daemon re-attaching. Docker is not in unattended-upgrades on
  165, so this is a manual-action hazard to document, not an active risk.
- **The panic trigger remains.** Most projects on 165 still build images on the box; VO is the
  exception (CI → GHCR, server only pulls). live-restore makes the panic survivable, it does
  not make it stop happening.

## Follow-through in this repo

Two files currently document the gap as open and would become actively misleading:

- `docker-compose.prod.yml` — the comment on the `app` service's `restart: unless-stopped`
- `deploy/vo-autoheal.sh` — the "WHY THIS EXISTS" header

Both get updated to describe the new division of labour:

| Failure mode | Handled by |
|---|---|
| daemon death / restart | `live-restore` (daemon-level, 165) |
| container crash, host reboot | `restart: unless-stopped` (compose) |
| wedged-but-alive (`unhealthy`) | `HEALTHCHECK` + `deploy/vo-autoheal.sh` (5-min cron) |
| exits *during* daemon downtime | **nothing** — residual gap, recorded above |

`deploy/vo-autoheal.sh` keeps its current behaviour unchanged. Its purpose is narrower than
its header currently implies, not obsolete.

### Working copy

Edits happen in **`~/dev/virtualoffice`**, not `~/Desktop/Project/enshrine HRms`. The Desktop
checkout has 4,045 iCloud-`dataless` tracked files and content reads hang indefinitely
(measured: a `head -c 300` on `docker-compose.prod.yml` was still blocked at 20s and had to be
killed). This matches BamForm and Ops Dashboard, both already moved to `~/dev`.

## Out of scope

- json-file log rotation via `log-opts` (follow-up; would only apply to containers created
  afterwards in any case)
- Moving other projects' builds off 165 into CI — the durable fix for the panic *trigger*
- A stopped-container watchdog — superseded by this change, minus the residual gap above
- Any change to `vo-backup.sh`, the healthcheck, or application code

## Records to update on completion

- `droplet-165-outage-runbook` — currently lists live-restore under "durable fixes not yet
  done"; move it to done with the verification evidence
- `virtualoffice-status` — the 07-29 outage paragraph asserts the gap is open
- A project-local memory pointing at the home memory store — this project's own memory dir is
  empty, which cost a previous session a full round trip to rediscover
