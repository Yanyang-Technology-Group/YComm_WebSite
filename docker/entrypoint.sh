#!/bin/sh
# Container entrypoint: apply schema, seed defaults, bootstrap the owner when
# requested, then serve. Every step is idempotent, so this script is safe to
# re-run on every start (rollbacks, restarts, redeploys).
set -e

echo "==> applying database migrations"
npm run db:migrate

echo "==> seeding default boards / categories / settings"
npm run db:seed

# Optional one-shot owner bootstrap for appliance deploys (Coolify, etc.):
# set YCOMM_OWNER_USERNAME / YCOMM_OWNER_EMAIL / YCOMM_OWNER_PASSWORD on the
# first boot; owner:create refuses to create a second owner, so this stays
# idempotent and is a no-op on every later start. Unset the vars afterwards.
if [ -n "${YCOMM_OWNER_USERNAME:-}" ] && [ -n "${YCOMM_OWNER_EMAIL:-}" ] && [ -n "${YCOMM_OWNER_PASSWORD:-}" ]; then
  echo "==> bootstrapping owner account"
  npm run owner:create || true
fi

echo "==> starting web"
exec npm run start