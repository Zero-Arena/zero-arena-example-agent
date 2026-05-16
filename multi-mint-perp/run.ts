// multi-mint-perp — backtest → certify → mint a roster of 4 perp
// strategies against the offline BTC perp fixture, then write a
// summary the perp Season tooling can consume.
//
// Run from the examples/ folder:
//
//   tsx multi-mint-perp/run.ts
//
// Mirrors multi-mint/ but with `market: 'perp'` + perp leverage. Reuses
// agents from spot examples by passing `direction: -1` shorts where
// appropriate and adding the perp-native MACD agent. Resume-aware: skips
// minting if the runHash is already on chain.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import {
  ZeroArena,
  configFromEnv,
  loadEnv,
  parseDatasetFile,
  runBacktest,
  type BacktestOptions,
  type Dataset,
} from 'zeroarena';

import RsiAgent from '../01-rsi-spot-btc/agent.js';
import RsiAggressiveAgent from '../05-rsi-aggressive/agent.js';
import EmaCrossoverAgent from '../06-ema-crossover/agent.js';
import MacdPerpAgent from '../02-macd-perp-btc/agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = resolve(HERE, '..', '02-macd-perp-btc', 'data', 'btc-perp-fixture.csv');

const BACKTEST_OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'perp',
  leverage: 5,
  takerFeeBps: 5,
  slippageBps: 5,
  liquidationMarginBps: 500,
};

interface AgentEntry {
  slug: string;
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any;
}

const ROSTER: AgentEntry[] = [
  {
    slug: 'macd-perp-bull',
    name: 'MACD Perp Bull/Bear 5x',
    description: 'MACD crossover with directional confirmation · 5x lev · SL 2% / TP 4%.',
    build: () => new MacdPerpAgent({ stopLossPct: 0.02, takeProfitPct: 0.04, sizeFraction: 1.0 }),
  },
  {
    slug: 'rsi-perp-classic',
    name: 'RSI Perp 30/70',
    description: 'RSI(14) mean-reversion on perp · 5x lev · 50% size.',
    build: () => new RsiAgent(30, 70, 0.5),
  },
  {
    slug: 'rsi-perp-aggressive',
    name: 'RSI Perp Aggressive 25/75',
    description: 'Wider RSI bands · 25/75 · 5x lev · 70% size.',
    build: () => new RsiAggressiveAgent(25, 75, 0.7),
  },
  {
    slug: 'ema-perp-crossover',
    name: 'EMA Perp Crossover 12/26',
    description: 'EMA(12) > EMA(26) trend-follower · 5x lev · 80% size.',
    build: () => new EmaCrossoverAgent(0.8, 5),
  },
];

interface MintRecord {
  slug: string;
  name: string;
  description: string;
  certId: number;
  tokenId: number;
  runHash: string;
  datasetHash: string;
  storageRoot: string;
  metadataHash: string;
  totalReturnBps: number;
  sharpeX1000: number;
  maxDrawdownBps: number;
  winRateBps: number;
  market: string;
  leverage: number;
  certTx?: string;
  mintTx?: string;
  skipped?: boolean;
}

async function main(): Promise<void> {
  loadEnv(resolve(HERE, '..', '.env'));
  const cfg = configFromEnv();
  const za = new ZeroArena(cfg);

  console.log(`▸ loading perp fixture: ${FIXTURE_CSV}`);
  const dataset: Dataset = await parseDatasetFile(FIXTURE_CSV);
  console.log(`  ${dataset.candles.length} candles · datasetHash=${dataset.datasetHash}`);
  console.log(`  market=${dataset.meta.market} granularity=${dataset.meta.granularity}\n`);

  const records: MintRecord[] = [];

  for (const entry of ROSTER) {
    console.log(`\n▸ ${entry.name}  (${entry.slug})`);
    const agent = entry.build();
    console.log(`  config: ${JSON.stringify(agent.toJSON())}`);

    const result = await runBacktest(agent, dataset, BACKTEST_OPTS);
    console.log(`  runHash=${result.runHash}`);
    console.log(
      `  return=${(result.metrics.totalReturnBps / 100).toFixed(2)}% sharpe=${(result.metrics.sharpeX1000 / 1000).toFixed(2)} dd=${(result.metrics.maxDrawdownBps / 100).toFixed(2)}% winRate=${(result.metrics.winRateBps / 100).toFixed(2)}%`,
    );

    let cert;
    try {
      cert = await za.certify(result, { onDuplicate: 'skip' });
      console.log(
        `  ${cert.skipped ? 'cert exists' : 'cert anchored'} certId=${cert.certId} tx=${cert.tx ?? '(prior)'}`,
      );
    } catch (err: unknown) {
      console.log(`  ✗ certify failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    let inft;
    try {
      inft = await za.mintAgent({
        agent: entry.build(),
        certificate: cert,
        name: entry.name,
        description: entry.description,
      });
      console.log(`  minted tokenId=${inft.tokenId} tx=${inft.tx}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('AlreadyMinted') || msg.includes('already')) {
        console.log(`  iNFT already minted for this cert — skipping`);
        continue;
      }
      console.log(`  ✗ mint failed: ${msg}`);
      continue;
    }

    records.push({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      certId: Number(cert.certId),
      tokenId: Number(inft.tokenId),
      runHash: result.runHash,
      datasetHash: dataset.datasetHash,
      storageRoot: cert.storageRootHash,
      metadataHash: inft.metadataHash,
      totalReturnBps: result.metrics.totalReturnBps,
      sharpeX1000: result.metrics.sharpeX1000,
      maxDrawdownBps: result.metrics.maxDrawdownBps,
      winRateBps: result.metrics.winRateBps,
      market: 'perp',
      leverage: 5,
      certTx: cert.tx,
      mintTx: inft.tx,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    market: 'perp' as const,
    leverage: 5,
    fixture: 'btc-perp-fixture.csv',
    records,
  };
  const out = resolve(HERE, '..', 'multi-mint-perp-summary.json');
  await writeFile(out, JSON.stringify(summary, null, 2));
  console.log(`\n✓ wrote ${out}  (${records.length} records)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
