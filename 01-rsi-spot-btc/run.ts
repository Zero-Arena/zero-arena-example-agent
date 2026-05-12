// End-to-end demo: backtest → certify → mint, against real Binance BTC/USDT
// 15-minute data anchored on 0G Storage (maintained by zero-arena-bacend).
//
// Modes:
//   tsx run.ts                  — full e2e on the live 0G-anchored dataset
//                                 (requires .env + a populated datasets.lock.json
//                                 produced by `cd ../zero-arena-bacend && npm run dataset:upload`)
//   tsx run.ts --backtest-only  — fast offline smoke against the bundled LCG
//                                 fixture (1h synthetic data); no chain or storage calls.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ZeroArena,
  runBacktest,
  type BacktestOptions,
  type Dataset,
} from 'zeroarena';
import { StorageAdapter } from 'zeroarena/dist/storage/StorageAdapter.js';
import { configFromEnv, loadEnv } from 'zeroarena/dist/cli/env.js';
import RsiAgent from './agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = resolve(HERE, 'data', 'btc-usdt-1h.csv'); // LCG synthetic, offline-only
const LOCK_PATH = resolve(HERE, '..', '..', 'zero-arena-bacend', 'data', 'datasets.lock.json');
const DATASET_KEY = 'BTCUSDT-15m-spot';

const BACKTEST_OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'spot',
  feeBps: 10,
  slippageBps: 5,
};

async function main() {
  const backtestOnly = process.argv.includes('--backtest-only');

  // ── 0. resolve dataset ──────────────────────────────────────────────────
  let dataset: Dataset;
  let za: ZeroArena | undefined;

  if (backtestOnly) {
    dataset = await StorageAdapter.parseDatasetFile(FIXTURE_CSV);
    console.log(`▸ dataset (offline LCG fixture): ${dataset.candles.length} candles`);
    console.log(`  datasetHash=${dataset.datasetHash}`);
  } else {
    loadEnv(resolve(HERE, '..', '..', 'sdk', '.env'));
    loadEnv();
    za = new ZeroArena(configFromEnv());

    if (!existsSync(LOCK_PATH)) {
      throw new Error(
        `${LOCK_PATH} not found. Bootstrap the dataset first: cd ../zero-arena-bacend && npm run dataset:upload`,
      );
    }
    const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as Record<string, { rootHash: string }>;
    const entry = lock[DATASET_KEY];
    if (!entry) {
      throw new Error(`Lock file has no entry for ${DATASET_KEY}. Re-run the backend: cd ../zero-arena-bacend && npm run dataset:upload`);
    }
    console.log(`▸ loading dataset from 0G Storage… rootHash=${entry.rootHash}`);
    dataset = await za.loadDataset({ rootHash: entry.rootHash });
    console.log(`  ${dataset.candles.length} candles, datasetHash=${dataset.datasetHash}`);
  }

  // ── 1. backtest ──────────────────────────────────────────────────────────
  const agent = new RsiAgent(30, 70, 0.5);
  console.log(`▸ agent: ${JSON.stringify(agent.toJSON())}`);

  const result = await runBacktest(agent, dataset, BACKTEST_OPTS);
  console.log('\n▸ backtest result');
  console.log(`  runHash:        ${result.runHash}`);
  console.log(`  trades:         ${result.trades.length}`);
  console.log(`  totalReturnBps: ${result.metrics.totalReturnBps}`);
  console.log(`  sharpeX1000:    ${result.metrics.sharpeX1000}`);
  console.log(`  maxDrawdownBps: ${result.metrics.maxDrawdownBps}`);
  console.log(`  winRateBps:     ${result.metrics.winRateBps}`);
  console.log(`  finalEquity:    ${result.metrics.finalEquity.toFixed(2)}`);

  if (backtestOnly || !za) return;

  // ── 2. certify ───────────────────────────────────────────────────────────
  console.log('\n▸ certifying on 0G Chain (T2)…');
  const cert = await za.certify(result, { trustTier: 'T2' });
  console.log(`  certId:          ${cert.certId}`);
  console.log(`  storageRootHash: ${cert.storageRootHash}`);
  console.log(`  txHash:          ${cert.txHash}`);
  console.log(`  explorer:        https://chainscan-galileo.0g.ai/tx/${cert.txHash}`);

  // ── 3. mint iNFT ─────────────────────────────────────────────────────────
  console.log('\n▸ minting iNFT…');
  const inft = await za.mintAgent({
    agent,
    certificate: cert,
    name: 'RSI BTC Spot v1',
    description: 'RSI(14) mean-reversion on BTC/USDT 15m spot. Reference agent.',
  });
  console.log(`  tokenId:      ${inft.tokenId}`);
  console.log(`  metadataHash: ${inft.metadataHash}`);
  console.log(`  storageRoot:  ${inft.storageRoot}`);
  console.log(`  txHash:       ${inft.txHash}`);
  console.log(`  explorer:     https://chainscan-galileo.0g.ai/tx/${inft.txHash}`);

  console.log('\n✓ done. Trust tier: T2 (commitment + reproducibility). T3 ships in v0.2.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
