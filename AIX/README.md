# AIX — AI Chat Interface

AIX е мобилен AI чат интерфейс за безплатни модели от платформата [OpenRouter](https://openrouter.ai).  
Достъпен от `/aix.html` в основната директория на проекта.

---

## Модели

| Модел | ID | Контекст | Силни страни |
|---|---|---|---|
| Gemini 2.5 Flash | `google/gemini-2.5-flash:free` | 1M токена | Документи, превод, естествен разговор |
| Llama 3.3 70B | `meta-llama/llama-3.3-70b-instruct:free` | 128K токена | Код, математика, сложна логика |
| Qwen 2.5 72B | `qwen/qwen-2.5-72b-instruct:free` | 128K токена | Маркетинг, редакция, статии |

---

## API Endpoint

```
POST /api/aix/chat
Content-Type: application/json

{
  "model": "google/gemini-2.5-flash:free",
  "messages": [{ "role": "user", "content": "Здравей" }],
  "systemPrompt": "Optional system instructions",
  "stream": true
}
```

**Отговор (stream: false):**
```json
{ "content": "...", "usage": { "prompt_tokens": 10, "completion_tokens": 80 } }
```

**Отговор (stream: true):** SSE стрийм, OpenAI-compatible `data: {...}\n\n` формат.

---

## Конфигурация

Тайният ключ `OPEN_ROUTER` трябва да е добавен като Cloudflare Worker Secret:

```bash
wrangler secret put OPEN_ROUTER
```

---

## Функции на интерфейса

- **Избор на модел** — 3 карти с описание, swipe/tap
- **Персонализация** — потребителски системен промпт, тон и стил на отговора
- **Авто-профилиране** — системата анализира съобщенията на потребителя и изгражда динамичен психологически профил (формалност, ниво на знания, предпочитан детайл, емоционален тон), използван за персонализиране на отговорите
- **Streaming** — отговорите се изписват в реално време (SSE)
- **Тъмна тема** — mobile-first, glassmorphism дизайн

---

## Файлова структура

```
/aix.html          — основен интерфейс
/AIX/
  README.md        — тази документация
```
