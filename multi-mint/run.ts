// multi-mint — backtest → certify → mint a roster of 5 strategies
// against the canonical BTC/USDT 15m spot dataset, then write a
// summary.json the FE/season tooling can consume.
//
// Run from the examples/ folder:
//
//   tsx multi-mint/run.ts
//
// Requires examples/.env with PRIVATE_KEY set (Wallet A pays gas).

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import {
  CANONICAL_DATASETS,
  ZeroArena,
  configFromEnv,
  loadEnv,
  runBacktest,
  type BacktestOptions,
  type Dataset,
} from 'zeroarena';

import RsiAgent from '../01-rsi-spot-btc/agent.js';
import RsiAggressiveAgent from '../05-rsi-aggressive/agent.js';
import EmaCrossoverAgent from '../06-ema-crossover/agent.js';
import MacdSpotAgent from '../07-macd-spot/agent.js';
import BollingerMeanRevAgent from '../08-bollinger-meanrev/agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_KEY = 'BTCUSDT-15m-spot';

const BACKTEST_OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'spot',
  feeBps: 10,
  slippageBps: 5,
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
    slug: 'rsi-classic',
    name: 'RSI Classic 30/70',
    description: 'RSI(14) mean reversion · oversold 30 / overbought 70 · 50% size.',
    build: () => new RsiAgent(30, 70, 0.5),
  },
  {
    slug: 'rsi-aggressive',
    name: 'RSI Aggressive 25/75',
    description: 'Wider RSI bands · 25/75 · 70% size · fewer trades, larger conviction.',
    build: () => new RsiAggressiveAgent(25, 75, 0.7),
  },
  {
    slug: 'ema-crossover',
    name: 'EMA Crossover 12/26',
    description: 'Classic trend-follower · long when fast EMA > slow EMA.',
    build: () => new EmaCrossoverAgent(0.8, 5),
  },
  {
    slug: 'macd-spot',
    name: 'MACD Spot Bull',
    description: 'Long-only MACD crossover · long while MACD > signal AND > 0.',
    build: () => new MacdSpotAgent(0.6),
  },
  {
    slug: 'bollinger-meanrev',
    name: 'Bollinger Mean Reversion',
    description: 'Buy lower band, flat at upper band · 20-bar window, 2σ.',
    build: () => new BollingerMeanRevAgent(20, 2, 0.5),
  },
];

interface MintRecord {
  slug: string;
  name: string;
  description: string;
  agentJson: Record<string, unknown>;
  runHash: string;
  datasetHash: string;
  metrics: {
    totalReturnBps: number;
    sharpeX1000: number;
    sortinoX1000: number;
    maxDrawdownBps: number;
    winRateBps: number;
    profitFactorX1000: number;
    numTrades: number;
    finalEquity: number;
  };
  certId: string;
  certTx: string;
  tokenId: string;
  mintTx: string;
  storageRootHash: string;
  metadataHash: string;
}

async function main() {
  const backtestOnly = process.argv.includes('--backtest-only');
  const force = process.argv.includes('--force');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlySet = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;

  loadEnv(resolve(HERE, '..', '.env'));
  const za = new ZeroArena(configFromEnv());

  const entry = CANONICAL_DATASETS[DATASET_KEY];
  if (!entry) throw new Error(`CANONICAL_DATASETS has no entry for ${DATASET_KEY}.`);

  console.log(`▸ loading dataset from 0G Storage… rootHash=${entry.rootHash}`);
  const dataset: Dataset = await za.loadDataset({ rootHash: entry.rootHash });
  console.log(`  ${dataset.candles.length} candles, datasetHash=${dataset.datasetHash}`);
  if (backtestOnly) console.log(`  [DRY] backtest-only mode — no chain calls\n`);
  else console.log('');

  // Resume-from-chain: build runHash → tokenId map so re-runs skip agents
  // that are already minted (unless --force is set).
  const existing = backtestOnly ? new Map<string, { certId: string; tokenId: string; mintTx: string; metadataHash: string; storageRoot: string }>() : await scanExistingMints();
  if (!backtestOnly && existing.size > 0) {
    console.log(`▸ resume-from-chain: ${existing.size} existing iNFT${existing.size === 1 ? '' : 's'} found — will skip matching runHashes${force ? ' (overridden by --force)' : ''}\n`);
  }

  const records: MintRecord[] = [];

  for (const item of ROSTER) {
    if (onlySet && !onlySet.has(item.slug)) continue;
    const agent = item.build();
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`▸ ${item.name}  (${item.slug})`);
    console.log(`  ${item.description}`);

    const result = await runBacktest(agent, dataset, BACKTEST_OPTS);

    console.log(`  runHash:        ${result.runHash}`);
    console.log(`  trades:         ${result.trades.length}`);
    console.log(`  totalReturnBps: ${result.metrics.totalReturnBps}  (${(result.metrics.totalReturnBps / 100).toFixed(2)}%)`);
    console.log(`  sharpe:         ${(result.metrics.sharpeX1000 / 1000).toFixed(2)}`);
    console.log(`  maxDD:          ${result.metrics.maxDrawdownBps / 100}%`);
    console.log(`  winRate:        ${result.metrics.winRateBps / 100}%`);

    if (backtestOnly) {
      records.push({
        slug: item.slug,
        name: item.name,
        description: item.description,
        agentJson: agent.toJSON(),
        runHash: result.runHash,
        datasetHash: result.datasetHash,
        metrics: result.metrics,
        certId: '',
        certTx: '',
        tokenId: '',
        mintTx: '',
        storageRootHash: '',
        metadataHash: '',
      });
      continue;
    }

    const prior = existing.get(result.runHash.toLowerCase());
    if (prior && !force) {
      console.log(`  ↺ already minted as token #${prior.tokenId} cert #${prior.certId} — skipping (use --force to re-mint)`);
      records.push({
        slug: item.slug,
        name: item.name,
        description: item.description,
        agentJson: agent.toJSON(),
        runHash: result.runHash,
        datasetHash: result.datasetHash,
        metrics: result.metrics,
        certId: prior.certId,
        certTx: '',
        tokenId: prior.tokenId,
        mintTx: prior.mintTx,
        storageRootHash: prior.storageRoot,
        metadataHash: prior.metadataHash,
      });
      continue;
    }

    console.log(`  ▸ certify…`);
    const cert = await za.certify(result, { trustTier: 'T2' });
    console.log(`    certId  ${cert.certId}`);
    console.log(`    tx      https://chainscan-galileo.0g.ai/tx/${cert.txHash}`);

    console.log(`  ▸ mint…`);
    const inft = await za.mintAgent({
      agent,
      certificate: cert,
      name: item.name,
      description: item.description,
    });
    console.log(`    tokenId ${inft.tokenId}`);
    console.log(`    tx      https://chainscan-galileo.0g.ai/tx/${inft.txHash}\n`);

    records.push({
      slug: item.slug,
      name: item.name,
      description: item.description,
      agentJson: agent.toJSON(),
      runHash: result.runHash,
      datasetHash: result.datasetHash,
      metrics: result.metrics,
      certId: cert.certId.toString(),
      certTx: cert.txHash,
      tokenId: inft.tokenId.toString(),
      mintTx: inft.txHash,
      storageRootHash: cert.storageRootHash,
      metadataHash: inft.metadataHash,
    });
  }

  const outPath = resolve(HERE, '..', 'multi-mint-summary.json');
  await writeFile(
    outPath,
    JSON.stringify(
      {
        datasetKey: DATASET_KEY,
        datasetHash: dataset.datasetHash,
        rootHash: entry.rootHash,
        mintedAt: new Date().toISOString(),
        records,
      },
      null,
      2,
    ),
  );

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✓ done. ${records.length} agents minted.`);
  console.log(`  summary written to ${outPath}`);
}

const INFT_ABI = [
  'function ownerOf(uint256) view returns (address)',
  'function metadataHashes(uint256) view returns (bytes32)',
  'function storageRoots(uint256) view returns (bytes32)',
  'function certificateOf(uint256) view returns (uint256)',
  'function nextTokenId() view returns (uint256)',
  'event AgentMinted(uint256 indexed tokenId, address indexed owner, uint256 indexed certificateId, bytes32 metadataHash, bytes32 storageRoot)',
];
const CERT_ABI = [
  'function get(uint256) view returns ((bytes32 runHash, bytes32 storageRootHash, bytes32 datasetHash, bytes32 attestationHash, int256 totalReturnBps, uint256 sharpeX1000, uint256 maxDrawdownBps, uint256 winRateBps, address owner, uint64 createdAt, uint8 trustTier, uint8 market))',
];

/**
 * Build a (runHash → mint) lookup by scanning AgentMinted events from the
 * iNFT contract and joining with the matching certificate. Lets multi-mint
 * resume after a partial failure without re-paying gas for agents that are
 * already on-chain.
 */
async function scanExistingMints(): Promise<
  Map<string, { certId: string; tokenId: string; mintTx: string; metadataHash: string; storageRoot: string }>
> {
  const rpc = process.env.ZA_RPC;
  const inftAddr = process.env.ZA_ADDR_INFT;
  const certAddr = process.env.ZA_ADDR_CERT;
  if (!rpc || !inftAddr || !certAddr) {
    console.warn('  (scanExistingMints: missing ZA_RPC / ZA_ADDR_*; skipping resume scan)');
    return new Map();
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  const inft = new ethers.Contract(inftAddr, INFT_ABI, provider);
  const cert = new ethers.Contract(certAddr, CERT_ABI, provider);

  // Scan from deploy block (chainscan shows v0.2 contracts deployed at block
  // 33200264 — same constant the FE uses).
  const DEPLOY_BLOCK = 33_200_264;
  const filter = inft.filters.AgentMinted!();
  const logs = await inft.queryFilter(filter, DEPLOY_BLOCK, 'latest');

  const map = new Map<string, { certId: string; tokenId: string; mintTx: string; metadataHash: string; storageRoot: string }>();
  for (const log of logs) {
    // `EventLog.args` is present on ethers v6 indexed-event logs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (log as any).args;
    if (!a) continue;
    const tokenId: bigint = a.tokenId;
    const certificateId: bigint = a.certificateId;
    const metadataHash: string = a.metadataHash;
    const storageRoot: string = a.storageRoot;
    try {
      const c = await cert.get(certificateId);
      const runHashKey = String(c.runHash).toLowerCase();
      // Earliest mint wins (idempotent: re-runs resolve to the same first hit).
      if (!map.has(runHashKey)) {
        map.set(runHashKey, {
          certId: certificateId.toString(),
          tokenId: tokenId.toString(),
          mintTx: log.transactionHash,
          metadataHash,
          storageRoot,
        });
      }
    } catch (err) {
      console.warn(`  scanExistingMints: cert ${certificateId} unreadable`, err);
    }
  }
  return map;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
