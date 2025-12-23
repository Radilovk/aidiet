# Бързо Ръководство за KV Ключове

## Съдържание на папката KV/

```
KV/
├── README.md                    # Пълна документация (прочети първо)
├── upload-kv-keys.sh            # Скрипт за автоматично качване
├── admin_plan_prompt.txt        # Промпт за генериране на план
├── admin_chat_prompt.txt        # Промпт за чат асистент
└── admin_ai_model.txt           # Избран AI модел
```

## Най-бърз начин за качване

### С скрипта (препоръчително):

```bash
# 1. Уверете се, че сте логнати в wrangler
wrangler login

# 2. Стартирайте скрипта
./KV/upload-kv-keys.sh
```

### Ръчно (чрез командна линия):

```bash
NAMESPACE_ID="81fc0991b2764918b682f9ca170abd4b"

wrangler kv:key put --namespace-id=$NAMESPACE_ID "admin_plan_prompt" --path=KV/admin_plan_prompt.txt
wrangler kv:key put --namespace-id=$NAMESPACE_ID "admin_chat_prompt" --path=KV/admin_chat_prompt.txt
wrangler kv:key put --namespace-id=$NAMESPACE_ID "admin_ai_model" --path=KV/admin_ai_model.txt
```

### Чрез Dashboard:

1. Отидете на: https://dash.cloudflare.com/
2. Workers & Pages → KV → Вашият namespace
3. Add entry за всеки ключ
4. Копирайте съдържанието от .txt файловете

## Проверка след качване

```bash
# Проверете дали всичко е качено
wrangler kv:key list --namespace-id=81fc0991b2764918b682f9ca170abd4b

# Вижте съдържанието на ключ
wrangler kv:key get --namespace-id=81fc0991b2764918b682f9ca170abd4b "admin_plan_prompt"
```

## Следващи стъпки

1. ✅ Качете KV ключовете (виж по-горе)
2. ✅ Deploy на worker-а: `wrangler deploy`
3. ✅ Качете API ключ: `wrangler secret put OPENAI_API_KEY`
4. ✅ Отворете admin панела: `https://aidiet.radilov-k.workers.dev/admin.html`
5. ✅ Тествайте генериране на план

## Важно!

- Файлът `wrangler.toml` вече е обновен с правилния namespace ID
- Admin панелът ще работи след като качите ключовете
- Промените в промптите чрез admin панела се записват директно в KV
- Ако ключовете липсват, worker-ът ще използва вградени по подразбиране стойности

## Нужна помощ?

Прочетете пълната документация в `KV/README.md`
