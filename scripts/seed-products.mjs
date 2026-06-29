#!/usr/bin/env node
import { createPool, initSchema } from '../server/db.mjs';
import { seedSampleProducts } from '../server/products.mjs';

const pool = createPool();
try {
  await initSchema(pool);
  await seedSampleProducts(pool);
  console.log('seeded sample products (multi-chain prices)');
} finally {
  await pool.end();
}
