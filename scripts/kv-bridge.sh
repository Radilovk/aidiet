#!/usr/bin/env bash
# Мост към KV на Cloudflare: четене, сравнение и запис на КОНФИГУРАЦИОННИ ключове.
# Пуска се от .github/workflows/kv-bridge.yml със секретите на GitHub; резултатът е в лога.
#
# ВАЖНО: репото е публично, а логовете на workflow-ите са видими за всички.
# Затова мостът работи само с конфигурационните ключове admin_* (промптове и настройки
# на админ панела; нови ключове също могат да се създават). Клиенти, профили, имейли,
# абонаменти и чакащи планове (admin_plan_pending) са недостъпни — и за четене, и за запис.
#
# Изключение само за четене: plan-errors показва САМО датата и текста на грешката при
# провалено генериране на план (planGenerationError) — без имена, имейли и отговори.
#
# Употреба: scripts/kv-bridge.sh <list|get|put|delete|diff|plan-errors> [ключ|префикс] [стойност]
set -euo pipefail

NAMESPACE_ID="${KV_NAMESPACE_ID:-81fc0991b2764918b682f9ca170abd4b}"
KV_DIR="${KV_DIR:-KV}"
MAX_PRINT_BYTES="${KV_BRIDGE_MAX_PRINT:-60000}"

wr() {
  if command -v wrangler &> /dev/null; then wrangler "$@"; else npx wrangler "$@"; fi
}

repo_file_for() {
  local key="$1"
  if [[ -f "$KV_DIR/$key.txt" ]]; then echo "$KV_DIR/$key.txt"
  elif [[ -f "$KV_DIR/prompts/$key.txt" ]]; then echo "$KV_DIR/prompts/$key.txt"
  fi
}

is_allowed() {
  # Всички конфигурационни ключове admin_* (съществуващи и нови) освен тези с лични данни.
  # Клиенти, профили, имейли, абонаменти (client:, user_profile:, …) са извън префикса.
  local key="$1"
  [[ "$key" =~ ^admin_[a-z0-9_]+$ ]] || return 1
  [[ "$key" == "admin_plan_pending" ]] && return 1
  return 0
}

require_allowed() {
  if ! is_allowed "$1"; then
    echo "::error::Ключът '$1' не е в разрешения списък на моста (само конфигурационни ключове admin_*)."
    exit 2
  fi
}

kv_get() { wr kv key get --namespace-id="$NAMESPACE_ID" "$1" --remote; }

action="${1:-}"
arg="${2:-}"
value="${3:-}"

case "$action" in
  list)
    prefix="${arg:-admin_}"
    [[ "$prefix" == admin_* ]] || { echo "::error::Префиксът трябва да започва с admin_"; exit 2; }
    echo "Ключове с префикс '$prefix' (само разрешените; стойности не се показват):"
    wr kv key list --namespace-id="$NAMESPACE_ID" --prefix="$prefix" --remote \
      | node -e '
          let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
            const m=s.match(/\[[\s\S]*\]/); const arr=m?JSON.parse(m[0]):[];
            for (const k of arr) console.log(k.name);
          });' \
      | while IFS= read -r key; do
          if is_allowed "$key"; then
            f="$(repo_file_for "$key")"
            echo "  $key  $([[ -n "$f" ]] && echo "[файл: $f]" || echo "[само в KV]")"
          fi
        done
    ;;
  get)
    require_allowed "$arg"
    out="$(kv_get "$arg")"
    bytes=${#out}
    echo "=== $arg ($bytes знака) ==="
    printf '%s\n' "${out:0:$MAX_PRINT_BYTES}"
    [[ $bytes -gt $MAX_PRINT_BYTES ]] && echo "... (изрязано при $MAX_PRINT_BYTES знака)"
    echo "=== край ==="
    ;;
  put)
    require_allowed "$arg"
    f="$(repo_file_for "$arg")"
    if [[ -n "$f" ]]; then
      echo "::warning::За '$arg' има файл ($f). Записът в KV е валиден веднага, но следващият деплой на KV/ ще го презапише от файла — за траен ефект промени и файла."
    fi
    [[ -n "$value" ]] || { echo "::error::Липсва стойност"; exit 2; }
    tmp="$(mktemp)"; printf '%s' "$value" > "$tmp"
    old="$(kv_get "$arg" 2>/dev/null || true)"
    echo "Предишна стойност (${#old} знака):"; printf '%s\n' "${old:0:2000}"
    wr kv key put --namespace-id="$NAMESPACE_ID" "$arg" --path="$tmp" --remote
    rm -f "$tmp"
    echo "Записано: $arg (${#value} знака)"
    ;;
  delete)
    require_allowed "$arg"
    f="$(repo_file_for "$arg")"
    if [[ -n "$f" ]]; then
      echo "::error::За '$arg' има файл ($f) — деплоят би го върнал. Махни го през KV/retired-keys.txt."
      exit 3
    fi
    old="$(kv_get "$arg" 2>/dev/null || true)"
    echo "Изтривам '$arg'. Съдържание до сега (${#old} знака):"; printf '%s\n' "${old:0:2000}"
    wr kv key delete --namespace-id="$NAMESPACE_ID" "$arg" --remote
    ;;
  plan-errors)
    # Провалените генерирания: само кога и защо. Клиентите не се назовават.
    keys="$(mktemp)"
    wr kv key list --namespace-id="$NAMESPACE_ID" --prefix="client:" --remote \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/\[[\s\S]*\]/);const a=m?JSON.parse(m[0]):[];process.stdout.write(JSON.stringify(a.map(k=>k.name)))})' > "$keys"
    echo "Клиентски записи: $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$keys")"
    # bulk get приема до 100 ключа наведнъж.
    out="$(mktemp)"; : > "$out"
    n="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$keys")"
    for ((i=0; i<n; i+=100)); do
      part="$(mktemp)"
      node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(a.slice(+process.argv[2],+process.argv[2]+100)))' "$keys" "$i" > "$part"
      wr kv bulk get --namespace-id="$NAMESPACE_ID" "$part" --remote 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/\{[\s\S]*\}/);let o={};try{o=JSON.parse(m?m[0]:"{}")}catch{}process.stdout.write(JSON.stringify(o)+"\n")})' >> "$out"
      rm -f "$part"
    done
    node -e '
      const lines=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
      const rows=[]; let total=0;
      for (const l of lines) for (const v of Object.values(JSON.parse(l))) {
        total++;
        let c=v; try { if (typeof c==="string") c=JSON.parse(c); else if (c && typeof c.value==="string") c=JSON.parse(c.value); } catch { continue; }
        if (!c) continue;
        const warn=(c.plan&&Array.isArray(c.plan.generationWarnings)?c.plan.generationWarnings:[]).filter(w=>/≠ схема|≠ цел|под безопасния|под минималната|твърде малко|медицински прагове/.test(String(w)));
        if (!c.planGenerationError && !warn.length) continue;
        const clean=t=>String(t).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,"[имейл]");
        const msg=[c.planGenerationError?clean(c.planGenerationError).slice(0,2000):"", ...warn.slice(0,8).map(w=>"  ⚠ "+clean(w).slice(0,300))].filter(Boolean).join("\n");
        rows.push({ at: c.planUpdatedAt||"", status: c.planStatus||"", msg: msg+`\n  двигател: ${c.plan&&c.plan.planEngine||"—"}, генериран: ${c.plan&&c.plan._meta&&c.plan._meta.generatedAt||"—"}` });
      }
      rows.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
      console.log(`Прочетени: ${total}. С грешка или блокиращо предупреждение: ${rows.length}`);
      for (const r of rows.slice(0,10)) console.log(`\n— ${r.at} [${r.status}]\n${r.msg}`);
    ' "$out"
    rm -f "$out"
    rm -f "$keys"
    ;;
  diff)
    # Сравнява файловете в репото с живите стойности в KV (напр. редактирани от админ панела).
    differ=0
    shopt -s nullglob
    for f in "$KV_DIR"/*.txt "$KV_DIR"/prompts/*.txt; do
      key="$(basename "$f" .txt)"
      [[ "$key" == "retired-keys" ]] && continue
      live="$(mktemp)"
      if kv_get "$key" > "$live" 2>/dev/null; then
        # wrangler добавя нов ред накрая; сравнението игнорира крайните празни редове.
        if diff -q <(sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$f") <(sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$live") > /dev/null; then
          echo "= $key  (същото)"
        else
          differ=$((differ+1))
          echo "~ $key  (РАЗЛИЧНО: репо ← → KV)"
          diff -u --label "репо:$key" --label "kv:$key" "$f" "$live" | head -80 || true
        fi
      else
        differ=$((differ+1))
        echo "! $key  (няма в KV)"
      fi
      rm -f "$live"
    done
    echo "Разлики: $differ"
    ;;
  *)
    echo "Употреба: $0 <list|get|put|delete|diff> [ключ|префикс] [стойност]" >&2
    exit 1
    ;;
esac
