#!/usr/bin/env bash
#
# Offsite-aware backup for the self-hosted deployment.
#
#   * Postgres: pg_dump (or dump entire cluster to a single SQL file)
#   * Uploads:   incremental sync to a target directory
#   * Retention: keep N dailies, prune the rest
#
# Usage:
#   BACKUP_TARGET=/mnt/backups/ycomm ./scripts/backup.sh
#
# Recommended cron line (daily at 03:17):
#   17 3 * * * BACKUP_TARGET=/mnt/backups/ycomm /opt/ycomm/scripts/backup.sh >> /var/log/ycomm-backup.log 2>&1
#
# Test the restore path at least once a month: the dump is only worth as much
# as your proof that it restores.
set -euo pipefail

BACKUP_TARGET="${BACKUP_TARGET:?set BACKUP_TARGET (e.g. /mnt/backups/ycomm)}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%F_%H%M%S)"
TODAY="$(date +%F)"

mkdir -p "$BACKUP_TARGET/db" "$BACKUP_TARGET/uploads"

# ---- database -------------------------------------------------------------
if [ -n "${DATABASE_URL:-}" ]; then
  echo "==> dumping database to $BACKUP_TARGET/db/ycomm-$STAMP.sql"
  # pg_dump 会把 --dbname 里的一切当参数，注意 URL 需 shell 安全引用
  pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc \
    -f "$BACKUP_TARGET/db/ycomm-$STAMP.dump"
else
  echo "==> DATABASE_URL not set; skipping database dump (run inside the compose service or pass it)"
fi

# ---- uploads (rsync hardlink rotation) ------------------------------------
if [ -d "${UPLOAD_DIR:-./uploads}" ]; then
  echo "==> syncing uploads into $BACKUP_TARGET/uploads/$TODAY"
  mkdir -p "$BACKUP_TARGET/uploads/$TODAY"
  rsync -a --link-dest="$BACKUP_TARGET/uploads/previous" \
    "${UPLOAD_DIR:-./uploads}/" "$BACKUP_TARGET/uploads/$TODAY/"
  # rotate the hardlink anchor: previous -> this snapshot
  rm -f "$BACKUP_TARGET/uploads/previous"
  ln -s "$TODAY" "$BACKUP_TARGET/uploads/previous"
else
  echo "==> no uploads dir found; skipping"
fi

# ---- retention ------------------------------------------------------------
echo "==> pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_TARGET/db" -name 'ycomm-*.dump' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_TARGET/uploads" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf {} + 2>/dev/null || true

echo "==> backup complete: $BACKUP_TARGET"