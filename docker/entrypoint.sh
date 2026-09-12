#!/bin/sh
# Container entrypoint: apply schema, seed defaults, then serve.
# Every step is idempotent, so this script is safe to re-run on every start.
set -e

echo "==> applying database migrations"
npm run db:migrate

echo "==> seeding default boards / categories / settings"
npm run db:seed

echo "==> starting web"
exec npm run start