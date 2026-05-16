// Read on-chain season + LiveCertificate state for the given seasonId and
// print the live ranking (top-3 podium + table).

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import { loadEnv } from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));

const SEASON_ABI = [
  'function seasons(uint256) view returns (bytes32 datasetSpec, uint64 initialBalance, uint16 feeBps, uint16 slippageBps, uint8 market, uint8 maxLeverage, uint64 startTime, uint64 endTime, uint256 prizePool, address creator, bool settled)',
  'function participantCount(uint256) view returns (uint256)',
  'function getParticipants(uint256) view returns (uint256[])',
];

const LIVE_ABI = [
  'function runs(uint256) view returns (bytes32 cumulativeHash, uint64 startedAt, uint64 lastUpdatedAt, uint64 epochCount, uint8 status, uint16 liveMaxDrawdownBps, uint16 liveWinRateBps, int128 liveTotalReturnBps, uint128 liveSharpeX1000)',
];

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));

  const seasonId = Number(process.argv[2] ?? 1);
  const seasonAddr = process.env.ZA_ADDR_SEASON!;
  const liveAddr = process.env.ZA_ADDR_LIVE_CERT!;
  if (!seasonAddr || !liveAddr) {
    throw new Error('ZA_ADDR_SEASON + ZA_ADDR_LIVE_CERT must be set in examples/.env');
  }

  const provider = new ethers.JsonRpcProvider(process.env.ZA_RPC!);
  const season = new ethers.Contract(seasonAddr, SEASON_ABI, provider);
  const live = new ethers.Contract(liveAddr, LIVE_ABI, provider);

  const s = await season.seasons(seasonId);
  const startMs = Number(s.startTime) * 1000;
  const endMs = Number(s.endTime) * 1000;
  const now = Date.now();
  const status =
    s.settled ? 'SETTLED' : now < startMs ? 'SCHEDULED' : now < endMs ? 'LIVE' : 'AWAITING SETTLEMENT';

  const remainMs = Math.max(0, endMs - now);
  const remainMin = Math.floor(remainMs / 60_000);
  const remainSec = Math.floor((remainMs % 60_000) / 1000);

  console.log(`━━━ Season #${seasonId} ━━━`);
  console.log(`  status      ${status}`);
  console.log(`  startTime   ${new Date(startMs).toISOString()}`);
  console.log(`  endTime     ${new Date(endMs).toISOString()}  (${remainMin}m ${remainSec}s remaining)`);
  console.log(`  market      ${s.market === 0n ? 'spot' : 'perp'} · ${s.maxLeverage}x lev`);
  console.log(`  prizePool   ${ethers.formatEther(s.prizePool)} 0G`);
  console.log(`  creator     ${s.creator}`);

  const participants: bigint[] = await season.getParticipants(seasonId);
  console.log(`\n${participants.length} participants:`);

  // Roster is optional — falls back to "Token #N" when missing (mainnet trial
  // doesn't require a multi-mint roster).
  let nameByToken = new Map<string, string>();
  try {
    const rosterJson = JSON.parse(
      await readFile(resolve(HERE, '..', 'season-roster.json'), 'utf8'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nameByToken = new Map<string, string>(rosterJson.entries.map((e: any) => [String(e.tokenId), String(e.name)]));
  } catch {
    // season-roster.json absent — that's fine for ad-hoc Seasons.
  }

  interface Row {
    tokenId: bigint;
    name: string;
    epochs: bigint;
    status: number;
    ret: bigint;
    sharpe: bigint;
    maxDd: bigint;
    winRate: bigint;
  }
  const rows: Row[] = [];
  for (const tid of participants) {
    const r = await live.runs(tid);
    rows.push({
      tokenId: tid,
      name: nameByToken.get(tid.toString()) ?? `Token #${tid}`,
      epochs: r.epochCount,
      status: Number(r.status),
      ret: r.liveTotalReturnBps,
      sharpe: r.liveSharpeX1000,
      maxDd: r.liveMaxDrawdownBps,
      winRate: r.liveWinRateBps,
    });
  }

  rows.sort((a, b) => {
    const av = a.ret;
    const bv = b.ret;
    if (av > bv) return -1;
    if (av < bv) return 1;
    return 0;
  });

  console.log(
    `${'rank'.padEnd(5)}${'token'.padEnd(8)}${'name'.padEnd(28)}${'epochs'.padEnd(8)}${'return'.padEnd(10)}${'sharpe'.padEnd(9)}${'maxDD'.padEnd(9)}${'winRate'}`,
  );
  console.log('-'.repeat(95));
  rows.forEach((r, i) => {
    const ret = (Number(r.ret) / 100).toFixed(2) + '%';
    const sh = (Number(r.sharpe) / 1000).toFixed(2);
    const dd = (Number(r.maxDd) / 100).toFixed(2) + '%';
    const wr = (Number(r.winRate) / 100).toFixed(2) + '%';
    const rank = `#${i + 1}`;
    console.log(
      `${rank.padEnd(5)}#${r.tokenId.toString().padEnd(7)}${r.name.padEnd(28)}${r.epochs.toString().padEnd(8)}${ret.padEnd(10)}${sh.padEnd(9)}${dd.padEnd(9)}${wr}`,
    );
  });

  // Settlement hint (the sorted token list for Season.settle)
  if (status === 'AWAITING SETTLEMENT' && !s.settled) {
    console.log('\nsettle hint (pass to Season.settle):');
    console.log(`  [${rows.slice(0, 3).map((r) => r.tokenId.toString()).join(', ')}]`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
