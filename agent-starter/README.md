# Agent Starter — register your agent on Zero Arena

The minimum viable template for taking your trading agent from "idea" to
"on-chain ERC-7857 iNFT with a verifiable performance certificate." Two
files, no fluff: `agent.ts` (the only file you edit) and `run.ts` (the
script that handles backtest + certify + mint for you).

## What you'll get when you finish

- A `runHash` that cryptographically commits your agent's behaviour on
  the canonical BTC/USDT dataset.
- A `Certificate` anchored on 0G Chain (`AgentCertificate.submit`) with
  your headline metrics + a `trustTier: T2` tag.
- An ERC-7857 **Intelligent NFT** (`ZeroArenaINFT.mint`) pointing at
  encrypted agent metadata stored on 0G Storage. Your strategy code
  never leaves your machine in plaintext.
- Public links you can share: explorer tx, token page, certificate row.

## 5-step walkthrough

### 1. Prereqs

```bash
# from the examples/ folder
npm install
```

You also need a wallet with Galileo testnet gas. Funded through
<https://faucet.0g.ai>. Then copy `../../sdk/.env.example` → `../../sdk/.env`
and fill in `PRIVATE_KEY`, `ZA_ADDR_CERT`, `ZA_ADDR_INFT`, `ZA_ADDR_ORACLE`.

### 2. Bootstrap the dataset (one-time)

```bash
npm run 00:ingest
```

Pulls BTC/USDT 1h candles from Binance starting 2025-01-01, uploads to
0G Storage, writes the `rootHash` into `data/datasets.lock.json`. Re-run
daily to extend the dataset; the script only fetches the delta.

### 3. Edit `agent.ts`

The only file you need to touch. Replace the body of `decide(obs)` with
your strategy. The signals on `obs` are pre-computed deterministically so
your decision is fully reproducible.

```ts
override decide(obs: Observation): Action {
  if (obs.rsi14 < 30 && obs.ema12 > obs.ema26)     // buy the dip in an uptrend
    return { direction: 1, size: 0.5 };
  if (obs.rsi14 > 70)                              // exit on overbought
    return { direction: 0, size: 0 };
  return { direction: obs.position > 0 ? 1 : 0,
           size: obs.position > 0 ? 0.5 : 0 };
}
```

Determinism rules — the SDK enforces these, so just don't fight them:
- No `Math.random()`. Use `obs.rsi14` etc. Need randomness? Seed a PRNG with `obs.timestamp`.
- No `Date.now()`. Use `obs.timestamp`.
- Don't iterate over object keys in the hot path (insertion order can drift).

For an LLM-based agent: call your model from inside `decide()`. The full
request/response is recorded in the run log and committed via `runHash`.
This works today at trust tier T2; T3 (TEE-attested via 0G Compute Sealed
Inference) ships in v0.2 with no API change. See `02-claude-llm-agent`
for the LLM pattern.

### 4. Smoke test offline

```bash
npm run starter -- --backtest-only
```

No chain calls. Prints the metrics so you can iterate on your strategy
quickly. **Mint default thresholds: `totalReturnBps ≥ 0` and `sharpeX1000 ≥ 1000`** —
i.e. positive return AND Sharpe ≥ 1.0. Tune until you clear them.

### 5. Register on chain

```bash
npm run starter
```

The script:
1. Loads the live dataset from 0G Storage via the lock's `rootHash`.
2. Runs the deterministic backtest of your agent.
3. Encrypts the run log with a fresh AES-256 key, uploads to 0G.
4. Submits the certificate on `AgentCertificate.submit`.
5. Encrypts the agent metadata, uploads, and mints the iNFT.

Output ends with explorer links. The AES key for your iNFT lands in
`~/.zeroarena/keys/agent-<tokenId>.key` (mode 0600). **Keep it.** It's
how a future buyer / verifier flow can decrypt your encrypted blob.

## Files

```
agent-starter/
├── README.md         — this file
├── agent.ts          — your strategy lives here (edit me)
└── run.ts            — backtest + certify + mint pipeline (do not edit)
```

## Common questions

**Can I use a different dataset?** Yes — point `loadDataset({ rootHash })`
at any rootHash you've uploaded. The fixture flow assumes BTC/USDT 1h spot
because that's what `00-binance-ingest` bootstraps.

**Can I use perp instead of spot?** Yes — change `BACKTEST_OPTS.market` to
`'perp'` and add `leverage` / `liquidationMarginBps`. The dataset must
also be a perp dataset (run `00-binance-ingest` with a perp symbol).

**My run loses money. Can I still mint?** Not on the deployed contract
defaults (`minTotalReturnBps = 0`, `minSharpeX1000 = 1000`). The point of
the gate is performance attestation. The contract owner can lower
thresholds via `setThresholds` for development.

**Does anyone actually see my strategy?** No. `agent.toJSON()` is the only
thing that hits the cryptographic identity (`agentHash`). Your `decide()`
function body stays on your machine. The run log is encrypted before
upload. Authorized verifiers can re-run only if you share the AES key
(that's what tier T2 means).

**What's coming in v0.2?** TEE attestation via 0G Compute. Same SDK calls,
but the run executes inside a hardware enclave (Intel TDX + NVIDIA
H100/H200), so a third party can verify without touching your code. See
[`CLAUDE.md` §3 + §14](../../CLAUDE.md).
