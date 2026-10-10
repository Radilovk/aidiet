#!/usr/bin/env bash
# Мост към Cloudflare за Worker-а: състояние, проверка на липсващи секрети/променливи,
# опашки, версии, пробен деплой и управление на секрети. Пуска се от
# .github/workflows/cf-bridge.yml със секретите на GitHub. KV ключовете са в scripts/kv-bridge.sh.
#
# Репото е публично — логовете и входовете на workflow-ите са видими за всички:
#  * печатат се само ИМЕНА на секрети, никога стойности;
#  * стойност на секрет НЕ минава през вход: secret-put я взема от GitHub секрет
#    CF_SECRET_<ИМЕ> (създава го собственикът в Settings → Secrets and variables → Actions),
#    secret-generate създава случайна стойност, която никой не вижда;
#  * вече съществуващ секрет се сменя само с изрично "overwrite";
#  * защитени са имената на самия мост (CLOUDFLARE_*, CF_*) и ключовете за вход на worker-а
#    не се трият/генерират наново без overwrite;
#  * не са включени операции, които унищожават акаунта (изтриване на worker, namespace, опашка).
# Разрешено изрично от собственика на репото.
#
# Употреба: scripts/cf-bridge.sh <status|secrets-check|queues|deployments|dry-run|secret-put|secret-generate|secret-delete> [ИМЕ] [overwrite]
set -euo pipefail

CF_ENV="${CF_ENV:-production}"
ENTRY="${WORKER_ENTRY:-worker.entry.js}"
TOML="${WRANGLER_TOML:-wrangler.toml}"

# Свързвания (bindings), не секрети.
BINDINGS_RE='^(PEP_DB|PLAN_QUEUE|FITNESS_KV)$'
# Имена, които мостът никога не пипа (токенът на самия мост).
PROTECTED_RE='^(CLOUDFLARE_.*|CF_.*)$'
# Секрети, които не се трият от моста (без тях worker-ът не работи / админ достъпът пада).
NO_DELETE_RE='^(ADMIN_SECRET|FIREBASE_PROJECT_ID)$'

check_name() {
  local n="$1"
  [[ "$n" =~ ^[A-Z][A-Z0-9_]{2,63}$ ]] || { echo "::error::Невалидно име '$n' (главни букви, цифри, _)"; exit 2; }
  [[ "$n" =~ $PROTECTED_RE ]] && { echo "::error::Името '$n' е защитено"; exit 2; }
  return 0
}

wr() {
  if command -v wrangler &> /dev/null; then wrangler "$@"; else npx wrangler "$@"; fi
}

secret_names() {
  # wrangler печата JSON масив [{"name":"X","type":"secret_text"}] — взимат се само имената.
  wr secret list --env "$CF_ENV" --format json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/\[[\s\S]*\]/);for(const k of (m?JSON.parse(m[0]):[]))console.log(k.name)})'
}

toml_vars() {
  awk -v sect="[env.$CF_ENV.vars]" '
    $0==sect {on=1; next}
    /^\[/ {on=0}
    on && /^[A-Z][A-Z0-9_]*[ ]*=/ {split($0,a,"="); gsub(/ /,"",a[1]); print a[1]}' "$TOML"
}

needed_names() {
  grep -ohE "env\.[A-Z][A-Z0-9_]+" "$ENTRY" | sed 's/^env\.//' | sort -u | grep -Ev "$BINDINGS_RE" || true
}

case "${1:-}" in
  status)
    echo "=== Акаунт ==="; wr whoami 2>&1 | grep -vE "^$|Proxy" | head -20
    echo; echo "=== Секрети на worker-а ($CF_ENV) — само имена ==="; secret_names | sed 's/^/  /'
    echo; echo "=== Променливи от $TOML ==="; toml_vars | sed 's/^/  /'
    echo; echo "=== Последни версии ==="; wr deployments list --env "$CF_ENV" 2>&1 | grep -vE "Proxy" | tail -15
    ;;
  secrets-check)
    have="$(mktemp)"; { secret_names; toml_vars; } | sort -u > "$have"
    echo "Какво чете кодът ($ENTRY) спрямо това, което е зададено в Cloudflare ($CF_ENV):"
    missing=0
    while IFS= read -r n; do
      if grep -qx "$n" "$have"; then echo "  ✓ $n"; else echo "  ✗ $n  — липсва"; missing=$((missing+1)); fi
    done < <(needed_names)
    rm -f "$have"
    echo
    echo "Липсващи: $missing (част може да са по избор — Stripe, Acuity, GitHub, резервни AI доставчици)."
    ;;
  queues)
    wr queues list 2>&1 | grep -v Proxy
    ;;
  deployments)
    wr deployments list --env "$CF_ENV" 2>&1 | grep -v Proxy | tail -40
    ;;
  dry-run)
    wr deploy --env "$CF_ENV" --dry-run --outdir "$(mktemp -d)" 2>&1 | grep -v Proxy
    ;;
  secret-put)
    name="${2:-}"; check_name "$name"
    value="${CF_SECRET_VALUE:-}"
    if [[ -z "$value" ]]; then
      echo "::error::Няма стойност. Създай GitHub секрет CF_SECRET_$name (Settings → Secrets and variables → Actions) и пусни отново."
      exit 3
    fi
    if secret_names | grep -qx "$name" && [[ "${3:-}" != "overwrite" ]]; then
      echo "::error::Секретът $name вече съществува. Пусни с overwrite, ако наистина искаш да го смениш."
      exit 3
    fi
    printf '%s' "$value" | wr secret put "$name" --env "$CF_ENV" > /dev/null
    echo "Записан секрет $name (${#value} знака). Стойността не се показва."
    ;;
  secret-generate)
    name="${2:-}"; check_name "$name"
    if secret_names | grep -qx "$name" && [[ "${3:-}" != "overwrite" ]]; then
      echo "::error::Секретът $name вече съществува. Пусни с overwrite, ако наистина искаш да го смениш."
      exit 3
    fi
    value="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
    printf '%s' "$value" | wr secret put "$name" --env "$CF_ENV" > /dev/null
    echo "Създаден секрет $name със случайна стойност (${#value} знака). Никой не я вижда — ползва се само от worker-а."
    ;;
  secret-delete)
    name="${2:-}"; check_name "$name"
    if [[ "$name" =~ $NO_DELETE_RE ]]; then
      echo "::error::$name не се трие през моста (без него worker-ът или админ достъпът спират). Направи го ръчно в Dashboard."
      exit 3
    fi
    secret_names | grep -qx "$name" || { echo "Секретът $name не съществува — няма какво да се трие."; exit 0; }
    wr secret delete "$name" --env "$CF_ENV" --force > /dev/null 2>&1 || { echo y | wr secret delete "$name" --env "$CF_ENV" > /dev/null; }
    echo "Изтрит секрет $name."
    ;;
  *)
    echo "Употреба: $0 <status|secrets-check|queues|deployments|dry-run|secret-put|secret-generate|secret-delete> [ИМЕ] [overwrite]" >&2
    exit 1
    ;;
esac
