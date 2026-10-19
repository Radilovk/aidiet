#!/usr/bin/env bash
# The studios' D1 database as STUDIO_DB in wrangler.toml (in CI only, before deploy; the id comes from
# `node scripts/studio-admin.mjs ensure-db`). Nothing is written when it is there already. Staging (PR previews)
# gets no binding: the studios' real data stays out of it.
set -euo pipefail
id="${1:?D1 id}"
grep -q 'binding = "STUDIO_DB"' wrangler.toml && exit 0
cat >> wrangler.toml <<TOML

[[d1_databases]]
binding = "STUDIO_DB"
database_name = "studios"
database_id = "$id"

[[env.production.d1_databases]]
binding = "STUDIO_DB"
database_name = "studios"
database_id = "$id"
TOML
echo "STUDIO_DB → $id"
