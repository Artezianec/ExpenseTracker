import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './load-env.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

export function createPool() {
  return mysql.createPool({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: Number(process.env.MYSQL_PORT ?? '3306'),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'budgeted',
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
  });
}

export async function initSchema(pool) {
  const sql = readFileSync(path.join(root, 'schema.sql'), 'utf8');
  for (const statement of sql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) {
      await pool.query(trimmed);
    }
  }
  await migrate(pool);
}

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [
    column,
  ]);
  return rows.length > 0;
}

async function tableExists(pool, table) {
  const [rows] = await pool.query('SHOW TABLES LIKE ?', [table]);
  return rows.length > 0;
}

export async function migrate(pool) {
  if (!(await columnExists(pool, 'groups', 'month'))) {
    await pool.query(
      'ALTER TABLE `groups` ADD COLUMN month TINYINT NOT NULL DEFAULT 1',
    );
    await pool.query(
      'ALTER TABLE `groups` ADD COLUMN year SMALLINT NOT NULL DEFAULT 2026',
    );
    await pool.query(
      'UPDATE `groups` SET month = MONTH(created_at), year = YEAR(created_at)',
    );
  }

  if (!(await tableExists(pool, 'participants'))) {
    await pool.query(`
      CREATE TABLE participants (
        id VARCHAR(36) PRIMARY KEY,
        group_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        user_id VARCHAR(36),
        joined_at DATETIME(3) NOT NULL,
        FOREIGN KEY (group_id) REFERENCES \`groups\`(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
  }

  if (!(await tableExists(pool, 'incomes'))) {
    await pool.query(`
      CREATE TABLE incomes (
        id VARCHAR(36) PRIMARY KEY,
        group_id VARCHAR(36) NOT NULL,
        participant_id VARCHAR(36) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        source VARCHAR(500) NOT NULL,
        income_date DATETIME(3) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        FOREIGN KEY (group_id) REFERENCES \`groups\`(id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
      )
    `);
  }

  const [existingParticipants] = await pool.query(
    'SELECT COUNT(*) AS c FROM participants',
  );
  if (existingParticipants[0].c === 0) {
    const [members] = await pool.query(`
      SELECT gm.group_id, gm.user_id, gm.joined_at,
             COALESCE(u.display_name, u.email) AS name
      FROM group_members gm
      INNER JOIN users u ON u.id = gm.user_id
    `);
    for (const m of members) {
      await pool.query(
        `INSERT INTO participants (id, group_id, name, user_id, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), m.group_id, m.name, m.user_id, m.joined_at],
      );
    }
  }

  if (!(await tableExists(pool, 'categories'))) {
    await pool.query(`
      CREATE TABLE categories (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        name VARCHAR(100) NOT NULL,
        priority TINYINT NOT NULL DEFAULT 3,
        created_at DATETIME(3) NOT NULL,
        UNIQUE KEY uq_user_category (user_id, name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  if (!(await tableExists(pool, 'purchases'))) {
    await pool.query(`
      CREATE TABLE purchases (
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
      )
    `);
  }

  if (!(await tableExists(pool, 'purchase_installments'))) {
    await pool.query(`
      CREATE TABLE purchase_installments (
        id VARCHAR(36) PRIMARY KEY,
        purchase_id VARCHAR(36) NOT NULL,
        group_id VARCHAR(36) NOT NULL,
        installment_number INT NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        month TINYINT NOT NULL,
        year SMALLINT NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES \`groups\`(id) ON DELETE CASCADE
      )
    `);
  }

  if (!(await tableExists(pool, 'purchase_receipts'))) {
    await pool.query(`
      CREATE TABLE purchase_receipts (
        id VARCHAR(36) PRIMARY KEY,
        purchase_id VARCHAR(36) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        mime_type VARCHAR(100),
        created_at DATETIME(3) NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
      )
    `);
  }

  if (!(await tableExists(pool, 'schema_migrations'))) {
    await pool.query(`
      CREATE TABLE schema_migrations (
        id VARCHAR(64) PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL
      )
    `);
  }

  const [flipRow] = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = 'invert_category_priority_v1'",
  );
  if (!flipRow.length && (await tableExists(pool, 'categories'))) {
    const [count] = await pool.query('SELECT COUNT(*) AS c FROM categories');
    if (count[0].c > 0) {
      await pool.query(
        'UPDATE categories SET priority = 6 - priority WHERE priority BETWEEN 1 AND 5',
      );
    }
    await pool.query(
      "INSERT INTO schema_migrations (id, applied_at) VALUES ('invert_category_priority_v1', NOW(3))",
    );
  }

  const [receiptMig] = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = 'purchase_receipts_v1'",
  );
  if (!receiptMig.length && (await tableExists(pool, 'purchases'))) {
    const [cols] = await pool.query(
      "SHOW COLUMNS FROM purchases LIKE 'receipt_filename'",
    );
    if (cols.length && (await tableExists(pool, 'purchase_receipts'))) {
      const [legacy] = await pool.query(
        `SELECT id, receipt_filename, receipt_original_name, receipt_mime_type, created_at
         FROM purchases
         WHERE receipt_filename IS NOT NULL AND receipt_filename != ''`,
      );
      for (const p of legacy) {
        await pool.query(
          `INSERT INTO purchase_receipts
           (id, purchase_id, stored_filename, original_name, mime_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            p.id,
            p.receipt_filename,
            p.receipt_original_name,
            p.receipt_mime_type,
            p.created_at,
          ],
        );
      }
    }
    await pool.query(
      "INSERT INTO schema_migrations (id, applied_at) VALUES ('purchase_receipts_v1', NOW(3))",
    );
  }

  const [interestMig] = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = 'purchase_interest_rate_v1'",
  );
  if (!interestMig.length && (await tableExists(pool, 'purchases'))) {
    const [cols] = await pool.query(
      "SHOW COLUMNS FROM purchases LIKE 'monthly_interest_rate'",
    );
    if (!cols.length) {
      await pool.query(
        'ALTER TABLE purchases ADD COLUMN monthly_interest_rate DECIMAL(5, 2) DEFAULT NULL',
      );
    }
    await pool.query(
      "INSERT INTO schema_migrations (id, applied_at) VALUES ('purchase_interest_rate_v1', NOW(3))",
    );
  }

  const [periodMig] = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = 'purchase_interest_period_v1'",
  );
  if (!periodMig.length && (await tableExists(pool, 'purchases'))) {
    const [cols] = await pool.query(
      "SHOW COLUMNS FROM purchases LIKE 'interest_rate_period'",
    );
    if (!cols.length) {
      await pool.query(
        `ALTER TABLE purchases
         ADD COLUMN interest_rate_period ENUM('monthly', 'annual') NOT NULL DEFAULT 'monthly'`,
      );
    }
    await pool.query(
      "INSERT INTO schema_migrations (id, applied_at) VALUES ('purchase_interest_period_v1', NOW(3))",
    );
  }

  if (!(await tableExists(pool, 'credits'))) {
    await pool.query(`
      CREATE TABLE credits (
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
      )
    `);
  }

  if (!(await tableExists(pool, 'credit_payments'))) {
    await pool.query(`
      CREATE TABLE credit_payments (
        id VARCHAR(36) PRIMARY KEY,
        credit_id VARCHAR(36) NOT NULL,
        group_id VARCHAR(36) NOT NULL,
        payment_number INT NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        month TINYINT NOT NULL,
        year SMALLINT NOT NULL,
        FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES \`groups\`(id) ON DELETE CASCADE
      )
    `);
  }

  if (!(await tableExists(pool, 'households'))) {
    await pool.query(`
      CREATE TABLE households (
        id VARCHAR(36) PRIMARY KEY,
        created_by VARCHAR(36) NOT NULL,
        created_at DATETIME(3) NOT NULL
      )
    `);
  }

  if (!(await tableExists(pool, 'household_members'))) {
    await pool.query(`
      CREATE TABLE household_members (
        household_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
        joined_at DATETIME(3) NOT NULL,
        PRIMARY KEY (household_id, user_id),
        FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  const [householdCol] = await pool.query(
    "SHOW COLUMNS FROM users LIKE 'household_id'",
  );
  if (!householdCol.length) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN household_id VARCHAR(36) NULL',
    );
  }

  const [usersWithoutHousehold] = await pool.query(
    'SELECT id FROM users WHERE household_id IS NULL',
  );
  for (const row of usersWithoutHousehold) {
    const householdId = randomUUID();
    const now = new Date();
    await pool.query(
      'INSERT INTO households (id, created_by, created_at) VALUES (?, ?, ?)',
      [householdId, row.id, now],
    );
    await pool.query('UPDATE users SET household_id = ? WHERE id = ?', [
      householdId,
      row.id,
    ]);
    await pool.query(
      `INSERT INTO household_members (household_id, user_id, role, joined_at)
       VALUES (?, ?, 'admin', ?)`,
      [householdId, row.id, now],
    );
  }

  if (!(await tableExists(pool, 'insurances'))) {
    await pool.query(`
      CREATE TABLE insurances (
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
      )
    `);
  }

  if (!(await tableExists(pool, 'insurance_contracts'))) {
    await pool.query(`
      CREATE TABLE insurance_contracts (
        id VARCHAR(36) PRIMARY KEY,
        insurance_id VARCHAR(36) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        mime_type VARCHAR(100),
        created_at DATETIME(3) NOT NULL,
        FOREIGN KEY (insurance_id) REFERENCES insurances(id) ON DELETE CASCADE
      )
    `);
  }

  if (!(await tableExists(pool, 'insurance_payments'))) {
    await pool.query(`
      CREATE TABLE insurance_payments (
        id VARCHAR(36) PRIMARY KEY,
        insurance_id VARCHAR(36) NOT NULL,
        group_id VARCHAR(36) NOT NULL,
        payment_number INT NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        month TINYINT NOT NULL,
        year SMALLINT NOT NULL,
        FOREIGN KEY (insurance_id) REFERENCES insurances(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES \`groups\`(id) ON DELETE CASCADE
      )
    `);
  }

  await migrateSupermarketTables(pool);
}

async function migrateSupermarketTables(pool) {
  const tables = {
    supermarket_chains: `
      CREATE TABLE supermarket_chains (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        scraper_key VARCHAR(64) NOT NULL UNIQUE,
        created_at DATETIME(3) NOT NULL
      )`,
    supermarket_stores: `
      CREATE TABLE supermarket_stores (
        id VARCHAR(36) PRIMARY KEY,
        chain_id VARCHAR(36) NOT NULL,
        store_code VARCHAR(64) NOT NULL,
        name VARCHAR(255),
        city VARCHAR(255),
        created_at DATETIME(3) NOT NULL,
        UNIQUE KEY uq_chain_store (chain_id, store_code),
        FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE CASCADE
      )`,
    products: `
      CREATE TABLE products (
        barcode VARCHAR(32) PRIMARY KEY,
        name_he VARCHAR(500) NOT NULL,
        manufacturer VARCHAR(255),
        unit_qty VARCHAR(64),
        unit_measure VARCHAR(64),
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL
      )`,
    product_prices: `
      CREATE TABLE product_prices (
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
      )`,
    product_price_history: `
      CREATE TABLE product_price_history (
        id VARCHAR(36) PRIMARY KEY,
        barcode VARCHAR(32) NOT NULL,
        chain_id VARCHAR(36) NOT NULL,
        price DECIMAL(12, 2) NOT NULL,
        recorded_at DATETIME(3) NOT NULL,
        FOREIGN KEY (barcode) REFERENCES products(barcode) ON DELETE CASCADE,
        FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE CASCADE
      )`,
    product_promotions: `
      CREATE TABLE product_promotions (
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
      )`,
    price_sync_runs: `
      CREATE TABLE price_sync_runs (
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
      )`,
    favorite_products: `
      CREATE TABLE favorite_products (
        user_id VARCHAR(36) NOT NULL,
        barcode VARCHAR(32) NOT NULL,
        nickname VARCHAR(255),
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (user_id, barcode),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (barcode) REFERENCES products(barcode) ON DELETE CASCADE
      )`,
    shopping_trips: `
      CREATE TABLE shopping_trips (
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
        FOREIGN KEY (group_id) REFERENCES \`groups\`(id) ON DELETE CASCADE,
        FOREIGN KEY (chain_id) REFERENCES supermarket_chains(id) ON DELETE SET NULL
      )`,
    shopping_trip_items: `
      CREATE TABLE shopping_trip_items (
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
      )`,
    shopping_trip_receipts: `
      CREATE TABLE shopping_trip_receipts (
        id VARCHAR(36) PRIMARY KEY,
        trip_id VARCHAR(36) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        mime_type VARCHAR(100),
        content_hash VARCHAR(64),
        created_at DATETIME(3) NOT NULL,
        FOREIGN KEY (trip_id) REFERENCES shopping_trips(id) ON DELETE CASCADE
      )`,
  };

  for (const [name, ddl] of Object.entries(tables)) {
    if (!(await tableExists(pool, name))) {
      await pool.query(ddl);
    }
  }

  const [seedMig] = await pool.query(
    "SELECT id FROM schema_migrations WHERE id = 'seed_sample_products_v1'",
  );
  if (!seedMig.length && (await tableExists(pool, 'products'))) {
    const { seedSampleProducts } = await import('./products.mjs');
    await seedSampleProducts(pool);
    await pool.query(
      "INSERT INTO schema_migrations (id, applied_at) VALUES ('seed_sample_products_v1', NOW(3))",
    );
  }
}

export function toIso(value) {
  if (!value) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}
