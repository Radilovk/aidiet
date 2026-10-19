-- Studio platform (many studios, one worker): Cloudflare D1, binding STUDIO_DB.
--   npx wrangler d1 create studios
--   npx wrangler d1 execute studios --remote --file=studio-platform/schema.sql

-- one row per studio: its slug is the subdomain (burgas.<domain>)
CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,                 -- slug: a-z 0-9 -
  settings TEXT NOT NULL DEFAULT '{}', -- JSON, see studio-platform/settings.js
  secrets TEXT NOT NULL DEFAULT '{}',  -- JSON: the studio's Stripe keys (secret one encrypted)
  pin_hash TEXT NOT NULL,              -- the 5-digit admin code: PBKDF2
  version INTEGER NOT NULL DEFAULT 1,  -- bumped on every settings change (the app's cached copy)
  created_at INTEGER NOT NULL
);

-- a studio's clients, by phone (the Viber number): who they are, their device token, saved card and code
CREATE TABLE IF NOT EXISTS clients (
  studio_id TEXT NOT NULL,
  phone TEXT NOT NULL,                 -- +359…
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL DEFAULT '', -- the phone's own key (my hours, cancel, the saved card)
  stripe_customer TEXT NOT NULL DEFAULT '',
  card_pm TEXT NOT NULL DEFAULT '',
  card_brand TEXT NOT NULL DEFAULT '',
  card_last4 TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',       -- the code the client books with (kept until it ends)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (studio_id, phone)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,             -- the training only; the studio's buffer is kept around it
  status TEXT NOT NULL,                -- booked | canceled | noshow
  phone TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  card_pm TEXT NOT NULL DEFAULT '',
  card_last4 TEXT NOT NULL DEFAULT '',
  stripe_customer TEXT NOT NULL DEFAULT '',
  gcal_event TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'app',  -- app | admin
  late_cancel INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_time ON bookings (studio_id, status, start_ms);
CREATE INDEX IF NOT EXISTS bookings_phone ON bookings (studio_id, phone, start_ms);

-- promo codes / packages / vouchers: each studio its own
CREATE TABLE IF NOT EXISTS codes (
  studio_id TEXT NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE,
  label TEXT NOT NULL DEFAULT '',
  uses_left INTEGER,                   -- NULL: no limit
  per_client INTEGER,                  -- NULL: no limit; else hours one phone may book with it
  valid_to INTEGER,                    -- ms; NULL: no end
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (studio_id, code)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  expires_ms INTEGER NOT NULL
);
