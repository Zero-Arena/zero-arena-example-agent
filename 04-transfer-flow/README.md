# 04 — ERC-7857 transfer flow

Walks a minted iNFT through the oracle re-encryption transfer. The script picks up an iNFT owned by the SDK signer, generates (or reads) a recipient wallet, and asks the oracle service running in `zero-arena-bacend` to re-encrypt the sealed metadata key for the recipient. After the transfer the recipient owns the token AND holds the only key that decrypts the underlying agent.

## Prerequisites

1. **An iNFT to transfer.** Run example 01 first (`npm run 01:run`) to mint one.
2. **Oracle service running.** From `zero-arena-bacend`:

   ```bash
   cp .env.oracle.example .env
   # fill ORACLE_PRIVATE_KEY = the key whose address equals
   # ReencryptionOracle.signer() on chain
   npm run oracle:serve
   ```

3. **`examples/.env`** filled (PRIVATE_KEY + mainnet addresses — already pinned by `.env.example`).
4. Optional: `RECIPIENT_PRIVATE_KEY` pre-set. Otherwise the script generates one and prints it once — save it, the recipient needs it to decrypt the new sealed key.

## Run

```bash
RECIPIENT_TOKEN_ID=1 \
  ORACLE_URL=http://127.0.0.1:8787 \
  npx tsx 04-transfer-flow/run.ts
```

Optional: pin a specific recipient by passing `RECIPIENT_PRIVATE_KEY=0x…`.

## What happens

1. SDK loads the current AES key from `~/.zeroarena/keys/agent-<tokenId>.key`.
2. Generates a new AES key for the recipient; ECIES-encrypts it against `recipientPubKey`. The SealedKey payload is what gets emitted in the `SealedKeyDelivered` event.
3. Re-encrypts the agent metadata blob with the new AES key, uploads to 0G Storage, records the new `metadataHash`.
4. Asks the oracle service to sign `(chainId, inft, tokenId, from, to, sealedKeyHash, newMetadataHash, deadline)`.
5. Calls `ZeroArenaINFT.transfer(from, to, tokenId, sealedKey, proof)` on chain.

Vanilla `transferFrom`/`safeTransferFrom` are disabled at the contract level — the only path to move an iNFT is through this oracle flow.

## Trust note

In v0.1/v0.2 the oracle is a trusted ECDSA signer running off chain. v0.3+ replaces it with a TEE-attested signer inside 0G Compute Sealed Inference — the contract interface does not change, only the trust root.
