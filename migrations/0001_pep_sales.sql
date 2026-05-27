CREATE TABLE IF NOT EXISTS pep_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  purchase_price REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(base_name, dosage)
);

CREATE TABLE IF NOT EXISTS pep_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  multiplier REAL NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  sale_date TEXT NOT NULL,
  revenue REAL NOT NULL,
  cost REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(product_id) REFERENCES pep_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pep_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
