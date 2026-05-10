// 00-binance-ingest — pull BTC/USDT 1h candles from Binance, normalize,
// upload to 0G Storage, and maintain a lock file so future runs only fetch
// the delta since the last ingest.
//
// Modes:
//   tsx ingest.ts                  → bootstrap (or extend) the dataset to "now"
//   tsx ingest.ts --dry            → fetch + canonicalize, skip upload
//   tsx ingest.ts --start 2025-01  → override the bootstrap start (YYYY-MM)
//   tsx ingest.ts --symbol ETHUSDT → ingest a different pair
//
// Lock file: ../data/datasets.lock.json — committed so cross-machine runs
// resolve the same canonical rootHash for a given (symbol, interval, endTs)
// tuple. The actual CSV bytes live on 0G Storage (not in git).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZeroArena, type Candle, type DatasetMeta } from 'zeroarena';
import { StorageAdapter } from 'zeroarena/dist/storage/StorageAdapter.js';
import { configFromEnv, loadEnv } from 'zeroarena/dist/cli/env.js';
import { fetchKlines } from './binance.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '..', 'data');
const LOCK_PATH = resolve(DATA_DIR, 'datasets.lock.json');

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_START = Date.UTC(2025, 0, 1); // 2025-01-01 00:00 UTC
const DEFAULT_SYMBOL = 'BTCUSDT';
const INTERVAL = '1h';

interface LockEntry {
  symbol: string;
  interval: string;
  market: 'spot' | 'perp';
  source: string;
  rootHash: string;
  datasetHash: string;
  startTs: number;
  endTs: number;
  candleCount: number;
  uploadedAt: string;
  history: Array<{
    rootHash: string;
    datasetHash: string;
    endTs: number;
    candleCount: number;
    uploadedAt: string;
  }>;
}

interface Lock {
  [datasetKey: string]: LockEntry;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = args.symbol ?? DEFAULT_SYMBOL;
  const datasetKey = `${symbol}-${INTERVAL}-spot`;
  const csvPath = resolve(DATA_DIR, `${symbol.toLowerCase()}-${INTERVAL}.csv`);

  await mkdir(DATA_DIR, { recursive: true });
  const lock = await loadLock();
  const existing = lock[datasetKey];

  const now = Math.floor(Date.now() / HOUR_MS) * HOUR_MS; // round down to hour
  let startTs: number;
  let priorCandles: Candle[] = [];

  if (existing && !args.start) {
    // Incremental: continue from one bar after the last fetched candle.
    startTs = existing.endTs + HOUR_MS;
    if (existsSync(csvPath)) {
      const ds = await StorageAdapter.parseDatasetFile(csvPath);
      priorCandles = ds.candles;
      console.log(`▸ resuming: ${priorCandles.length} prior candles, last ts=${new Date(existing.endTs).toISOString()}`);
    } else {
      console.log(`▸ lock present but local CSV missing — re-bootstrapping from ${new Date(existing.startTs).toISOString()}`);
      startTs = existing.startTs;
    }
  } else {
    startTs = args.start ?? DEFAULT_START;
    console.log(`▸ bootstrap: from ${new Date(startTs).toISOString()}`);
  }

  if (startTs >= now) {
    console.log(`▸ already up-to-date (next ts ${new Date(startTs).toISOString()} ≥ now ${new Date(now).toISOString()})`);
    return;
  }

  console.log(`▸ fetching ${symbol} ${INTERVAL} from ${new Date(startTs).toISOString()} to ${new Date(now).toISOString()}`);
  const fresh = await fetchKlines({
    symbol,
    interval: INTERVAL,
    startTs,
    endTs: now,
    onPage: (page, total) => process.stdout.write(`  page ${page}: ${total} candles\r`),
  });
  process.stdout.write('\n');

  if (fresh.length === 0) {
    console.log(`▸ no new candles returned by Binance`);
    return;
  }

  // Merge: dedupe by timestamp, sort.
  const merged = mergeCandles(priorCandles, fresh);
  const meta: DatasetMeta = {
    asset: symbol.replace(/USDT$/, ''),
    quote: 'USDT',
    market: 'spot',
    granularity: INTERVAL,
    source: 'binance',
    startTs: merged[0]!.timestamp,
    endTs: merged[merged.length - 1]!.timestamp,
  };

  console.log(`▸ canonicalizing ${merged.length} total candles → ${csvPath}`);
  const { datasetHash } = await StorageAdapter.writeCanonicalCsv(csvPath, meta, merged);
  console.log(`  datasetHash=${datasetHash}`);

  if (args.dry) {
    console.log(`▸ --dry passed; skipping upload + lock write`);
    return;
  }

  // Upload to 0G Storage.
  loadEnv(resolve(HERE, '..', '..', 'sdk', '.env'));
  loadEnv();
  const za = new ZeroArena(configFromEnv());
  console.log(`▸ uploading to 0G Storage…`);
  const ds = await za.uploadDataset(csvPath);
  console.log(`  rootHash=${ds.rootHash}`);

  // Update lock file (append to history).
  const uploadedAt = new Date().toISOString();
  const newHistory = existing?.history ?? [];
  if (existing) {
    newHistory.push({
      rootHash: existing.rootHash,
      datasetHash: existing.datasetHash,
      endTs: existing.endTs,
      candleCount: existing.candleCount,
      uploadedAt: existing.uploadedAt,
    });
  }
  lock[datasetKey] = {
    symbol,
    interval: INTERVAL,
    market: 'spot',
    source: 'binance',
    rootHash: ds.rootHash,
    datasetHash,
    startTs: meta.startTs,
    endTs: meta.endTs,
    candleCount: merged.length,
    uploadedAt,
    history: newHistory,
  };
  await writeFile(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
  console.log(`✓ lock updated: ${LOCK_PATH}`);
  console.log(`  ${datasetKey} → rootHash=${ds.rootHash}`);
}

function mergeCandles(prior: Candle[], fresh: Candle[]): Candle[] {
  const m = new Map<number, Candle>();
  for (const c of prior) m.set(c.timestamp, c);
  for (const c of fresh) m.set(c.timestamp, c);
  return [...m.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function loadLock(): Promise<Lock> {
  if (!existsSync(LOCK_PATH)) return {};
  return JSON.parse(await readFile(LOCK_PATH, 'utf8')) as Lock;
}

interface CliArgs {
  start?: number;
  symbol?: string;
  dry: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') out.dry = true;
    else if (a === '--symbol') out.symbol = argv[++i];
    else if (a === '--start') {
      const v = argv[++i] ?? '';
      // Accept YYYY-MM or YYYY-MM-DD or ms epoch
      if (/^\d+$/.test(v)) out.start = Number(v);
      else if (/^\d{4}-\d{2}$/.test(v)) out.start = Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, 1);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v))
        out.start = Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10)));
      else throw new Error(`--start must be YYYY-MM, YYYY-MM-DD, or ms epoch (got ${v})`);
    }
  }
  return out;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
