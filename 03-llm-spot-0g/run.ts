// backtest → certify → mint on 0G/USDT 15m spot with an LLM-driven agent.
//
// Requires examples/.env and (optionally) ANTHROPIC_API_KEY. Without the
// key the agent uses a deterministic offline fallback so the pipeline still
// runs end-to-end on Galileo.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_DATASETS,
  ZeroArena,
  configFromEnv,
  loadEnv,
  runBacktest,
  type BacktestOptions,
} from 'zeroarena';
import LlmAgent from './agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_KEY = '0GUSDT-15m-spot';

const BACKTEST_OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'spot',
  takerFeeBps: 10,
  slippageBps: 5,
};

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));
  const za = new ZeroArena(configFromEnv());

  const entry = CANONICAL_DATASETS[DATASET_KEY];
  if (!entry) {
    throw new Error(
      `CANONICAL_DATASETS has no entry for ${DATASET_KEY} — add it by running \`npx zeroarena dataset ingest --symbol 0GUSDT --interval 15m --from 2025-09-22 --upload\` then updating sdk/src/datasets.ts.`,
    );
  }

  console.log(`▸ loading dataset from 0G Storage… rootHash=${entry.rootHash}`);
  const dataset = await za.loadDataset({ rootHash: entry.rootHash });
  console.log(`  ${dataset.candles.length} candles, datasetHash=${dataset.datasetHash}`);

  const hasKey = (process.env.ANTHROPIC_API_KEY ?? '').length > 0;
  console.log(`▸ agent: LlmAgent (${hasKey ? 'live Claude API' : 'offline fallback'})`);

  const agent = new LlmAgent();
  const result = await runBacktest(agent, dataset, BACKTEST_OPTS);
  console.log('\n▸ backtest result');
  console.log(`  runHash:        ${result.runHash}`);
  console.log(`  trades:         ${result.trades.length}`);
  console.log(`  totalReturnBps: ${result.metrics.totalReturnBps}`);
  console.log(`  sharpeX1000:    ${result.metrics.sharpeX1000}`);
  console.log(`  maxDrawdownBps: ${result.metrics.maxDrawdownBps}`);
  console.log(`  winRateBps:     ${result.metrics.winRateBps}`);
  console.log(`  finalEquity:    ${result.metrics.finalEquity.toFixed(2)}`);

  console.log('\n▸ certifying on 0G Chain (T2)…');
  const cert = await za.certify(result, { trustTier: 'T2' });
  console.log(`  certId:   ${cert.certId}`);
  console.log(`  txHash:   ${cert.txHash}`);
  console.log(`  explorer: https://chainscan-galileo.0g.ai/tx/${cert.txHash}`);

  console.log('\n▸ minting iNFT…');
  const inft = await za.mintAgent({
    agent,
    certificate: cert,
    name: 'LLM 0G Spot v1',
    description: 'Claude-driven directional agent on 0G/USDT 15m spot.',
  });
  console.log(`  tokenId:  ${inft.tokenId}`);
  console.log(`  txHash:   ${inft.txHash}`);
  console.log(`  explorer: https://chainscan-galileo.0g.ai/tx/${inft.txHash}`);

  console.log('\n✓ done. Trust tier: T2.');
  console.log('  LLM responses are recorded in the run log and committed via runHash,');
  console.log('  but re-runs with a different model output produce a different runHash.');
  console.log('  v0.2 lifts this to T3 via 0G Compute TEE + TeeTLS-signed receipts.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
