# Cloudflare KV Keys для NutriPlan

Това са начални стойности за KV ключовете, използвани от admin панела и worker-а.

## KV Namespace ID
```
81fc0991b2764918b682f9ca170abd4b
```

## Ключове и файлове

| KV Ключ | Файл | Описание |
|---------|------|----------|
| `admin_plan_prompt` | `admin_plan_prompt.txt` | AI промпт шаблон за генериране на хранителен план |
| `admin_chat_prompt` | `admin_chat_prompt.txt` | AI промпт шаблон за чат асистент |
| `admin_ai_model` | `admin_ai_model.txt` | Избран AI модел (openai/gemini/mock) |

## Как да качите ключовете ръчно

### Метод 1: Чрез Wrangler CLI

```bash
# Качете admin_plan_prompt
wrangler kv:key put --namespace-id=81fc0991b2764918b682f9ca170abd4b \
  "admin_plan_prompt" --path=KV/admin_plan_prompt.txt

# Качете admin_chat_prompt
wrangler kv:key put --namespace-id=81fc0991b2764918b682f9ca170abd4b \
  "admin_chat_prompt" --path=KV/admin_chat_prompt.txt

# Качете admin_ai_model
wrangler kv:key put --namespace-id=81fc0991b2764918b682f9ca170abd4b \
  "admin_ai_model" --path=KV/admin_ai_model.txt
```

### Метод 2: Чрез Cloudflare Dashboard

1. Отидете на: https://dash.cloudflare.com/
2. Изберете вашия акаунт
3. Workers & Pages → KV
4. Изберете namespace с ID: `81fc0991b2764918b682f9ca170abd4b`
5. Кликнете "Add entry"
6. За всеки ключ:
   - Въведете Key name (напр. `admin_plan_prompt`)
   - Копирайте съдържанието от съответния .txt файл
   - Кликнете "Add"

### Метод 3: Чрез скрипт (автоматизирано)

Може да използвате този bash скрипт:

```bash
#!/bin/bash
NAMESPACE_ID="81fc0991b2764918b682f9ca170abd4b"

# Качете всички ключове
for file in KV/*.txt; do
  key=$(basename "$file" .txt)
  echo "Качване на $key..."
  wrangler kv:key put --namespace-id=$NAMESPACE_ID "$key" --path="$file"
done

echo "Всички ключове са качени успешно!"
```

## Проверка на ключовете

Проверете дали ключовете са качени:

```bash
# Проверете admin_plan_prompt
wrangler kv:key get --namespace-id=81fc0991b2764918b682f9ca170abd4b "admin_plan_prompt"

# Проверете admin_chat_prompt
wrangler kv:key get --namespace-id=81fc0991b2764918b682f9ca170abd4b "admin_chat_prompt"

# Проверете admin_ai_model
wrangler kv:key get --namespace-id=81fc0991b2764918b682f9ca170abd4b "admin_ai_model"
```

## Променливи в промптите

Промптите използват следните променливи, които се заместват автоматично от worker-а:

- `{name}` - Име на потребителя
- `{gender}` - Пол
- `{age}` - Възраст
- `{height}` - Ръст
- `{weight}` - Тегло
- `{goal}` - Цел
- `{lossKg}` - Килограми за сваляне (ако има)
- `{sleepHours}` - Часове сън
- `{chronotype}` - Хронотип
- `{dailyActivityLevel}` - Ниво на дневна активност
- `{stressLevel}` - Ниво на стрес
- `{sportActivity}` - Спортна активност
- `{waterIntake}` - Прием на вода
- `{overeatingFrequency}` - Честота на прекомерно хранене
- `{eatingHabits}` - Хранителни навици
- `{dietPreference}` - Диетични предпочитания
- `{dietDislike}` - Храни, които не харесва
- `{dietLove}` - Любими храни
- `{medicalConditions}` - Медицински състояния
- `{medications}` - Лекарства

## Редактиране на промптите

След като качите начални стойности, можете да редактирате промптите чрез:

1. **Admin панел** - Отидете на `/admin.html` (парола по подразбиране: `nutriplan2024`)
2. **Cloudflare Dashboard** - Ръчно през KV интерфейса
3. **Wrangler CLI** - `wrangler kv:key put ...`

Промените ще бъдат автоматично използвани от worker-а при следващото генериране на план или чат.

## Важни бележки

- KV ключовете се четат само при генериране на нов план/чат
- Ако ключ липсва, worker-ът използва вградени по подразбиране стойности
- Admin панелът синхронизира промените в KV автоматично
- За production използване препоръчваме server-side authentication вместо client-side парола
