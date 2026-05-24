# NutriPlan — Пълно описание на проекта

> **Версия:** 3.0 &nbsp;|&nbsp; **Последна актуализация:** 2026-05-24  
> **Репозитория:** [Radilovk/aidiet](https://github.com/Radilovk/aidiet)  
> **Live:** [aidiet.radilov-k.workers.dev](https://aidiet.radilov-k.workers.dev)  
> **Android APK:** com.biocode.nutriplan (Google Play)

---

## 1. Идея и визия

**NutriPlan** е персонализирана здравна платформа, която съчетава екип от реални специалисти с мощен AI алгоритъм. Идеята е да предложи на всеки потребител комплексна програма за здраве — не само диета, а цялостна трансформация на начина на живот.

### Ключови принципи

| Принцип | Описание |
|---------|---------|
| **Персонализация** | Всеки план е уникален — изграден от 30+ критерия и хиляди корелации |
| **Комплексност** | Хранене + психология + добавки + физическа активност в един план |
| **Privacy-first** | Всички лични данни се съхраняват само локално в браузъра/устройството |
| **AI + човек** | AI алгоритъмът работи заедно с реален екип от специалисти |
| **Непрекъсната подкрепа** | 24/7 AI консултант, запознат с профила и плана на клиента |
| **Геймификация** | Ежедневно проследяване на напредъка, звезди и мотивационни елементи |

### Целева аудитория

- Хора, желаещи да отслабнат здравословно
- Хора с хронични заболявания, нуждаещи се от специализирана диета
- Спортисти, търсещи оптимизация на хранене и представяне
- Хора под стрес с емоционално хранене
- Всеки, търсещ цялостна промяна на начина на живот

---

## 2. Функционалности

### 2.1 Въпросник за профилиране

**Файл:** `questionnaire2.html`

Интерактивен здравен въпросник с динамично разклонение на въпроси (conditional logic). Събира над 30 критерия:

- Лични данни (възраст, пол, тегло, ръст)
- Здравословни цели (отслабване, качване на маса, поддържане, лечебна диета)
- Медицинска история (заболявания, алергии, лекарства)
- Хранителни навици и предпочитания
- Ниво на физическа активност
- Сън и стрес
- Психологически профил (емоционално хранене)
- Хранителни добавки
- Бюджет и наличност на продукти

**Технически особености:**
- Mobile-first дизайн с прогрес индикатор
- Входна валидация за всяко поле
- Данните се изпращат към backend за асинхронна генерация на план
- При незавършен план → пренасочва към `plan-pending.html`

---

### 2.2 7-Степенен AI пайплайн за генерация на план

**Файл:** `worker.js` (backend), `analysis.html` (frontend polling)

Генерацията на план е **асинхронен 4-стъпков пайплайн** с общо 8 AI заявки:

```
Стъпка 1 (Анализ)  →  Стъпка 2 (Стратегия)  →  Стъпка 3 (Хранителен план)  →  Стъпка 4 (Обобщение)
```

| Стъпка | Промпт файл | Изход |
|--------|------------|-------|
| **1 — Задълбочен здравен анализ** | `KV/prompts/admin_analysis_prompt.txt` | `macroGrams`, `macroRatios`, `nutritionalNeeds`, метаболитен профил, BMR/TDEE |
| **2 — Диетична стратегия** | `KV/prompts/admin_strategy_prompt.txt` | `adjustedMacroGrams`, стратегия, приоритети |
| **3 — 7-дневен хранителен план** | `KV/prompts/admin_meal_plan_prompt.txt` | 7 дни × 3–5 хранения, калории, съставки, рецепти |
| **4 — Обобщение и финал** | `KV/prompts/admin_summary_prompt.txt` | препоръки, забранени храни, психологически съвети, добавки |

**Поддържани AI модели:**
- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
- Google: `gemini-pro`, `gemini-1.5-pro`, `gemini-2.0-flash-exp`

**Инфраструктура:**
- Jobs се поставят в **Cloudflare Queue** (`plan-generation`) с `visibility_timeout_ms=900000` (15 мин)
- Фронтендът поллва `GET /api/client-plan-status` докато планът не е готов
- Планът преминава през одобрение от администратор преди да е видим за клиента

---

### 2.3 Персонализиран хранителен план

**Файл:** `plan.html`

Основното съдържание на платформата — визуализация и взаимодействие с генерирания план.

**Елементи на плана:**
- 7-дневна навигация (chip бутони)
- Meal карти с: тип хранене, час, наименование на ястието, тегло, калории, описание, съставки, рецепта
- Accordion секции: препоръчани храни, забранени храни, психологически съвети, хранителни добавки, физически активности
- Info modals за детайли на всяко ястие
- PDF експорт на плана (jsPDF 2.5.1) с поддръжка на кирилица

**Геймификационни елементи в план:**
- Бутони за отбелязване на изядено хранене (Time Lock — активни само след определен час)
- Логване на допълнителни хранения (снимка или ръчно въвеждане)
- Сутрешен и вечерен check-in (сън, вода, активност, емоционален баланс)
- Дневна оценка (0–5 звезди) с анимации при печелене
- Хаптична обратна връзка (вибрации) при взаимодействие

---

### 2.4 24/7 AI Консултант (Чат)

**Файл:** `plan.html` (чат модул), `worker.js` (`/api/chat`)

Интелигентен AI асистент, запознат с целия профил и план на клиента.

**Характеристики:**
- Роля: диетолог + психолог + здравен асистент
- Контекст: изпраща userData + userPlan + chatHistory при всяка заявка
- Поддържа история на разговора (съхранена в localStorage)
- Може да предлага модификации на плана след дискусия и потвърждение
- Real-time streaming отговори с хаптична обратна връзка при тайпинг
- Достъпен от всеки таб на приложението

**API:** `POST /api/chat`

```json
{
  "message": "Може ли да ям банани?",
  "userData": { ... },
  "userPlan": { ... },
  "conversationHistory": [ ... ],
  "mode": "consultation"
}
```

---

### 2.5 Геймификационен модул

**Файл:** `plan.html` (секция *GAMIFICATION MODULE*), `game-analytics.html`, `local-scheduler.js`, `quick-answer.html`

Пълна система за дневно проследяване на напредъка.

#### Алгоритъм за дневна оценка

```
totalMax = (брой хранения × 10) + 40 wellness точки

Звезди:
  ≥100% и без блокери → ★★★★★
  ≥ 80%               → ★★★★
  ≥ 55%               → ★★★
  ≥ 30%               → ★★
  >  0%               → ★
  =  0%               → няма данни
```

**Wellness точки (max 40):**
| Критерий | Точки |
|---------|-------|
| Добър сън | 10 |
| Вода ≥ 2 л | 10 |
| Ниво активност 3/3 | 10 |
| Емоционален баланс 3/3 | 10 |

**Блокери за 5★:** не всички хранения отбелязани, калориен излишък >10%, лош сън, ниска вода, ниска активност, вредни храни.

#### Time Lock система
Бутоните за отбелязване се активират само след определен час (напр. Закуска → 06:00, Обяд → 12:00, Вечеря → 18:00). За минали дни — всички бутони активни.

#### Локални известия (push notifications)
- **Файл:** `local-scheduler.js`, `sw.js`, `quick-answer.html`
- Напомнящи нотификации за хранения, вода, сутрешен/вечерен check-in
- Нотификациите съдържат бутони за бърз отговор (да/не) без отваряне на приложението
- Отговорите се записват директно в `localStorage.gameData` без backend заявки
- Работи изцяло офлайн чрез Service Worker

---

### 2.6 Здравен анализ и прогнози

**Файл:** `analysis.html`

AI-базиран здравен анализ на база всички данни на потребителя.

**Съдържание:**
- Текущо здравословно състояние (score 0–100)
- Анализ на рискови фактори
- Прогноза за 1 година: песимистичен сценарий (без промяна) vs. оптимистичен (при спазване на плана)
- Корелации между сън, стрес, хранене и здраве
- Визуализация на седмичния прогрес

**Scoring:**
- `analysis.currentHealthStatus.score` (от AI) с 10% корекция надолу (вградена в промпта)
- Минимум: 15 (живият човек никога не е на нула)
- Fallback: `score = 100 − avg(severityValues)`

---

### 2.7 Профил

**Файл:** `profile.html`

Управление на потребителски профил и настройки.

- Профилна снимка (компресирана до JPEG 0.85 quality, max 1600px)
- Лична информация и цели
- Drive backup на данните
- Настройки за известия
- История на плановете
- Опция за изход (logout)

---

### 2.8 Насоки и препоръки

**Файл:** `guidelines.html`

Образователна секция с:
- Общи хранителни насоки
- Специфични препоръки за конкретни заболявания
- Статии за здравословен начин на живот

---

### 2.9 XBody модул

**Файл:** `xbody.html`, `xbody-manifest.json`, `xbody-sw.js`

Самостоятелен PWA модул за партньора XBody:
- Отделен manifest с уникален `id: /xbody.html` и scope
- Интеграция с Acuity Scheduling (iframe за записване на час)
- Отделни Service Worker и иконки, за да не се слива с основното NutriPlan PWA
- Превод на Acuity iframe чрез `worker.js` proxy (`/schedule.php`)

---

### 2.10 Административен панел

**Файл:** `admin.html`

Управление на платформата от администратора:
- Одобрение на генерирани планове преди изпращане до клиенти
- Управление на AI промпти (plan, chat, modification, analysis, strategy, summary)
- Конфигурация на AI провайдър и модел (OpenAI / Gemini)
- Управление на food mainlist, whitelist, blacklist
- Преглед на AI логове
- Управление на клиентски профили и въпросници

---

### 2.11 PWA и Android APK

**Файл:** `manifest.json`, `sw.js`, `capacitor-shell/`, `capacitor.config.json`

- **PWA:** Инсталируем от браузъра на Android и iOS
- **Android APK:** Capacitor shell (`com.biocode.nutriplan`) — достъпен в Google Play
- **Service Worker:** Кешира HTML, JS, CSS и иконки за офлайн работа
- **Native backup:** `native-backup.js` — синхронизира localStorage между рестарти на APK
- **Push нотификации:** VAPID-базирани push нотификации за Android Chrome и PWA

---

## 3. Архитектура

### 3.1 Обща схема

```
┌──────────────────────────────────────────────────────────────┐
│                         КЛИЕНТ                                │
│                                                               │
│  ┌────────────┐   ┌────────────┐   ┌──────────────────────┐ │
│  │ index.html │──▶│quest2.html │──▶│      plan.html       │ │
│  │  (лендинг) │   │(въпросник) │   │ (план + чат + gamif) │ │
│  └────────────┘   └─────┬──────┘   └──────────┬───────────┘ │
│                          │                      │             │
│  ┌────────────┐   ┌──────┴──────┐   ┌──────────┴──────────┐ │
│  │profile.html│   │analysis.html│   │  guidelines.html    │ │
│  └─────┬──────┘   └──────┬──────┘   └─────────────────────┘ │
│        │                  │                                   │
│   localStorage       localStorage                             │
│   (userData,         (gameData,                               │
│    dietPlan,          chatHistory,                            │
│    chatHistory)       pushSubscription)                       │
└───────────────────────────┬──────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE WORKER (worker.js)                │
│                                                               │
│  /api/generate-plan-async  → Queue (PLAN_QUEUE)              │
│  /api/client-plan-status   → KV (status polling)            │
│  /api/chat                 → AI Model (stateless)            │
│  /api/auth/social          → Firebase JWKS verify           │
│  /schedule.php             → Acuity iframe proxy            │
│  /api/push-subscribe       → VAPID push subscription        │
│                                                               │
│  KV Storage (page_content):                                  │
│   auth:{uid} → session     food_mainlist → []               │
│   plan:{userId} → plan     food_whitelist → []              │
│   status:{userId} → {}     admin_*_prompt → string         │
│                                                               │
│  Cloudflare Queue (plan-generation):                         │
│   max_batch_size=1 · visibility_timeout=15min               │
└──────────────────────────┬───────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  OpenAI API  │ │ Google Gemini│ │ Firebase Auth │
    │  gpt-4o-mini │ │  gemini-pro  │ │  (Google JWKS)│
    └──────────────┘ └──────────────┘ └──────────────┘
```

---

### 3.2 SPA Shell (app.js + app.html)

Основното навигационно обвиване е SPA с iframe tabs:

```
app.html (shell)
  ├── iframe: index.html     (tab: home)
  ├── iframe: plan.html      (tab: plan)
  ├── iframe: guidelines.html (tab: guidelines)
  ├── iframe: profile.html   (tab: profile)
  └── iframe: game-analytics.html (tab: analytics)
```

**Комуникация shell ↔ iframe:** postMessage с prefixes `NUTRIPLAN_SWITCH_TAB`, `NUTRIPLAN_NAVIGATE`, `NUTRIPLAN_LOGOUT`, `NUTRIPLAN_OPEN_CHAT`, `NUTRIPLAN_TAB_ACTIVATED`, `NUTRIPLAN_TAB_DEACTIVATED`.

**Prefetch:** `<link rel="prefetch">` за таб HTML файловете — без speculationrules (WebView ги игнорира).

---

### 3.3 Backend (worker.js)

Cloudflare Worker написан на JavaScript (edge runtime). Основни модули:

| Модул | Описание |
|-------|---------|
| **Auth** | Firebase социален auth — верифицира ID токени чрез Google JWKS (RSASSA-PKCS1-v1_5/SHA-256). KV ключ `auth:{uid}`. |
| **Plan Generation** | Асинхронен 4-стъпков пайплайн чрез Cloudflare Queue. Планът се одобрява от admin преди активиране. |
| **Chat** | Stateless — целият контекст идва от клиента. Поддържа streaming и plan modification. |
| **Push Notifications** | VAPID-базирани push subscriptions. Съхранени в KV. |
| **Food Lists** | Mainlist / whitelist / blacklist — кеширани 1 час в worker паметта. |
| **AI Logging** | Опционален лог на всички AI заявки/отговори. Контролиран чрез `ai_logging_enabled` KV ключ. |
| **Acuity Proxy** | `/schedule.php` — прокси за XBody Acuity iframe с превод на интерфейса. |
| **Admin API** | Управление на промпти, food lists, клиентски планове, AI конфигурация. |

---

### 3.4 Съхранение на данни

#### localStorage (клиентска страна — само на устройството)

| Ключ | Съдържание |
|------|-----------|
| `dietPlan` | Пълният хранителен план (7 дни) |
| `userData` | Данни от въпросника |
| `chatHistory` | История на чат разговорите |
| `userId` | Уникален идентификатор |
| `gameData` | Ежедневни записи за геймификация |
| `userProfile` | Профилна снимка, настройки |
| `pushSubscription` | VAPID push subscription |

#### KV Storage (Cloudflare — само конфигурация и планове)

| Ключ | Съдържание |
|------|-----------|
| `auth:{uid}` | Потребителска сесия |
| `plan:{userId}` | Одобрен хранителен план |
| `plan_status:{jobId}` | Статус на генерация |
| `food_mainlist` | Основен списък с храни |
| `food_whitelist` | Бял списък |
| `food_blacklist` | Черен списък |
| `admin_*_prompt` | AI промпти |
| `ai_logging_enabled` | AI логинг вкл/изкл |

**⚠️ Лични данни на потребителя НИКОГА не се съхраняват на сървъра.**

---

### 3.5 Сигурност

| Мярка | Описание |
|-------|---------|
| **CORS** | Контролиран cross-origin достъп |
| **Input validation** | Задължителни полета, type validation |
| **XSS protection** | `escapeHtml()` при рендиране |
| **Firebase Auth** | JWT верификация с Google JWKS |
| **API keys** | Само в Cloudflare Secrets (wrangler), не в код |
| **Privacy by design** | Без сървърско съхранение на лични данни |
| **Rate limiting** | Cloudflare DDoS защита |

---

### 3.6 Deployment

```
GitHub repo (Radilovk/aidiet)
    │
    ├── Frontend (HTML/CSS/JS) → GitHub Pages / Cloudflare Pages
    │
    └── Backend (worker.js) → Cloudflare Workers
            │
            ├── KV Namespace: page_content
            ├── Queue: plan-generation
            └── Secrets: OPENAI_API_KEY, GEMINI_API_KEY, VAPID_PRIVATE_KEY, ...
```

**Команди:**
```bash
wrangler deploy                      # Deploy worker
wrangler secret put OPENAI_API_KEY   # Конфигурация на AI ключ
wrangler kv:namespace create "page_content"
```

---

## 4. Файлова структура

```
aidiet/
├── index.html              # Лендинг страница
├── app.html / app.js       # SPA shell с iframe tabs
├── questionnaire2.html     # Здравен въпросник (30+ въпроса)
├── plan.html               # Хранителен план + чат + геймификация
├── analysis.html           # Здравен анализ и прогнози
├── guidelines.html         # Хранителни насоки
├── profile.html            # Потребителски профил
├── game-analytics.html     # Геймификационна аналитика
├── plan-pending.html       # Изчакване на генерация на план
├── analysis-loading.html   # Loading екран при анализ
├── admin.html              # Административен панел
├── worker.js               # Cloudflare Worker backend (~15 000 реда)
├── wrangler.toml           # Worker конфигурация
├── manifest.json           # PWA манифест
├── sw.js                   # Service Worker
├── app.js                  # SPA shell логика
├── auth-guard.js           # Auth проверка при зареждане
├── session-utils.js        # Управление на сесии и localStorage
├── local-scheduler.js      # Локален scheduler за нотификации
├── native-backup.js        # Backup при APK рестарт
├── drive-backup.js         # Google Drive backup
├── notification-db.js      # IndexedDB за нотификации
├── quick-answer.html       # Бърз отговор от нотификация
├── xbody.html              # XBody PWA модул
├── xbody-manifest.json     # XBody PWA манифест
├── xbody-sw.js             # XBody Service Worker
├── design-system.css       # Глобален design system
├── KV/prompts/             # AI промпти за пайплайна
│   ├── admin_analysis_prompt.txt
│   ├── admin_strategy_prompt.txt
│   ├── admin_meal_plan_prompt.txt
│   ├── admin_summary_prompt.txt
│   ├── admin_consultation_prompt.txt
│   ├── admin_modification_prompt.txt
│   └── admin_correction_prompt.txt
├── capacitor-shell/        # Capacitor Android shell
├── android-res/            # Android ресурси и APK референс
└── docs/                   # Техническа документация
```

---

## 5. Технологичен стек

| Слой | Технология |
|------|-----------|
| **Frontend** | Vanilla HTML5 / CSS3 / JavaScript (ES2022) |
| **Backend** | Cloudflare Workers (V8 isolates, edge runtime) |
| **AI** | OpenAI GPT-4o / Gemini Pro |
| **Auth** | Firebase Authentication (Google, Apple, email) |
| **Storage (client)** | localStorage + IndexedDB |
| **Storage (server)** | Cloudflare KV |
| **Queue** | Cloudflare Queues |
| **Push notifications** | Web Push API (VAPID) |
| **Mobile** | Capacitor (Android APK) + PWA |
| **PDF** | jsPDF 2.5.1 |
| **Icons** | Font Awesome 6 |
| **Fonts** | Poppins, Segoe UI, Inter |

---

## 6. Бъдещи подобрения

- [ ] iOS push нотификации (Safari Web Push)
- [ ] Grocery list generator от плана
- [ ] Progress tracking с графики (тегло, измервания)
- [ ] Multi-language support (EN, DE, RU)
- [ ] Истинска кирилица в PDF (custom fonts)
- [ ] Интеграция с фитнес трекери (Google Fit, Apple Health)
- [ ] Рецептурна книга с изображения
- [ ] Калориен калкулатор за произволни ястия
- [ ] Email нотификации за седмичен recap
