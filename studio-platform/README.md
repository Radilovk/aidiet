# Платформа за студиа (много студиа, един сървър)

Всяко студио има свой поддомейн, график, дължина на часа, буфер, цена, бранд и лого, кодове, ограничения,
Google Calendar и Stripe (по желание). Общи са сървърът (worker-ът) и Viber изпращачът (`viber-sender/`).
Бургас (Acuity) не се засяга: новото е само под `/api/s/…`.

## Настройка — всичко минава през GitHub Actions (секретите CLOUDFLARE_API_TOKEN / _ACCOUNT_ID)
- **База и ключ**: при всеки деплой на worker-а (`deploy-worker.yml`) базата D1 `studios` се създава, ако я няма,
  таблиците се допълват, тя се свързва като `STUDIO_DB`, а `STUDIO_SECRET_KEY` (пази Stripe ключовете на
  студиата) се създава веднъж — никой не го вижда.
- **Ново студио**: Actions → „Студиа“ → Run workflow → `create`, `id` (поддомейн, напр. `burgas`), име, телефон.
  Става `https://burgas.biocode-bg.com`, а 5-цифреният admin код идва по Viber (не се печата — репото е публично).
  Телефонът може да е GitHub секрет `STUDIO_ADMIN_PHONE`, за да не се вижда в лога.
- **Нов код**: `reset-pin`. **Списък**: `list`. **Поддомейн наново**: `domain`.
- **Google**: ползва се `FIREBASE_SERVICE_ACCOUNT` (или `GOOGLE_SERVICE_ACCOUNT`). Веднъж: включи Google Calendar
  API за проекта `nutriplan-c460a`.
- **Токенът** трябва да има D1:Edit, Workers KV Storage:Edit, Workers Scripts:Edit, а за поддомейните и
  Zone:Read + Workers Routes:Edit за `biocode-bg.com`.

## Всяко студио само (admin: 7 пъти логото → 5-цифрения код)
- **Google Calendar**: в Google Calendar → настройки на календара → „Споделяне с конкретни хора“ → имейлът на
  service account-а (показва се в admin страницата) с право „Промяна на събития“. После ID на календара в admin.
  Заетите там часове не се предлагат; всяко записване става събитие в календара (и се маха при отказ).
- **Stripe** (по желание): publishable + secret (или restricted) ключ. Без Stripe карта не се иска.
- **Гаранция**: `card` (винаги карта), `card_or_code` (карта или код), `none`.
- График по дни, почивни дни, дължина на часа, буфер, стъпка, цена, текстове, адрес, лого, цвят.
- Ограничения: минимално предизвестие, дни напред, часове на ден, бъдещи часове общо, безплатен отказ до N ч.
- Кодове: брой ползвания, на клиент, срок; при отказ навреме ползването се връща.
- Записвания: отказ, „неявяване“, „Таксувай“ от запазената карта (само при неявяване или късен отказ).

## Пестене на трафик
- Настройките: `GET /api/s/config` (кеш 60 с; приложението пази копие по `version`).
- Свободните часове за месец: кеш на ръба до 5 мин, нулира се при всяка промяна (`studio:rev`); заетостта от
  Google се пази 5 мин в KV. Само „Запази“ проверява Google и базата на живо (една заявка, атомарна).

## API (накратко)
Клиент: `GET config`, `GET availability?month=`, `GET logo`, `POST guarantee`, `POST book`, `POST code`,
`POST mine`, `POST cancel`, `POST move`, `POST verify/start`, `POST verify/finish` (нов телефон: код по Viber).
Admin (`Authorization: Bearer`): `POST admin/login`, `GET admin/state`, `POST admin/settings`, `admin/logo`,
`admin/stripe`, `admin/pin`, `GET admin/bookings`, `POST admin/booking`, `admin/charge`, `admin/code`.

Тест: `npm run test:studio` (реална SQLite вместо D1, фалшиви Google и Stripe).
