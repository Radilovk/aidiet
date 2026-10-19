# Платформа за студиа (много студиа, един сървър)

Всяко студио има свой поддомейн, график, дължина на часа, буфер, цена, бранд и лого, кодове, ограничения,
Google Calendar и Stripe (по желание). Общи са сървърът (worker-ът) и Viber изпращачът (`viber-sender/`).
Бургас (Acuity) не се засяга: новото е само под `/api/s/…`.

## Настройка (веднъж)
1. База: `npx wrangler d1 create studios`. Добави в `wrangler.toml` под `[env.production]`:
   ```
   [[env.production.d1_databases]]
   binding = "STUDIO_DB"
   database_name = "studios"
   database_id = "<id от командата>"
   ```
   После: `npx wrangler d1 execute studios --remote --env production --file=studio-platform/schema.sql`
2. Secrets в Cloudflare (worker `aidiet`):
   - `STUDIO_MASTER_KEY` — твоят ключ за създаване на студиа (поне 16 знака).
   - `STUDIO_SECRET_KEY` — 32 случайни байта в base64 (`openssl rand -base64 32`): с него се пазят Stripe ключовете на студиата.
   - `GOOGLE_SERVICE_ACCOUNT` — JSON на service account (Google Cloud → IAM → Service accounts) с включен Google Calendar API.
     Ако го няма, се ползва `FIREBASE_SERVICE_ACCOUNT` (тогава включи Calendar API в проекта на Firebase).
   - `STUDIO_ROOT_DOMAIN` (променлива) — домейнът на поддомейните, напр. `studios.bg` → `burgas.studios.bg`.
3. Ново студио: `POST /api/s/master/studio` с `X-Master-Key` и `{ "id": "burgas", "name": "XBODY Burgas", "pin": "12345" }`
   (същата заявка със съществуващо `id` сменя 5-цифрения код).

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
