// Create Season #1 on-chain. Window opens in 5 minutes (gives enrollment
// time) and runs for 60 minutes. Prize pool 0.3 0G — admin (Wallet A)
// transfers it as msg.value.

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
  const seasonAddr = '0x8fb87CE34b4e8F4C65eeB6752b0168EC37806CF3';

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const season = new ethers.Contract(seasonAddr, SEASON_ABI, wallet);

  const block = await provider.getBlock('latest');
  if (!block) throw new Error('no latest block');
  const now = Number(block.timestamp);

  const datasetSpec = ethers.keccak256(ethers.toUtf8Bytes('BTCUSDT-15m-spot'));
  const startTime = BigInt(now + 5 * 60); // enrollment window: 5 min
  const endTime = BigInt(now + 65 * 60); // total run: ~1h after start
  const prizePool = ethers.parseEther('0.3');

  console.log(`creating season:`);
  console.log(`  datasetSpec  ${datasetSpec}`);
  console.log(`  startTime    ${new Date(Number(startTime) * 1000).toISOString()}`);
  console.log(`  endTime      ${new Date(Number(endTime) * 1000).toISOString()}`);
  console.log(`  prizePool    ${ethers.formatEther(prizePool)} 0G`);

  const spec = {
    datasetSpec,
    initialBalance: 10_000n,
    feeBps: 10,
    slippageBps: 5,
    market: 0, // spot
    maxLeverage: 1,
    startTime,
    endTime,
    prizePool,
    creator: ethers.ZeroAddress,
    settled: false,
  };

  const tx = await season.createSeason(spec, {
    value: prizePool,
    type: 0,
    gasPrice: 3_000_000_000n,
  });
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
