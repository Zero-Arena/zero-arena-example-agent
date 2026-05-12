// 03-paper-run — bar-by-bar paper trading demo.
//
// What this proves:
//   1. PaperEngine produces byte-identical trades + equity vs BacktestEngine
//      given the same (agent, opts, candle) tuple. The "is the live runHash
//      provably continuous with the static runHash?" invariant from
//      docs/RFC-001 §8.
//   2. Every `barsPerEpoch` bars we can build an EpochCommit envelope and
//      fold its keccak into a cumulative hash chain. Off-chain replay of
//      the same epochs (genesis runHash + N epoch hashes) reproduces the
//      cumulativeHash that LiveCertificate.update() would have committed.
//
// Run: `npm run 03:paper`. No chain calls, no network — pure determinism
// proof. The on-chain wiring lives in zero-arena-bacend (Phase 1) and
// zero-arena-contracts (Phase 2); this example demonstrates the math.

import {
  PaperEngine,
  computeMetrics,
  hashAgent,
  hashOptions,
  hashTrades,
  keccak256,
  runBacktest,
  stableStringify,
  toUtf8Bytes,
  type BacktestOptions,
  type Candle,
  type Dataset,
  type Trade,
} from 'zeroarena';
import RsiPaperAgent from './agent.js';

const N_CANDLES = 200;
const BARS_PER_EPOCH = 40;
const BARS_PER_YEAR = 4 * 24 * 365; // 15m granularity

const OPTS: BacktestOptions = {
  initialBalance: 10_000,
  market: 'spot',
  feeBps: 10,
  slippageBps: 5,
};

// ─── 1. Synthesize a deterministic candle stream ──────────────────────────

function makeSyntheticCandles(n: number): Candle[] {
  const out: Candle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = 100 + Math.sin(i / 17) * 8 + Math.cos(i / 31) * 4 + i * 0.02;
    const open = base;
    const close = base + Math.sin(i / 11) * 0.5;
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    out[i] = {
      timestamp: 1_700_000_000_000 + i * 900_000, // 15m apart
      open,
      high,
      low,
      close,
      volume: 1_000 + (i % 50),
    };
  }
  return out;
}

function makeDataset(candles: Candle[]): Dataset {
  // We compute datasetHash with the same canonical-JSON convention the
  // backtest engine uses internally. Doesn't have to match a 0G Storage
  // root for this offline demo.
  const datasetHash = keccak256(toUtf8Bytes(JSON.stringify(candles))) as `0x${string}`;
  return {
    rootHash: '0x' + '00'.repeat(32),
    datasetHash,
    candles,
    meta: {
      asset: 'BTC',
      quote: 'USDT',
      market: 'spot',
      granularity: '15m',
      source: 'synthetic',
      startTs: candles[0]!.timestamp,
      endTs: candles[n_minus_one(candles)]!.timestamp,
    },
  };
}

function n_minus_one(arr: unknown[]): number {
  return arr.length - 1;
}

// ─── 2. Build the genesis runHash via the static BacktestEngine ───────────

interface GenesisOutput {
  runHash: `0x${string}`;
  agentHash: `0x${string}`;
  optionsHash: `0x${string}`;
  finalEquity: number;
  trades: Trade[];
  equityCurve: number[];
}

async function computeGenesisStaticHash(dataset: Dataset): Promise<GenesisOutput> {
  const agent = new RsiPaperAgent();
  const result = await runBacktest(agent, dataset, OPTS);
  return {
    runHash: result.runHash as `0x${string}`,
    agentHash: result.agentHash as `0x${string}`,
    optionsHash: result.optionsHash as `0x${string}`,
    finalEquity: result.metrics.finalEquity,
    trades: result.trades,
    equityCurve: result.equityCurve,
  };
}

// ─── 3. Drive PaperEngine bar-by-bar, fold an epoch chain ─────────────────

interface EpochSummary {
  index: number;
  windowStartTs: number;
  windowEndTs: number;
  tradesInEpoch: number;
  liveTotalReturnBps: number;
  liveSharpeX1000: number;
  epochHash: `0x${string}`;
  cumulativeHash: `0x${string}`;
}

async function runPaperEngine(
  agent: RsiPaperAgent,
  candles: Candle[],
  agentHash: `0x${string}`,
  optionsHash: `0x${string}`,
  genesisRunHash: `0x${string}`,
): Promise<{ engine: PaperEngine; epochs: EpochSummary[] }> {
  const engine = new PaperEngine(agent, OPTS);
  const epochs: EpochSummary[] = [];

  let cumulativeHash: `0x${string}` = genesisRunHash;
  let tradeCountAtLastEpoch = 0;
  let barCountAtLastEpoch = 0;
  let windowStartTs = 0;
  let epochIndex = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    if (windowStartTs === 0) windowStartTs = candle.timestamp;

    await engine.onCandleClose(candle);

    const epochEquity = engine.getEquityCurve().slice(barCountAtLastEpoch);
    if (epochEquity.length >= BARS_PER_EPOCH) {
      const allTrades = engine.getTrades();
      const epochTrades = allTrades.slice(tradeCountAtLastEpoch);
      const metrics = computeMetrics({
        initialBalance: OPTS.initialBalance,
        equityCurve: epochEquity,
        trades: epochTrades,
        barsPerYear: BARS_PER_YEAR,
      });

      // Build the on-chain commit payload (same shape the BE daemon uses).
      const envelope = {
        schema: 'zeroarena.epoch.v1',
        tokenId: '0', // not bound to a real token in this demo
        epochIndex,
        windowStartTs,
        windowEndTs: candle.timestamp,
        agentHash,
        optionsHash,
        tradesHash: hashTrades(epochTrades),
        barsPerYear: BARS_PER_YEAR,
        metrics: {
          totalReturnBps: metrics.totalReturnBps,
          sharpeX1000: metrics.sharpeX1000,
          maxDrawdownBps: metrics.maxDrawdownBps,
          winRateBps: metrics.winRateBps,
        },
      };
      const epochHash = keccak256(toUtf8Bytes(stableStringify(envelope))) as `0x${string}`;
      cumulativeHash = foldHash(cumulativeHash, epochHash);

      epochs.push({
        index: epochIndex,
        windowStartTs,
        windowEndTs: candle.timestamp,
        tradesInEpoch: epochTrades.length,
        liveTotalReturnBps: metrics.totalReturnBps,
        liveSharpeX1000: metrics.sharpeX1000,
        epochHash,
        cumulativeHash,
      });

      epochIndex += 1;
      tradeCountAtLastEpoch = allTrades.length;
      barCountAtLastEpoch = engine.getEquityCurve().length;
      windowStartTs = 0;
    }
  }

  return { engine, epochs };
}

function foldHash(prev: `0x${string}`, epoch: `0x${string}`): `0x${string}` {
  // Mirror the on-chain `keccak256(abi.encodePacked(prev, epoch))`.
  const prevBytes = Buffer.from(prev.slice(2), 'hex');
  const epochBytes = Buffer.from(epoch.slice(2), 'hex');
  return keccak256(Buffer.concat([prevBytes, epochBytes])) as `0x${string}`;
}

// ─── 4. Stitch it together + print a narrative ────────────────────────────

async function main(): Promise<void> {
  console.log('═══ 03-paper-run — paper trading + hash chain demo ═══\n');

  const candles = makeSyntheticCandles(N_CANDLES);
  const dataset = makeDataset(candles);
  console.log(`▸ synthetic dataset`);
  console.log(`  candles:          ${candles.length}`);
  console.log(`  datasetHash:      ${dataset.datasetHash}`);

  // Step 1: static cert (the "I commit to a backtest at block T" path).
  const genesis = await computeGenesisStaticHash(dataset);
  console.log(`\n▸ static backtest (would mint as AgentCertificate.runHash)`);
  console.log(`  agentHash:        ${genesis.agentHash}`);
  console.log(`  optionsHash:      ${genesis.optionsHash}`);
  console.log(`  runHash:          ${genesis.runHash}`);
  console.log(`  finalEquity:      ${genesis.finalEquity.toFixed(2)}`);
  console.log(`  trades:           ${genesis.trades.length}`);

  // Step 2: paper trading — feed the same candles into the streaming engine,
  // produce per-epoch commits, fold them into a hash chain.
  const paperAgent = new RsiPaperAgent();
  // Sanity: same agent + same opts → same agentHash + optionsHash.
  const agentHash = hashAgent(paperAgent) as `0x${string}`;
  const optionsHash = hashOptions(OPTS) as `0x${string}`;
  if (agentHash !== genesis.agentHash) {
    throw new Error(`agentHash mismatch: ${agentHash} vs ${genesis.agentHash}`);
  }
  if (optionsHash !== genesis.optionsHash) {
    throw new Error(`optionsHash mismatch: ${optionsHash} vs ${genesis.optionsHash}`);
  }
  console.log(`\n  ✓ paper agent + opts hash identical to static cert`);

  const { engine, epochs } = await runPaperEngine(
    paperAgent,
    candles,
    agentHash,
    optionsHash,
    genesis.runHash,
  );

  console.log(`\n▸ paper-engine epoch chain (${epochs.length} epochs of ${BARS_PER_EPOCH} bars each)`);
  console.log(`  genesis (= static runHash):`);
  console.log(`  └─ ${genesis.runHash}`);
  for (const e of epochs) {
    console.log(`  epoch ${String(e.index).padStart(2, '0')}: trades=${String(e.tradesInEpoch).padStart(2, ' ')}  return=${signed(e.liveTotalReturnBps)} bps  sharpe=${e.liveSharpeX1000}`);
    console.log(`      epochHash      ${e.epochHash}`);
    console.log(`      cumulativeHash ${e.cumulativeHash}`);
  }

  // Step 3: prove byte-equivalence with the static run.
  const paperTrades = engine.getTrades();
  const tradeMatch = hashTrades(paperTrades) === hashTrades(genesis.trades);
  const equityMatch =
    keccak256(toUtf8Bytes(stableStringify(engine.getEquityCurve()))) ===
    keccak256(toUtf8Bytes(stableStringify(genesis.equityCurve)));

  console.log(`\n▸ equivalence with static BacktestEngine`);
  console.log(`  hashTrades(paper) == hashTrades(static):   ${tradeMatch ? '✓' : '✗'}`);
  console.log(`  hash(equityCurves) match:                  ${equityMatch ? '✓' : '✗'}`);

  if (!tradeMatch || !equityMatch) {
    throw new Error('PaperEngine / BacktestEngine divergence — investigate immediately');
  }

  console.log(`\n✓ done. Final cumulativeHash would be anchored as LiveCertificate.runs(${0}).cumulativeHash.\n`);
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
