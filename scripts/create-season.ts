// Create a Season on-chain. Defaults: enrollment window opens in 5min,
// runs for 60min, prize pool 0.3 0G. Override via env for shorter test
// runs:
//
//   SEASON_ENROLL_SEC=180 SEASON_RUN_SEC=1620 SEASON_PRIZE_OG=0.05 \
//     npm run season:create
//
// Admin (Wallet A) transfers the prize as msg.value.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { loadEnv } from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));

const SEASON_ABI = [
  `function createSeason((bytes32 datasetSpec, uint64 initialBalance, uint16 feeBps, uint16 slippageBps, uint8 market, uint8 maxLeverage, uint64 startTime, uint64 endTime, uint256 prizePool, address creator, bool settled)) external payable returns (uint256)`,
  'function nextSeasonId() view returns (uint256)',
  'event SeasonCreated(uint256 indexed id, bytes32 indexed datasetSpec, uint64 startTime, uint64 endTime, uint256 prizePool)',
];

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));

  const rpc = process.env.ZA_RPC!;
  const pk = process.env.PRIVATE_KEY!;
  const seasonAddr = process.env.ZA_ADDR_SEASON!;
  if (!seasonAddr) {
    throw new Error('ZA_ADDR_SEASON not set — see examples/.env.example');
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const season = new ethers.Contract(seasonAddr, SEASON_ABI, wallet);

  const block = await provider.getBlock('latest');
  if (!block) throw new Error('no latest block');
  const now = Number(block.timestamp);

  const enrollSec = Number(process.env.SEASON_ENROLL_SEC ?? '300'); // default 5 min
  const runSec = Number(process.env.SEASON_RUN_SEC ?? '3600'); // default 60 min
  const prizeOg = process.env.SEASON_PRIZE_OG ?? '0.3';
  const marketName = (process.env.SEASON_MARKET ?? 'spot').toLowerCase();
  const market = marketName === 'perp' ? 1 : 0;
  const maxLeverage = Number(process.env.SEASON_MAX_LEVERAGE ?? (market === 1 ? '5' : '1'));
  const datasetSpecLabel = process.env.SEASON_DATASET_LABEL ?? `BTCUSDT-15m-${marketName}`;

  const datasetSpec = ethers.keccak256(ethers.toUtf8Bytes(datasetSpecLabel));
  const startTime = BigInt(now + enrollSec);
  const endTime = BigInt(now + enrollSec + runSec);
  const prizePool = ethers.parseEther(prizeOg);

  console.log(`creating season:`);
  console.log(`  datasetSpec  ${datasetSpec}`);
  console.log(`  startTime    ${new Date(Number(startTime) * 1000).toISOString()}`);
  console.log(`  endTime      ${new Date(Number(endTime) * 1000).toISOString()}`);
  console.log(`  prizePool    ${ethers.formatEther(prizePool)} 0G`);

  const spec = {
    datasetSpec,
    initialBalance: 10_000n,
    feeBps: market === 1 ? 5 : 10,
    slippageBps: 5,
    market,
    maxLeverage,
    startTime,
    endTime,
    prizePool,
    creator: ethers.ZeroAddress,
    settled: false,
  };

  console.log(`  market       ${marketName} (enum=${market}, maxLev=${maxLeverage}x)`);
  console.log(`  datasetSpec  ${datasetSpecLabel}`);

  const tx = await season.createSeason(spec, { value: prizePool });
  console.log(`tx           ${tx.hash}`);
  const rec = await tx.wait();
  console.log(`✓ confirmed in block ${rec?.blockNumber}`);

  const next = await season.nextSeasonId();
  console.log(`nextSeasonId now ${next}  (just-created id = ${next - 1n})`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
