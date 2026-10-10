#!/usr/bin/env bash
# Upload all NutriPlan KV keys from KV/*.txt and KV/prompts/*.txt
set -euo pipefail

NAMESPACE_ID="${KV_NAMESPACE_ID:-81fc0991b2764918b682f9ca170abd4b}"
KV_DIR="KV"
REMOTE_FLAG=()
if [[ "${KV_UPLOAD_REMOTE:-1}" == "1" ]]; then
  REMOTE_FLAG=(--remote)
fi

echo "=========================================="
echo "  NutriPlan KV Upload"
echo "=========================================="
echo "Namespace: $NAMESPACE_ID"
echo ""

if ! command -v wrangler &> /dev/null && ! command -v npx &> /dev/null; then
  echo "❌ wrangler/npx not found"
  exit 1
fi

wr() {
  if command -v wrangler &> /dev/null; then
    wrangler "$@"
  else
    npx wrangler "$@"
  fi
}

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Проверка на wrangler автентикация..."
  if ! wr whoami &> /dev/null; then
    echo "❌ Не сте логнати. Задайте CLOUDFLARE_API_TOKEN или wrangler login"
    exit 1
  fi
fi

upload_key() {
  local key="$1"
  local path="$2"
  echo "📤 $key ← $path"
  wr kv key put --namespace-id="$NAMESPACE_ID" "$key" --path="$path" "${REMOTE_FLAG[@]}"
}

failed=0
uploaded=0

shopt -s nullglob
for file in "$KV_DIR"/*.txt; do
  key="$(basename "$file" .txt)"
  [[ "$key" == "retired-keys" ]] && continue
  if upload_key "$key" "$file"; then
    uploaded=$((uploaded + 1))
  else
    echo "❌ Failed: $key"
    failed=$((failed + 1))
  fi
done

for file in "$KV_DIR"/prompts/*.txt; do
  key="$(basename "$file" .txt)"
  if upload_key "$key" "$file"; then
    uploaded=$((uploaded + 1))
  else
    echo "❌ Failed: $key"
    failed=$((failed + 1))
  fi
done
shopt -u nullglob

# Спрени ключове (KV/retired-keys.txt): изтриват се, ако съществуват.
# Само изброените — друго в namespace-а (клиенти, профили, настройки) не се пипа.
deleted=0
if [[ -f "$KV_DIR/retired-keys.txt" ]]; then
  while IFS= read -r key || [[ -n "$key" ]]; do
    key="${key%%#*}"
    key="$(echo "$key" | tr -d '[:space:]')"
    [[ -z "$key" ]] && continue
    # Ключ, за който има файл, никога не се трие (грешка в списъка не бива да махне жив ключ).
    if [[ -f "$KV_DIR/$key.txt" || -f "$KV_DIR/prompts/$key.txt" ]]; then
      echo "⚠️  $key е в retired-keys.txt, но има файл — пропуснат"
      continue
    fi
    if wr kv key get --namespace-id="$NAMESPACE_ID" "$key" "${REMOTE_FLAG[@]}" &> /dev/null; then
      echo "🗑  $key (спрян ключ)"
      if wr kv key delete --namespace-id="$NAMESPACE_ID" "$key" "${REMOTE_FLAG[@]}" &> /dev/null; then
        deleted=$((deleted + 1))
      else
        echo "❌ Неуспешно изтриване: $key"
        failed=$((failed + 1))
      fi
    fi
  done < "$KV_DIR/retired-keys.txt"
fi

echo ""
echo "=========================================="
echo "  Готово: $uploaded качени, $deleted изтрити, $failed грешки"
echo "=========================================="

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
