// Zero Arena — Agent Starter: end-to-end runner
// ------------------------------------------------------------
// This is the script every developer runs to register their agent on 0G.
// You don't need to modify it — just edit `agent.ts` and run:
//
//   npm run starter             — full e2e on the live 0G dataset (default)
//   npm run starter -- --backtest-only   — backtest without chain calls
//
// What it does, step by step:
//   1. Load the canonical BTC/USDT 15m dataset from 0G Storage. The
//      rootHash is pinned in `zero-arena-bacend/data/datasets.lock.json`
//      and maintained by the backend service (see ../../zero-arena-bacend/).
//   2. Run a deterministic backtest of YOUR agent against that data.
//   3. Encrypt the run log with AES-256-GCM, upload to 0G Storage,
//      anchor a Certificate on 0G Chain.
//   4. Mint the agent as an ERC-7857 iNFT pointed at the certificate.
//
// Trust tier: T2 (commitment + reproducibility). T3 (TEE-attested via
// 0G Compute Sealed Inference) ships in v0.2 with no API change.

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
import { configFromEnv, loadEnv } from 'zeroarena/dist/cli/env.js';
import MyAgent from './agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = resolve(HERE, '..', '..', 'zero-arena-bacend', 'data', 'datasets.lock.json');
const DATASET_KEY = 'BTCUSDT-15m-spot';

// ─── tunables you may want to change ────────────────────────────────────
const AGENT_NAME = 'My First Agent';                      // shows up on the iNFT
const AGENT_DESCRIPTION = 'Starter template — replace me.'; // public description
const BACKTEST_OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'spot',                // 'spot' | 'perp'
  feeBps: 10,                    // 0.10% taker
  slippageBps: 5,                // 0.05% slippage per fill
  // For perp:
  // leverage: 3,
  // liquidationMarginBps: 500,
};

async function main() {
  const backtestOnly = process.argv.includes('--backtest-only');

  // ── 1. load dataset from 0G ─────────────────────────────────────────────
  loadEnv(resolve(HERE, '..', '..', 'sdk', '.env'));
  loadEnv();
  const za = new ZeroArena(configFromEnv());

  if (!existsSync(LOCK_PATH)) {
    throw new Error(
      `${LOCK_PATH} not found. Bootstrap the dataset first: cd ../zero-arena-bacend && npm run dataset:upload`,
    );
  }
  const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as Record<string, { rootHash: string; candleCount: number }>;
  const entry = lock[DATASET_KEY];
  if (!entry) {
    throw new Error(`Lock has no entry for ${DATASET_KEY}. Re-run the backend: cd ../zero-arena-bacend && npm run dataset:upload`);
  }
  console.log(`▸ loading dataset from 0G Storage… (${entry.candleCount} candles)`);
  console.log(`  rootHash=${entry.rootHash}`);
  const dataset: Dataset = await za.loadDataset({ rootHash: entry.rootHash });
  console.log(`  datasetHash=${dataset.datasetHash}`);

  // ── 2. backtest ─────────────────────────────────────────────────────────
  const agent = new MyAgent(/* hyperparams */);
  console.log(`\n▸ agent: ${JSON.stringify(agent.toJSON())}`);

  const result = await runBacktest(agent, dataset, BACKTEST_OPTS);
  console.log('\n▸ backtest result');
  console.log(`  runHash:        ${result.runHash}`);
  console.log(`  trades:         ${result.trades.length}`);
  console.log(`  totalReturnBps: ${result.metrics.totalReturnBps}  (= ${(result.metrics.totalReturnBps / 100).toFixed(2)}%)`);
  console.log(`  sharpeX1000:    ${result.metrics.sharpeX1000}`);
  console.log(`  maxDrawdownBps: ${result.metrics.maxDrawdownBps}`);
  console.log(`  winRateBps:     ${result.metrics.winRateBps}`);
  console.log(`  finalEquity:    ${result.metrics.finalEquity.toFixed(2)}`);

  if (backtestOnly) {
    console.log('\n--backtest-only set — skipping certify + mint.');
    return;
  }

  // The on-chain ZeroArenaINFT.mint() requires totalReturnBps >= 0 and
  // sharpeX1000 >= 1000 by default. Loud-fail early so devs don't burn
  // gas on a guaranteed-revert tx.
  if (result.metrics.totalReturnBps < 0 || result.metrics.sharpeX1000 < 1000) {
    console.warn(
      `\n⚠ This run does NOT clear the default mint thresholds (return ≥ 0 bps, sharpe ≥ 1.0).` +
      `\n  certify will still succeed; mint will revert with ThresholdNotMet.` +
      `\n  Tune your agent until the metrics pass — that's the point of this test gate.`,
    );
    process.exit(2);
  }

  // ── 3. certify ──────────────────────────────────────────────────────────
  console.log('\n▸ certifying on 0G Chain (T2)…');
  const cert = await za.certify(result, { trustTier: 'T2' });
  console.log(`  certId:          ${cert.certId}`);
  console.log(`  storageRootHash: ${cert.storageRootHash}`);
  console.log(`  txHash:          ${cert.txHash}`);
  console.log(`  explorer:        https://chainscan-galileo.0g.ai/tx/${cert.txHash}`);

  // ── 4. mint iNFT ────────────────────────────────────────────────────────
  console.log('\n▸ minting iNFT…');
  const inft = await za.mintAgent({
    agent,
    certificate: cert,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
  });
  console.log(`  tokenId:      ${inft.tokenId}`);
  console.log(`  metadataHash: ${inft.metadataHash}`);
  console.log(`  storageRoot:  ${inft.storageRoot}`);
  console.log(`  txHash:       ${inft.txHash}`);
  console.log(`  explorer:     https://chainscan-galileo.0g.ai/tx/${inft.txHash}`);
  console.log(`\n✓ done — your agent is now an ERC-7857 iNFT on 0G.`);
  console.log(`  Token: https://chainscan-galileo.0g.ai/token/${process.env.ZA_ADDR_INFT}/${inft.tokenId}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
