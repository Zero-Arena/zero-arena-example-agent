// End-to-end demo: backtest → certify → mint, against a deterministic
// 10-day BTC/USDT 1h fixture. Designed to run on the Galileo testnet.
//
// Modes:
//   tsx run.ts                  — full flow (requires .env with PRIVATE_KEY + addresses)
//   tsx run.ts --backtest-only  — runs the deterministic backtest only,
//                                 prints metrics, exits 0 (no chain calls).
//
// Required .env keys (see ../../sdk/.env.example):
//   PRIVATE_KEY, ZA_ADDR_CERT, ZA_ADDR_INFT, ZA_ADDR_ORACLE
//   (ZA_RPC + ZA_INDEXER default to the Galileo testnet endpoints)

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ZeroArena,
  runBacktest,
  type BacktestOptions,
} from 'zeroarena';
import { StorageAdapter } from 'zeroarena/dist/storage/StorageAdapter.js';
import { configFromEnv, loadEnv } from 'zeroarena/dist/cli/env.js';
import RsiAgent from './agent.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = resolve(here, 'data', 'btc-usdt-1h.csv');

const BACKTEST_OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'spot',
  feeBps: 10,
  slippageBps: 5,
};

async function main() {
  const backtestOnly = process.argv.includes('--backtest-only');
  const dataset = await StorageAdapter.parseDatasetFile(FIXTURE_CSV);
  const agent = new RsiAgent(30, 70, 0.5);

  console.log(`▸ dataset: ${dataset.candles.length} candles  datasetHash=${dataset.datasetHash}`);
  console.log(`▸ agent:   ${JSON.stringify(agent.toJSON())}`);

  // ── 1. backtest ──────────────────────────────────────────────────────────
  const result = await runBacktest(agent, dataset, BACKTEST_OPTS);
  console.log('\n▸ backtest result');
  console.log(`  runHash:        ${result.runHash}`);
  console.log(`  trades:         ${result.trades.length}`);
  console.log(`  totalReturnBps: ${result.metrics.totalReturnBps}`);
  console.log(`  sharpeX1000:    ${result.metrics.sharpeX1000}`);
  console.log(`  finalEquity:    ${result.metrics.finalEquity.toFixed(2)}`);

  if (backtestOnly) return;

  // ── 2. certify ───────────────────────────────────────────────────────────
  loadEnv(resolve(here, '..', '..', 'sdk', '.env'));
  loadEnv(); // also try ./.env in cwd
  const za = new ZeroArena(configFromEnv());

  console.log('\n▸ certifying on 0G Chain (T2)…');
  const cert = await za.certify(result, { trustTier: 'T2' });
  console.log(`  certId:          ${cert.certId}`);
  console.log(`  storageRootHash: ${cert.storageRootHash}`);
  console.log(`  txHash:          ${cert.txHash}`);

  // ── 3. mint iNFT ─────────────────────────────────────────────────────────
  console.log('\n▸ minting iNFT…');
  const inft = await za.mintAgent({
    agent,
    certificate: cert,
    name: 'RSI BTC Spot v1',
    description: 'RSI(14) mean-reversion on BTC/USDT 1h spot. Reference agent.',
  });
  console.log(`  tokenId:      ${inft.tokenId}`);
  console.log(`  metadataHash: ${inft.metadataHash}`);
  console.log(`  storageRoot:  ${inft.storageRoot}`);
  console.log(`  txHash:       ${inft.txHash}`);

  console.log('\n✓ done. Trust tier: T2 (commitment + reproducibility). T3 ships in v0.2.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
