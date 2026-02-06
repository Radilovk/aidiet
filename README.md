# AI Diet - Интелигентна Хранителна Платформа

Модерна уеб апликация за генериране на персонализирани хранителни планове чрез изкуствен интелект.

## 🎯 Функционалности

### 1. Въпросник за Профилиране
- Интерактивен въпросник с над 30+ фактора
- Динамично разклонение на въпроси (conditional logic)
- Модерен mobile-first дизайн
- Прогрес индикатор
- Валидация на данни

### 2. AI Генериране на Хранителен План
- **Multi-Step подход** - 4 основни стъпки (Issue #1 - ФАЗА 2 resolution)
  - Стъпка 1: Задълбочен здравен анализ и метаболитен профил
  - Стъпка 2: Персонализирана диетична стратегия
  - Стъпка 3: Конкретен 7-дневен план с ястия
    - Подстъпка 3.1: Ден 1-2
    - Подстъпка 3.2: Ден 3-4
    - Подстъпка 3.3: Ден 5-6
    - Подстъпка 3.4: Ден 7
  - Стъпка 4 (валидираща): Обобщение и финални препоръки
  - **Общо: 7 стъпки + 1 валидираща = 8 AI заявки**
- Персонализиран 7-дневен план
- Анализ на базов метаболизъм (BMR) и TDEE
- Корелации между сън, стрес и хранене
- Макронутриенти (протеини, въглехидрати, мазнини)
- 3-5 хранения на ден с детайлна информация
- Препоръки и забранени храни
- Психологически съвети базирани на емоционалното хранене
- Препоръки за хранителни добавки с проверка за лекарствени взаимодействия

### 3. AI Чат Асистент
- Интелигентен диалог с контекст
- Познава профила и плана на клиента
- Роля на диетолог, психолог и здравен асистент
- История на разговора
- Real-time отговори

### 4. Оптимизация и Поверителност
- **Локално съхранение** - Всички клиентски данни само в браузъра
- **Payload оптимизация** - 60-70% намаление на размера при чат заявки
- **Multi-step генериране** - 3 AI заявки за прецизност и индивидуализация
- Минимално натоварване на backend
- localStorage за клиентски данни
- Без съхранение на лични данни на сървъра

## 🏗️ Архитектура

```
┌─────────────────┐
│   Frontend      │
│  (HTML/JS/CSS)  │
└────────┬────────┘
         │
         │ HTTPS
         ▼
┌─────────────────────┐
│ Cloudflare Worker   │
│  (worker.js)        │
└────────┬────────────┘
         │
         ├──► KV Storage (Cache)
         │
         └──► AI Model (OpenAI/Gemini)
```

## 📁 Структура на Проекта

```
aidiet/
├── index.html              # Главна страница
├── questionnaire.html      # Въпросник
├── plan.html              # Хранителен план + чат
├── sample.json            # Примерен JSON формат
├── worker.js              # Cloudflare Worker backend
├── wrangler.toml          # Worker конфигурация
├── WORKER_README.md       # Инструкции за deployment
├── .gitignore            # Git ignore rules
└── README.md             # Този файл
```

## 🚀 Инсталация и Deployment

### Локална Разработка

1. Клонирайте репозиторията:
```bash
git clone https://github.com/Radilovk/aidiet.git
cd aidiet
```

2. Отворете HTML файловете директно в браузър или използвайте локален сървър:
```bash
# С Python
python -m http.server 8000

# С Node.js (http-server)
npx http-server -p 8000
```

3. Отворете `http://localhost:8000` в браузър

### Cloudflare Worker Deployment

Вижте [WORKER_README.md](./WORKER_README.md) за подробни инструкции.

Кратко:
```bash
# Инсталирайте Wrangler
npm install -g wrangler

# Login
wrangler login

# Създайте KV namespace
wrangler kv:namespace create "page_content"

# Конфигурирайте API ключ
wrangler secret put OPENAI_API_KEY
# или
wrangler secret put GEMINI_API_KEY

# Deploy
wrangler deploy
```


## 🔑 Data Storage - Local Only

**ВАЖНО**: Приложението съхранява ВСИЧКИ клиентски данни само локално в браузъра/телефона. Никакви лични данни, планове или история на разговори НЕ СЕ СЪХРАНЯВАТ на сървъра.

### LocalStorage Структура

| Ключ | Описание | Управление |
|------|----------|------------|
| `dietPlan` | Хранителен план (7 дни) | Клиентът |
| `userData` | Данни от въпросник | Клиентът |
| `chatHistory` | История на чат | Клиентът |
| `userId` | Уникален идентификатор | Клиентът |

### KV Storage (Само за конфигурация)

Worker използва KV само за административни настройки:

| Ключ | Описание | Употреба |
|------|----------|----------|
| `admin_plan_prompt` | Промпт за план | Админ настройки |
| `admin_consultation_prompt` | Промпт за консултация | Админ настройки |
| `admin_modification_prompt` | Промпт за модификации | Админ настройки |
| `admin_ai_provider` | AI доставчик | Админ настройки |
| `admin_ai_model_name` | AI модел | Админ настройки |

## 🔧 API Endpoints

### POST /api/generate-plan
Генерира хранителен план от данни на въпросника. **НЕ съхранява данни на сървъра.**

**Request Body:**
```json
{
  "name": "Иван",
  "age": 30,
  "weight": 85,
  "height": 180,
  "goal": "Отслабване",
  ...
}
```

**Response:**
```json
{
  "success": true,
  "plan": { ... },
  "userId": "unique_id"
}
```

### POST /api/chat
Чат с AI асистент. **Изисква пълен контекст от клиента.**

**Request Body:**
```json
{
  "message": "Може ли да ям банани?",
  "userData": { ... },
  "userPlan": { ... },
  "conversationHistory": [ ... ],
  "mode": "consultation"
}
```

**Response:**
```json
{
  "success": true,
  "response": "AI отговор...",
  "conversationHistory": [ ... ],
  "planUpdated": false,
  "updatedPlan": { ... },
  "updatedUserData": { ... }
}
```

## 🤖 AI Модели

Worker поддържа два AI модела (конфигурирани чрез environment variables):

- **OpenAI GPT-4o-mini** - За високо качество на отговорите
- **Google Gemini Pro** - Алтернатива

Конфигурирайте с:
```bash
wrangler secret put OPENAI_API_KEY
# или
wrangler secret put GEMINI_API_KEY
```

## 📱 Frontend Функционалности

### index.html
- Hero секция с анимации
- Feature карти
- Call-to-action бутони
- Mobile responsive дизайн

### questionnaire.html
- 30+ въпроса в 6 секции
- Динамични подвъпроси
- Прогрес индикатор
- Валидация на входни данни
- Автоматично изпращане към backend
- Съхранение в localStorage

### plan.html
- 7-дневна навигация (chips)
- Детайлни meal карти
- Accordion секции (препоръки, забранени храни, психология)
- Info modals за всяко ястие
- Интегриран AI чат прозорец
- Real-time комуникация с backend

## 🎨 Дизайн

- **Цветова палитра:**
  - Primary Red: `#e74c3c`
  - Soft Red: `#fadbd8`
  - Text Dark: `#2c3e50`
  - Background: `#f8f9fa`

- **Fonts:** Poppins (landing), Segoe UI (app)
- **Icons:** Font Awesome 6
- **Responsive:** Mobile-first approach

## 🔒 Сигурност

- CORS конфигуриран
- Input validation
- XSS protection (escapeHtml)
- No sensitive data in localStorage
- API keys в environment variables

## 📊 Data Flow

1. **Въпросник → Backend:**
   ```
   questionnaire.html → POST /api/generate-plan → Worker → AI Model → Response
   ```

2. **Backend → Plan Page:**
   ```
   Worker Response → localStorage → plan.html → Render UI
   ```

3. **Chat:**
   ```
   User Message + Full Context → POST /api/chat → Worker → AI Model → Response → UI
   Client stores updated history/plan in localStorage
   ```

4. **Съхранение на данни:**
   ```
   ВСИЧКИ клиентски данни се съхраняват САМО в localStorage на браузъра
   Сървърът НЕ СЪХРАНЯВА никакви лични данни, планове или история
   ```

## 🧪 Тестване

### Локално тестване на Worker:
```bash
wrangler dev
```

### Mock данни:
Worker автоматично връща mock данни когато няма конфигуриран API ключ.

## 📚 Документация

### Архитектура и Стратегия
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Обща архитектура на системата
- [HYBRID_MODEL_ARCHITECTURE.md](./HYBRID_MODEL_ARCHITECTURE.md) - Хибриден модел (Детерминирана логика + AI)
- [MULTI_STEP_SUMMARY.md](./MULTI_STEP_SUMMARY.md) - Multi-step генериране (3 AI заявки)
- **[СТРАТЕГИЯ_ХРАНИТЕЛНИ_КОМБИНАЦИИ.md](./СТРАТЕГИЯ_ХРАНИТЕЛНИ_КОМБИНАЦИИ.md)** - 📖 **Подробна документация за стратегията и комбинациите за генериране на адекватни хранителни режими**

### Deployment и Разработка
- [WORKER_README.md](./WORKER_README.md) - Cloudflare Worker deployment
- [FEATURES_GUIDE.md](./FEATURES_GUIDE.md) - Ръководство за функционалности
- [QUICK_START.md](./QUICK_START.md) - Бърз старт

## 📝 TODO / Бъдещи Подобрения

- [ ] Добавяне на потребителска регистрация
- [ ] Persistent storage (база данни)
- [ ] Email нотификации
- [ ] PDF експорт на планове
- [ ] Калории калкулатор
- [ ] Grocery list generator
- [ ] Progress tracking
- [ ] Multi-language support

## 🤝 Принос

За да допринесете:

1. Fork проекта
2. Създайте feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit промените (`git commit -m 'Add some AmazingFeature'`)
4. Push към branch (`git push origin feature/AmazingFeature`)
5. Отворете Pull Request

## 📄 Лиценз

Този проект е с отворен код за образователни цели.

## 👨‍💻 Автор

Radilov-K - [GitHub](https://github.com/Radilovk)

## 🙏 Благодарности

- Font Awesome за иконите
- Google Fonts за шрифтовете
- Cloudflare за Workers платформата
- OpenAI/Google за AI моделите
