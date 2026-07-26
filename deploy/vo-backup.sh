#!/usr/bin/env bash
#
# vo-backup.sh — encrypted, off-host-decryptable backups for VirtualOffice.
#
# Two artifacts per run, both encrypted to the "VO Backup" GPG public key:
#   1. the `virtualoffice` Postgres database (pg_dump)
#   2. the `vo_uploads` volume (associate photos, signatures, signed dockets,
#      uploaded client documents) — a DB-only backup would restore to an app
#      whose every file link is dead, so both move together.
#
# The matching PRIVATE key lives only on the owner's Mac
# (~/.vo-backup/vo-backup-PRIVATE.asc), never on this server — so a compromise
# of 165 cannot decrypt these backups. This is the same pattern as
# /root/ims-db-backup.sh, with its own key so the two systems stay isolated.
#
# Restore (on a machine holding the private key):
#   GNUPGHOME=~/.vo-backup/gnupg gpg --decrypt vo-db-YYYYMMDD-HHMM.sql.gz.gpg \
#     | gunzip | docker exec -i virtualoffice-db psql -U virtualoffice virtualoffice
#   GNUPGHOME=~/.vo-backup/gnupg gpg --decrypt vo-uploads-YYYYMMDD-HHMM.tar.gz.gpg \
#     | tar -xzf - -C /var/lib/docker/volumes/virtualoffice_vo_uploads/_data
#
# Installed copy: /root/vo-backup.sh ; canonical copy: this repo's deploy/.
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RECIPIENT=9C120487F0A74206DEDBF0C054245F12B623588B   # VO Backup public key fingerprint
DB_CONTAINER=virtualoffice-db
DB_USER=virtualoffice
DB_NAME=virtualoffice
UPLOADS_VOLUME=virtualoffice_vo_uploads
DEST=/root/backups
KEEP=14                                              # retain this many of each artifact
TAG="[vo-backup]"
ts() { date '+%F %T'; }
stamp=$(date '+%Y%m%d-%H%M')

mkdir -p "$DEST"

# Sanity: the artifact must be a public-key-encrypted OpenPGP message, not
# plaintext. `--list-packets` exits non-zero without the secret key (and
# pipefail would mis-read a piped grep), so capture the output first.
verify_encrypted() {
  local f=$1 packets
  packets=$(gpg --list-packets "$f" 2>/dev/null || true)
  if ! printf '%s' "$packets" | grep -q "pubkey enc packet"; then
    echo "$(ts) $TAG ERROR: $f is not GPG public-key encrypted — removing"
    rm -f "$f"
    return 1
  fi
}

encrypt_to() {   # stdin -> encrypted file; gpg compression off (input is gzipped)
  gpg --batch --yes --trust-model always --compress-algo none \
      --recipient "$RECIPIENT" --encrypt -o "$1"
}

rc_total=0

# --- 1. database ---------------------------------------------------------
db_out="$DEST/vo-db-$stamp.sql.gz.gpg"
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip | encrypt_to "$db_out"; then
  if verify_encrypted "$db_out"; then
    echo "$(ts) $TAG wrote $db_out ($(du -h "$db_out" | cut -f1))"
  else
    rc_total=1
  fi
else
  rc=$?
  echo "$(ts) $TAG ERROR: pg_dump failed rc=$rc"
  rm -f "$db_out"
  rc_total=$rc
fi

# --- 2. uploads volume ---------------------------------------------------
# Resolved via `docker volume inspect` rather than hardcoding /var/lib/docker,
# so this keeps working if the docker root ever moves.
up_out="$DEST/vo-uploads-$stamp.tar.gz.gpg"
up_path=$(docker volume inspect -f '{{ .Mountpoint }}' "$UPLOADS_VOLUME" 2>/dev/null)
if [ -n "$up_path" ] && [ -d "$up_path" ]; then
  if tar -czf - -C "$up_path" . | encrypt_to "$up_out"; then
    if verify_encrypted "$up_out"; then
      echo "$(ts) $TAG wrote $up_out ($(du -h "$up_out" | cut -f1))"
    else
      rc_total=1
    fi
  else
    rc=$?
    echo "$(ts) $TAG ERROR: uploads tar failed rc=$rc"
    rm -f "$up_out"
    rc_total=$rc
  fi
else
  echo "$(ts) $TAG ERROR: volume $UPLOADS_VOLUME not found"
  rc_total=1
fi

# --- retention -----------------------------------------------------------
# Only prunes after the writes above, so a failed run never eats good backups.
for pattern in "vo-db-*.sql.gz.gpg" "vo-uploads-*.tar.gz.gpg"; do
  # shellcheck disable=SC2086
  ls -1t $DEST/$pattern 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"; echo "$(ts) $TAG pruned $old"
  done
done

if [ "$rc_total" -ne 0 ]; then
  echo "$(ts) $TAG FAILED (rc=$rc_total)"
  exit "$rc_total"
fi
echo "$(ts) $TAG done"
