// MACD momentum on BTC perp, offline fixture. No chain calls.
// Run: npm run 02:backtest

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDatasetFile, runBacktest, type BacktestOptions } from 'zeroarena';
import MacdPerpAgent from './agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = resolve(HERE, 'data', 'btc-perp-fixture.csv');

const BACKTEST_OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'perp',
  leverage: 5,
  takerFeeBps: 5,           // Binance VIP-0 perp taker
  slippageBps: 5,           // 0.05% per fill
  liquidationMarginBps: 500, // 5% maintenance margin
};

async function main(): Promise<void> {
  const dataset = await parseDatasetFile(FIXTURE_CSV);
  console.log(`▸ dataset (offline LCG perp fixture): ${dataset.candles.length} candles`);
  console.log(`  datasetHash=${dataset.datasetHash}`);
  console.log(`  market=${dataset.meta.market} granularity=${dataset.meta.granularity}`);

  const agent = new MacdPerpAgent({
    stopLossPct: 0.02,
    takeProfitPct: 0.04,
    sizeFraction: 1.0,
  });
  console.log(`▸ agent: ${JSON.stringify(agent.toJSON())}`);
  console.log(`▸ options: ${JSON.stringify(BACKTEST_OPTS)}`);

  const result = await runBacktest(agent, dataset, BACKTEST_OPTS);

  console.log('\n▸ backtest result');
  console.log(`  runHash:           ${result.runHash}`);
  console.log(`  trades:            ${result.trades.length}`);
  console.log(`  totalReturnBps:    ${result.metrics.totalReturnBps}  (= ${(result.metrics.totalReturnBps / 100).toFixed(2)}%)`);
  console.log(`  sharpeX1000:       ${result.metrics.sharpeX1000}`);
  console.log(`  sortinoX1000:      ${result.metrics.sortinoX1000}`);
  console.log(`  profitFactorX1000: ${result.metrics.profitFactorX1000}`);
  console.log(`  maxDrawdownBps:    ${result.metrics.maxDrawdownBps}`);
  console.log(`  winRateBps:        ${result.metrics.winRateBps}`);
  console.log(`  finalEquity:       ${result.metrics.finalEquity.toFixed(2)}`);

  // Surface perp-specific events from the trade log.
  const buckets: Record<string, number> = {};
  for (const t of result.trades) buckets[t.reason] = (buckets[t.reason] ?? 0) + 1;
  console.log(`\n▸ trade-reason breakdown:`);
  for (const [reason, count] of Object.entries(buckets).sort()) {
    console.log(`  ${reason.padEnd(14)} ${count}`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(msg);
  process.exit(1);
});
