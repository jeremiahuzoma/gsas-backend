#!/bin/sh
# Applies pending migrations (never resets or drops anything), optionally
# seeds reference data, then starts the API.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "Seeding reference data (existing rows are left untouched)..."
  node dist-scripts/seed.js
fi

exec node dist/main.js
