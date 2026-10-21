# Извличане на AI промптовете - Резюме

## Описание на промените

Всички AI промптове за генериране на хранителни планове и консултации са извлечени от `worker.js` и организирани в отделни файлове за по-лесно управление.

## Структура

### Нова папка с промптове
```
KV/prompts/
├── README.md                          # Документация на промптовете
├── admin_analysis_prompt.txt          # Промпт за анализ на здравословен профил
├── admin_strategy_prompt.txt          # Промпт за определяне на диетична стратегия
├── admin_meal_plan_prompt.txt         # Промпт за генериране на хранителен план
├── admin_summary_prompt.txt           # Промпт за обобщение на плана
├── admin_consultation_prompt.txt      # Промпт за консултационен режим
├── admin_modification_prompt.txt      # Промпт за режим на промяна на плана
└── admin_correction_prompt.txt        # Промпт за корекция на грешки
```

### Актуализирани файлове

1. **KV/upload-kv-keys.sh** - Скриптът е актуализиран да качва всички 7 новите промптове
2. **worker.js** - Добавени коментари за референция към external промптовете

## Как работи

### 1. Версионен контрол
- Всички промптове са в отделни `.txt` файлове в `KV/prompts/`
- Лесно се редактират и се следят промените през Git
- Има README с пълна документация

### 2. Cloudflare KV Storage
- Промптовете се качват в KV storage с `./KV/upload-kv-keys.sh`
- Worker първо проверява за custom промптове в KV
- Ако няма в KV, използва вградените в `getDefaultPromptTemplates()`

### 3. Fallback механизъм
- Функцията `getDefaultPromptTemplates()` в worker.js остава непроменена
- Съдържа същите промптове като backup
- Гарантира, че приложението работи дори ако KV не е налично

### 4. Admin Panel
- Промптовете могат да се редактират през admin панела
- Промените се запазват в KV storage
- "View Standard Prompt" бутонът показва default промптовете

## Ключови принципи (KV Keys)

Всички промптове са достъпни чрез следните KV ключове:

1. `admin_analysis_prompt` - Стъпка 1: Анализ
2. `admin_strategy_prompt` - Стъпка 2: Стратегия
3. `admin_meal_plan_prompt` - Стъпка 3: Хранителен план
4. `admin_summary_prompt` - Стъпка 4: Резюме
5. `admin_consultation_prompt` - Чат: Консултация
6. `admin_modification_prompt` - Чат: Промяна
7. `admin_correction_prompt` - Валидация: Корекция

## Предимства

✅ **Организация**: Промптовете са в отделна папка, не в worker.js  
✅ **Версионен контрол**: Лесно се следят промените през Git  
✅ **Редактиране**: Може да се редактират директно във файловете  
✅ **KV Storage**: Автоматично се качват в Cloudflare KV  
✅ **Backup**: Има fallback в worker.js ако KV не работи  
✅ **Документация**: README с пълна информация за всеки промпт  
✅ **Admin Panel**: Може да се редактират през UI  

## Как да актуализирате промптове

### Метод 1: Редактиране на файловете (препоръчително)
```bash
# 1. Редактирайте файл
nano KV/prompts/admin_analysis_prompt.txt

# 2. Качете промените в KV
./KV/upload-kv-keys.sh

# 3. Commit и push
git add KV/prompts/
git commit -m "Update analysis prompt"
git push
```

### Метод 2: През Admin Panel
1. Отидете на https://aidiet.radilov-k.workers.dev/admin.html
2. Влезте с парола: nutriplan2024
3. Изберете промпт от dropdown
4. Редактирайте и запазете
5. Промените се запазват в KV storage

### Метод 3: Директно в Cloudflare Dashboard
1. Отидете на https://dash.cloudflare.com/
2. Workers & Pages → KV
3. Изберете namespace: page_content
4. Редактирайте съответния ключ

**ВАЖНО**: При метод 2 и 3, актуализирайте и файловете в репото за консистентност!

## Технически детайли

### Формат на placeholders
Промптовете използват специален формат:
- В файловете: `{name}`, `{age}`, `{goal}` и т.н.
- В worker.js при генериране: `${data.name}`, `${data.age}` и т.н.
- Заменят се от `replacePromptVariables()` функцията

### Upload процес
```bash
# Скриптът upload-kv-keys.sh:
1. Проверява за wrangler CLI
2. Проверява автентикация
3. Качва всеки промпт файл в KV
4. Верифицира качените данни
```

### Runtime flow
```javascript
// 1. Worker получава заявка за генериране
// 2. Извиква generateAnalysisPrompt()
// 3. Проверява за custom prompt: env.page_content.get('admin_analysis_prompt')
// 4. Ако няма custom, използва getDefaultPromptTemplates().analysis
// 5. Заменя placeholders с реални данни
// 6. Изпраща към AI модел
```

## Тестване

За да тествате промените:

1. **Syntax check**:
   ```bash
   node -c worker.js
   ```

2. **Local dev**:
   ```bash
   npm run dev
   ```

3. **Upload prompts**:
   ```bash
   ./KV/upload-kv-keys.sh
   ```

4. **Verify in admin panel**:
   - Отворете admin.html
   - Проверете че промптовете се зареждат правилно

## Съвместимост

- ✅ Обратно съвместимо с предишни версии
- ✅ Работи дори ако KV не е конфигурирано (използва fallback)
- ✅ Legacy промптове (`admin_plan_prompt`, `admin_chat_prompt`) все още се поддържат
- ✅ Всички съществуващи функции работят без промени

## Следващи стъпки (за deployer/administrator)

1. ✅ Създадени са всички промпт файлове
2. ✅ Актуализиран е upload скрипта
3. ✅ Добавена е документация
4. ⏭️ Качване на промптовете в Cloudflare KV (изисква wrangler login и deploy)
   - Изпълнете: `./KV/upload-kv-keys.sh`
   - Това ще качи всички промптове в production KV storage
5. ⏭️ Тестване в production environment
   - Проверете admin панела след deploy
   - Тествайте генериране на план с новите промптове

## Заключение

Всички AI промптове са успешно извлечени от `worker.js` и организирани в отделни файлове в `KV/prompts/` директорията. Промените са обратно съвместими и подобряват организацията и управлението на промптовете.
