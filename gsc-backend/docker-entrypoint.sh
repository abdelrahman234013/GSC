#!/bin/sh

set -e

# prisma.config.cjs no longer hard-fails on a missing DATABASE_URL (it must not,
# or `docker build` breaks — see the note there). So check it here, where a
# database genuinely IS required, rather than letting migrate deploy fail with a
# vaguer error.
if [ -z "$DATABASE_URL" ] && [ "$SKIP_MIGRATIONS" != "true" ]; then
  echo "FATAL: DATABASE_URL is not set. Cannot apply migrations." >&2
  exit 1
fi

if [ "$SKIP_MIGRATIONS" = "true" ]; then
  echo "SKIP_MIGRATIONS=true — not applying migrations."
else
  echo "Applying database migrations…"
  npx prisma migrate deploy
  echo "Migrations up to date."
fi


exec "$@"
