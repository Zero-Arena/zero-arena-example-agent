// Delegate the perp trial's paper daemon to the 0arena onboard service
// (Singapore-region Railway — reaches Binance fapi from there). Auto-encrypts
// the agent source via ECIES against the operator's pubkey from /health.
//
// Usage:
//   ONBOARD_AUTH_TOKEN=<token> npx tsx scripts/perp-delegate.ts <tokenId> <genesisHash>

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Wallet } from 'ethers';
import { HttpOnboardClient, loadEnv } from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));
const ONBOARD_URL = process.env.ONBOARD_URL ?? 'https://onboard-production-ed6c.up.railway.app';
const AGENT_PATH = resolve(HERE, '..', '02-macd-perp-btc', 'agent.ts');

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));

  const tokenIdArg = process.argv[2];
  const genesisHashArg = process.argv[3];
  if (!tokenIdArg || !genesisHashArg) {
    throw new Error('usage: perp-delegate.ts <tokenId> <genesisHash>');
  }
  const tokenId = BigInt(tokenIdArg);
  const genesisHash = genesisHashArg;
  const authToken = process.env.ONBOARD_AUTH_TOKEN;
  if (!authToken) throw new Error('ONBOARD_AUTH_TOKEN env var required');

  const owner = new Wallet(process.env.PRIVATE_KEY!);
  console.log(`owner:        ${owner.address}`);
  console.log(`tokenId:      ${tokenId}`);
  console.log(`genesisHash:  ${genesisHash}`);

  const agentSource = readFileSync(AGENT_PATH, 'utf8');
  console.log(`agent source: ${AGENT_PATH} (${agentSource.length} bytes)`);

  const client = new HttpOnboardClient({ url: ONBOARD_URL, authToken });

  console.log('\n▸ POST /onboard ...');
  const result = await client.onboard(
    {
      tokenId,
      agentSource,
      genesisHash,
      symbol: 'btcusdt',
      interval: '15m',
      market: 'perp',
      barsPerEpoch: 1,
      initialBalance: 10_000,
      leverage: 5,
      feeBps: 5,
      slippageBps: 5,
    },
    owner,
  );
  console.log(`✓ onboarded:`);
  console.log(`  tokenId:    ${result.tokenId}`);
  console.log(`  operator:   ${result.operator}`);
  console.log(`  pid:        ${result.pid}`);
  console.log(`  startedAt:  ${result.startedAt}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(msg);
  process.exit(1);
});
