// Lower iNFT mint thresholds so losing-strategy agents can still be minted
// (their certificate still records the truth — the iNFT just unlocks
// enrollment in arena seasons regardless of static-backtest profitability).

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { loadEnv } from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));

const ABI = [
  'function setThresholds(int128 minReturn, uint128 minSharpe) external',
  'function minTotalReturnBps() view returns (int128)',
  'function minSharpeX1000() view returns (uint128)',
];

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));
  const rpc = process.env.ZA_RPC!;
  const pk = process.env.PRIVATE_KEY!;
  const inftAddr = process.env.ZA_ADDR_INFT!;

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const inft = new ethers.Contract(inftAddr, ABI, wallet);

  const beforeR = await inft.minTotalReturnBps();
  const beforeS = await inft.minSharpeX1000();
  console.log(`current  minReturn=${beforeR}  minSharpe=${beforeS}`);

  const tx = await inft.setThresholds(-1_000_000n, 0n, {
    type: 0,
    gasPrice: 3_000_000_000n,
  });
  console.log(`tx       ${tx.hash}`);
  const rec = await tx.wait();
  console.log(`✓ confirmed in block ${rec?.blockNumber}`);

  const afterR = await inft.minTotalReturnBps();
  const afterS = await inft.minSharpeX1000();
  console.log(`new      minReturn=${afterR}  minSharpe=${afterS}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
