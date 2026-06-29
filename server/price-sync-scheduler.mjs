import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPriceSyncStatus,
  runPriceSyncImport,
} from './supermarket-price-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

let syncInProgress = false;

function msUntilHour(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function runDownload() {
  return new Promise((resolve, reject) => {
    const py =
      process.platform === 'win32'
        ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(projectRoot, '.venv', 'bin', 'python');

    if (!existsSync(py)) {
      console.warn(
        '[price-sync] Python venv not found — skipping download. Run: npm run scraper:setup',
      );
      resolve(false);
      return;
    }

    const child = spawn(py, ['scripts/download-supermarket-dumps.py'], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`scraper download exited with code ${code}`));
    });
  });
}

export async function runFullPriceSync(pool, { download = true } = {}) {
  if (syncInProgress) {
    console.log('[price-sync] Already running, skip');
    return null;
  }

  syncInProgress = true;
  const started = Date.now();
  console.log('[price-sync] Starting daily sync…');

  try {
    if (download) {
      try {
        await runDownload();
      } catch (err) {
        console.error('[price-sync] Download failed:', err.message);
      }
    }

    const result = await runPriceSyncImport(pool);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[price-sync] Done in ${elapsed}s — ${result.filesProcessed} files, ${result.productsUpserted} updates`,
    );
    return result;
  } finally {
    syncInProgress = false;
  }
}

export function isPriceSyncRunning() {
  return syncInProgress;
}

export function startPriceSyncScheduler(pool) {
  if (process.env.PRICE_SYNC_ENABLED !== 'true') {
    console.log('[price-sync] Auto sync disabled (set PRICE_SYNC_ENABLED=true)');
    return;
  }

  const hour = Number(process.env.PRICE_SYNC_AT_HOUR ?? 3);
  const runOnStart = process.env.PRICE_SYNC_ON_START !== 'false';

  const scheduleNext = () => {
    const delay = msUntilHour(hour);
    const nextAt = new Date(Date.now() + delay);
    console.log(
      `[price-sync] Next run scheduled at ${nextAt.toLocaleString()} (hour ${hour})`,
    );
    setTimeout(async () => {
      try {
        await runFullPriceSync(pool);
      } catch (err) {
        console.error('[price-sync] Scheduled sync failed:', err.message);
      }
      scheduleNext();
    }, delay);
  };

  scheduleNext();

  if (runOnStart) {
    void (async () => {
      try {
        const status = await getPriceSyncStatus(pool);
        const intervalHours = Number(process.env.PRICE_SYNC_INTERVAL_HOURS ?? 24);
        const staleMs = intervalHours * 60 * 60 * 1000;
        const last = status.lastSuccessAt
          ? new Date(status.lastSuccessAt).getTime()
          : 0;
        if (Date.now() - last >= staleMs) {
          console.log('[price-sync] Last sync stale — running on startup');
          await runFullPriceSync(pool);
        }
      } catch (err) {
        console.error('[price-sync] Startup sync check failed:', err.message);
      }
    })();
  }
}

export { getPriceSyncStatus };
