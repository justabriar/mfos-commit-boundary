import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/client.js';
import { logger } from '../src/config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');

async function main() {
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    logger.info({ file }, 'applying migration');
    await pool.query(sql);
  }

  logger.info('migrations complete');
  await pool.end();
}

void main();
