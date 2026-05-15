// Enroll every token in season-roster.json into a given seasonId, then
// kick off LiveCertificate.start so the paper engine can begin pushing
// epoch updates.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import { loadEnv } from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));

const SEASON_ABI = [
  'function enroll(uint256 seasonId, uint256 tokenId) external',
  'function enrolled(uint256, uint256) view returns (bool)',
  'function participantCount(uint256) view returns (uint256)',
];

const LIVE_ABI = [
  'function start(uint256 tokenId, bytes32 initialCumulativeHash) external',
  'function isActive(uint256 tokenId) view returns (bool)',
];

interface Entry {
  slug: string;
  name: string;
  tokenId: string;
  certId: string;
  runHash: string;
}

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));

  const seasonId = Number(process.argv[2] ?? 1);
  const seasonAddr = '0x8fb87CE34b4e8F4C65eeB6752b0168EC37806CF3';
  const liveAddr = '0x2c71fe022E4698f8fD63384A19Cd69D72a714b4d';

  const provider = new ethers.JsonRpcProvider(process.env.ZA_RPC!);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const season = new ethers.Contract(seasonAddr, SEASON_ABI, wallet);
  const live = new ethers.Contract(liveAddr, LIVE_ABI, wallet);

  const roster = JSON.parse(
    await readFile(resolve(HERE, '..', 'season-roster.json'), 'utf8'),
  ) as { entries: Entry[] };

  console.log(`enrolling ${roster.entries.length} agents in season #${seasonId}\n`);

  for (const e of roster.entries) {
    console.log(`▸ ${e.name}  (token #${e.tokenId})`);
    const isEnrolled: boolean = await season.enrolled(seasonId, e.tokenId);
    if (isEnrolled) {
      console.log(`  already enrolled — skipping enroll`);
    } else {
      const tx = await season.enroll(seasonId, e.tokenId, {
        type: 0,
        gasPrice: 3_000_000_000n,
      });
      console.log(`  enroll tx  ${tx.hash}`);
      const rec = await tx.wait();
      console.log(`  ✓ block ${rec?.blockNumber}`);
    }

    const isActive: boolean = await live.isActive(e.tokenId);
    if (isActive) {
      console.log(`  paper run already active — skipping start`);
    } else {
      const tx = await live.start(e.tokenId, e.runHash, {
        type: 0,
        gasPrice: 3_000_000_000n,
      });
      console.log(`  start tx   ${tx.hash}`);
      const rec = await tx.wait();
      console.log(`  ✓ block ${rec?.blockNumber}`);
    }
    console.log('');
  }

  const count: bigint = await season.participantCount(seasonId);
  console.log(`✓ Season #${seasonId} now has ${count} participants`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
