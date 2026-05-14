// 04-transfer-flow — ERC-7857 oracle transfer end-to-end.
//
// 1. Generate (or read) a fresh recipient wallet.
// 2. Confirm the iNFT this script targets is owned by the SDK signer.
// 3. Call ZeroArena.transferAgent({ tokenId, to, recipientPubKey }), which
//    asks the oracle service to re-encrypt the sealed key for the recipient
//    and submits the transfer tx.
// 4. Verify on chain that ownership moved.
//
// Required env (examples/.env):
//   PRIVATE_KEY              — current owner. Must own RECIPIENT_TOKEN_ID.
//   ZA_RPC, ZA_INDEXER       — Galileo endpoints.
//   ZA_ADDR_CERT/INFT/ORACLE — v0.2 addresses.
//   ORACLE_URL               — running oracle service from zero-arena-bacend.
//   RECIPIENT_PRIVATE_KEY    — pre-generated recipient key (optional; script
//                              will create one and print it if missing).
//   RECIPIENT_TOKEN_ID       — tokenId to transfer (default 1).

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAddress, JsonRpcProvider, Wallet } from 'ethers';
import {
  ZeroArena,
  HttpOracleClient,
  configFromEnv,
  loadEnv,
} from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));

  const oracleUrl = process.env.ORACLE_URL ?? 'http://127.0.0.1:8787';
  const tokenIdStr = process.env.RECIPIENT_TOKEN_ID ?? '1';
  const tokenId = BigInt(tokenIdStr);

  let recipientKey = process.env.RECIPIENT_PRIVATE_KEY;
  if (!recipientKey || recipientKey === '0x') {
    const fresh = Wallet.createRandom();
    recipientKey = fresh.privateKey;
    console.log('▸ generated fresh recipient wallet:');
    console.log(`    address:     ${fresh.address}`);
    console.log(`    privateKey:  ${recipientKey}`);
    console.log('  Save the private key — recipient needs it to decrypt the sealed-key on transfer.\n');
  }

  const recipient = new Wallet(recipientKey);
  const recipientAddr = computeAddress(recipientKey);
  const recipientPubKey = recipient.signingKey.publicKey;

  const cfg = configFromEnv();
  const za = new ZeroArena({
    ...cfg,
    oracle: new HttpOracleClient({ url: oracleUrl }),
  });

  console.log('▸ pre-transfer state');
  const provider = new JsonRpcProvider(cfg.rpc);
  const inftAddr = cfg.addresses?.ZeroArenaINFT ?? process.env.ZA_ADDR_INFT!;
  const ownerBefore = await ownerOf(provider, inftAddr, tokenId);
  console.log(`  tokenId:   ${tokenId}`);
  console.log(`  inft:      ${inftAddr}`);
  console.log(`  owner:     ${ownerBefore}`);
  console.log(`  recipient: ${recipientAddr}`);

  console.log('\n▸ transferring via oracle…');
  console.log(`  oracle URL: ${oracleUrl}`);
  const result = await za.transferAgent({
    tokenId,
    to: recipientAddr,
    recipientPubKey,
  });
  console.log(`  txHash:          ${result.txHash}`);
  console.log(`  newMetadataHash: ${result.newMetadataHash}`);
  console.log(`  explorer:        https://chainscan-galileo.0g.ai/tx/${result.txHash}`);

  console.log('\n▸ post-transfer state');
  const ownerAfter = await ownerOf(provider, inftAddr, tokenId);
  console.log(`  owner: ${ownerAfter}`);
  if (ownerAfter.toLowerCase() === recipientAddr.toLowerCase()) {
    console.log('\n✓ done. The recipient now owns the iNFT and can decrypt the sealed key.');
  } else {
    throw new Error(`ownership did not move (got ${ownerAfter})`);
  }
}

async function ownerOf(provider: JsonRpcProvider, contract: string, tokenId: bigint): Promise<string> {
  const data = '0x6352211e' + tokenId.toString(16).padStart(64, '0');
  const ret = await provider.call({ to: contract, data });
  return '0x' + ret.slice(26);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
