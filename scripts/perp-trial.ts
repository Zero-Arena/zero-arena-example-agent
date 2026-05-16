// 30-minute perp trial on 0G mainnet — end-to-end:
//   1. Offline backtest of MacdPerpAgent against the perp fixture
//   2. certify on AgentCertificate (T2)
//   3. mint perp iNFT
//   4. createSeason — 30-min perp window, 0.01 0G prize
//   5. enroll the iNFT
//   6. LiveCertificate.start (begin paper run)
//
// After this script returns, start the paper daemon in zero-arena-bacend/ to
// drive epoch commits. The exact env block is printed at the end.
//
// Run from examples/:
//   npx tsx scripts/perp-trial.ts

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import {
  ZeroArena,
  configFromEnv,
  loadEnv,
  parseDatasetFile,
  runBacktest,
  type BacktestOptions,
} from 'zeroarena';

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

const SEASON_ABI = [
  'function createSeason((bytes32 datasetSpec, uint64 initialBalance, uint16 feeBps, uint16 slippageBps, uint8 market, uint8 maxLeverage, uint64 startTime, uint64 endTime, uint256 prizePool, address creator, bool settled)) external payable returns (uint256)',
  'function enroll(uint256 seasonId, uint256 tokenId) external',
  'event SeasonCreated(uint256 indexed id, bytes32 indexed datasetSpec, uint64 startTime, uint64 endTime, uint256 prizePool)',
];

const LIVE_ABI = [
  'function start(uint256 tokenId, bytes32 initialCumulativeHash) external',
];

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));

  const rpc = process.env.ZA_RPC!;
  const seasonAddr = process.env.ZA_ADDR_SEASON!;
  const liveAddr = process.env.ZA_ADDR_LIVE_CERT!;
  if (!rpc || !seasonAddr || !liveAddr) {
    throw new Error('ZA_RPC + ZA_ADDR_SEASON + ZA_ADDR_LIVE_CERT must be set in examples/.env');
  }

  // ── 1. backtest ──────────────────────────────────────────────────────────
  console.log('━━━ Step 1 — backtest (offline perp fixture) ━━━');
  const dataset = await parseDatasetFile(FIXTURE_CSV);
  console.log(`  candles:       ${dataset.candles.length}`);
  console.log(`  datasetHash:   ${dataset.datasetHash}`);

  const agent = new MacdPerpAgent({
    stopLossPct: 0.02,
    takeProfitPct: 0.04,
    sizeFraction: 1.0,
  });
  const result = await runBacktest(agent, dataset, BACKTEST_OPTS);
  console.log(`  trades:        ${result.trades.length}`);
  console.log(`  return:        ${(result.metrics.totalReturnBps / 100).toFixed(2)}%`);
  console.log(`  sharpe:        ${(result.metrics.sharpeX1000 / 1000).toFixed(2)}`);
  console.log(`  maxDD:         ${(result.metrics.maxDrawdownBps / 100).toFixed(2)}%`);
  console.log(`  runHash:       ${result.runHash}`);

  // ── 2. certify on chain ─────────────────────────────────────────────────
  console.log('\n━━━ Step 2 — certify on 0G mainnet (T2) ━━━');
  const za = new ZeroArena(configFromEnv());
  const cert = await za.certify(result);
  console.log(`  certId:        ${cert.certId}`);
  console.log(`  storageRoot:   ${cert.storageRootHash}`);
  console.log(`  market byte:   ${cert.market}`);
  console.log(`  tx:            https://chainscan.0g.ai/tx/${cert.txHash}`);

  // ── 3. mint perp iNFT ────────────────────────────────────────────────────
  console.log('\n━━━ Step 3 — mint perp iNFT ━━━');
  const inft = await za.mintAgent({
    agent,
    certificate: cert,
    name: 'MACD Perp BTC v1 — trial',
    description: 'MACD perpetual trial · 30-min Season demo on 0G mainnet.',
  });
  console.log(`  tokenId:       ${inft.tokenId}`);
  console.log(`  metadataHash:  ${inft.metadataHash}`);
  console.log(`  storageRoot:   ${inft.storageRoot}`);
  console.log(`  tx:            https://chainscan.0g.ai/tx/${inft.txHash}`);

  // ── 4. create Season (30-min perp) ──────────────────────────────────────
  console.log('\n━━━ Step 4 — create 30-min perp Season ━━━');
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const season = new ethers.Contract(seasonAddr, SEASON_ABI, wallet);
  const live = new ethers.Contract(liveAddr, LIVE_ABI, wallet);

  const block = await provider.getBlock('latest');
  if (!block) throw new Error('no latest block');
  const now = Number(block.timestamp);
  const enrollSec = 60;
  const runSec = 1_800; // 30 min
  const prize = ethers.parseEther('0.01');

  const spec = {
    datasetSpec: ethers.keccak256(ethers.toUtf8Bytes('BTCUSDT-15m-perp')),
    initialBalance: 10_000n,
    feeBps: 5,
    slippageBps: 5,
    market: 1, // perp
    maxLeverage: 5,
    startTime: BigInt(now + enrollSec),
    endTime: BigInt(now + enrollSec + runSec),
    prizePool: prize,
    creator: ethers.ZeroAddress,
    settled: false,
  };
  console.log(`  datasetSpec:   keccak("BTCUSDT-15m-perp")`);
  console.log(`  market/lev:    perp / max 5x`);
  console.log(`  startTime:     ${new Date(Number(spec.startTime) * 1000).toISOString()}`);
  console.log(`  endTime:       ${new Date(Number(spec.endTime) * 1000).toISOString()}`);
  console.log(`  prizePool:     ${ethers.formatEther(prize)} 0G`);

  const txCreate = await season.createSeason(spec, { value: prize });
  const recCreate = await txCreate.wait();
  let seasonId: bigint | undefined;
  for (const log of recCreate?.logs ?? []) {
    try {
      const parsed = season.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'SeasonCreated') {
        seasonId = parsed.args.id as bigint;
        break;
      }
    } catch {
      // not a Season event; ignore
    }
  }
  if (seasonId === undefined) throw new Error('SeasonCreated event not found');
  console.log(`  seasonId:      ${seasonId}`);
  console.log(`  tx:            https://chainscan.0g.ai/tx/${txCreate.hash}`);

  // ── 5. enroll iNFT ──────────────────────────────────────────────────────
  console.log('\n━━━ Step 5 — enroll iNFT in Season ━━━');
  const txEnroll = await season.enroll(seasonId, inft.tokenId);
  await txEnroll.wait();
  console.log(`  tx:            https://chainscan.0g.ai/tx/${txEnroll.hash}`);

  // ── 6. LiveCertificate.start (paper run genesis) ───────────────────────
  console.log('\n━━━ Step 6 — LiveCertificate.start ━━━');
  const txStart = await live.start(inft.tokenId, cert.runHash);
  await txStart.wait();
  console.log(`  tx:            https://chainscan.0g.ai/tx/${txStart.hash}`);

  // ── summary ─────────────────────────────────────────────────────────────
  const endIso = new Date(Number(spec.endTime) * 1000).toISOString();
  const agentModuleAbs = resolve(HERE, '..', '02-macd-perp-btc', 'agent.ts');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✓ Trial ready. Start the paper daemon to drive live commits:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`
cd ../zero-arena-bacend

PAPER_TOKEN_ID=${inft.tokenId} \\
  PAPER_CERT_ID=${cert.certId} \\
  PAPER_GENESIS_HASH=${cert.runHash} \\
  PAPER_AGENT_MODULE=${agentModuleAbs} \\
  PAPER_SYMBOL=btcusdt \\
  PAPER_INTERVAL=15m \\
  PAPER_MARKET=perp \\
  PAPER_BARS_PER_EPOCH=1 \\
  PAPER_BACKFILL_DAYS=2 \\
  OPERATOR_PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY \\
  ZA_RPC=https://evmrpc.0g.ai \\
  ZA_ADDR_LIVE_CERT=${liveAddr} \\
  npm run paper:start
`);
  console.log(`Season #${seasonId} ends at ${endIso}.`);
  console.log(`Watch: npx tsx scripts/season-status.ts ${seasonId}\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(msg);
  process.exit(1);
});
