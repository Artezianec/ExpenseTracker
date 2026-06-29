CREATE TABLE IF NOT EXISTS households (
  id VARCHAR(36) PRIMARY KEY,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  photo_url VARCHAR(512),
  household_id VARCHAR(36),
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
  joined_at DATETIME(3) NOT NULL,
  PRIMARY KEY (household_id, user_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `groups` (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type ENUM('personal', 'household', 'trip', 'other') NOT NULL DEFAULT 'household',
  month TINYINT NOT NULL,
  year SMALLINT NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  max_budget DECIMAL(12, 2),
  budget_type ENUM('weekly', 'monthly', 'total') DEFAULT 'monthly',
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
  joined_at DATETIME(3) NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS participants (
  id VARCHAR(36) PRIMARY KEY,
  group_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  user_id VARCHAR(36),
  joined_at DATETIME(3) NOT NULL,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id VARCHAR(36) PRIMARY KEY,
  group_id VARCHAR(36) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  description VARCHAR(500) NOT NULL,
  category VARCHAR(100) NOT NULL,
  paid_by VARCHAR(36) NOT NULL,
  expense_date DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  split_type ENUM('equal', 'percentage', 'exact') NOT NULL DEFAULT 'equal',
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (paid_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS incomes (
  id VARCHAR(36) PRIMARY KEY,
  group_id VARCHAR(36) NOT NULL,
  participant_id VARCHAR(36) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  source VARCHAR(500) NOT NULL,
  income_date DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  priority TINYINT NOT NULL DEFAULT 3,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_user_category (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchases (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  store VARCHAR(255),
  purchase_date DATETIME(3) NOT NULL,
  warranty_expires_at DATETIME(3),
  installment_count INT NOT NULL DEFAULT 1,
  monthly_interest_rate DECIMAL(5, 2),
  interest_rate_period ENUM('monthly', 'annual') NOT NULL DEFAULT 'annual',
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id VARCHAR(36) PRIMARY KEY,
  purchase_id VARCHAR(36) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_installments (
  id VARCHAR(36) PRIMARY KEY,
  purchase_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  installment_number INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  month TINYINT NOT NULL,
  year SMALLINT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS credits (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  lender VARCHAR(255),
  principal DECIMAL(12, 2) NOT NULL,
  interest_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
  interest_rate_period ENUM('monthly', 'annual') NOT NULL DEFAULT 'annual',
  term_months INT NOT NULL,
  payment_day TINYINT NOT NULL DEFAULT 10,
  start_date DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS credit_payments (
  id VARCHAR(36) PRIMARY KEY,
  credit_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  payment_number INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  month TINYINT NOT NULL,
  year SMALLINT NOT NULL,
  FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS insurances (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  monthly_amount DECIMAL(12, 2) NOT NULL,
  subject_type ENUM('person', 'purchase', 'other') NOT NULL,
  subject_user_id VARCHAR(36),
  subject_purchase_id VARCHAR(36),
  subject_label VARCHAR(500),
  payment_day TINYINT NOT NULL DEFAULT 1,
  start_date DATETIME(3) NOT NULL,
  end_date DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (subject_purchase_id) REFERENCES purchases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS insurance_contracts (
  id VARCHAR(36) PRIMARY KEY,
  insurance_id VARCHAR(36) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (insurance_id) REFERENCES insurances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS insurance_payments (
  id VARCHAR(36) PRIMARY KEY,
  insurance_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  payment_number INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  month TINYINT NOT NULL,
  year SMALLINT NOT NULL,
  FOREIGN KEY (insurance_id) REFERENCES insurances(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supermarket_chains (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  scraper_key VARCHAR(64) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS supermarket_stores (
  id VARCHAR(36) PRIMARY KEY,
  chain_id VARCHAR(36) NOT NULL,
  store_code VARCHAR(64) NOT NULL,
  name VARCHAR(255),
  city VARCHAR(255),
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_chain_store (chain_id, store_code),
  FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  barcode VARCHAR(32) PRIMARY KEY,
  name_he VARCHAR(500) NOT NULL,
  manufacturer VARCHAR(255),
  unit_qty VARCHAR(64),
  unit_measure VARCHAR(64),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS product_prices (
  id VARCHAR(36) PRIMARY KEY,
  barcode VARCHAR(32) NOT NULL,
  chain_id VARCHAR(36) NOT NULL,
  store_id VARCHAR(36),
  price DECIMAL(12, 2) NOT NULL,
  price_updated_at DATETIME(3),
  synced_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_price (barcode, chain_id, store_id),
  FOREIGN KEY (barcode) REFERENCES products(barcode) ON DELETE CASCADE,
  FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES supermarket_stores(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS product_price_history (
  id VARCHAR(36) PRIMARY KEY,
  barcode VARCHAR(32) NOT NULL,
  chain_id VARCHAR(36) NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  FOREIGN KEY (barcode) REFERENCES products(barcode) ON DELETE CASCADE,
  FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_promotions (
  id VARCHAR(36) PRIMARY KEY,
  barcode VARCHAR(32) NOT NULL,
  chain_id VARCHAR(36) NOT NULL,
  description VARCHAR(500),
  discount_rate DECIMAL(8, 2),
  valid_from DATETIME(3),
  valid_until DATETIME(3),
  synced_at DATETIME(3) NOT NULL,
  FOREIGN KEY (barcode) REFERENCES products(barcode) ON DELETE CASCADE,
  FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_sync_runs (
  id VARCHAR(36) PRIMARY KEY,
  chain_id VARCHAR(36),
  files_processed INT NOT NULL DEFAULT 0,
  products_upserted INT NOT NULL DEFAULT 0,
  prices_upserted INT NOT NULL DEFAULT 0,
  status ENUM('running', 'success', 'failed') NOT NULL DEFAULT 'running',
  error_message TEXT,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3),
  FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS favorite_products (
  user_id VARCHAR(36) NOT NULL,
  barcode VARCHAR(32) NOT NULL,
  nickname VARCHAR(255),
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, barcode),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (barcode) REFERENCES products(barcode) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shopping_trips (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  group_id VARCHAR(36) NOT NULL,
  store_name VARCHAR(255),
  chain_id VARCHAR(36),
  total_amount DECIMAL(12, 2) NOT NULL,
  trip_date DATETIME(3) NOT NULL,
  source ENUM('scan', 'receipt', 'manual') NOT NULL DEFAULT 'scan',
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shopping_trip_items (
  id VARCHAR(36) PRIMARY KEY,
  trip_id VARCHAR(36) NOT NULL,
  barcode VARCHAR(32),
  name VARCHAR(500) NOT NULL,
  quantity DECIMAL(10, 3) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12, 2) NOT NULL,
  line_total DECIMAL(12, 2) NOT NULL,
  is_weighed TINYINT(1) NOT NULL DEFAULT 0,
  weight_kg DECIMAL(10, 3),
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (trip_id) REFERENCES shopping_trips(id) ON DELETE CASCADE,
  FOREIGN KEY (barcode) REFERENCES products(barcode) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shopping_trip_receipts (
  id VARCHAR(36) PRIMARY KEY,
  trip_id VARCHAR(36) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  content_hash VARCHAR(64),
  created_at DATETIME(3) NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES shopping_trips(id) ON DELETE CASCADE
);
