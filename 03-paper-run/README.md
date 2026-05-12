# 03-paper-run — paper trading + cumulative hash chain demo

Offline walkthrough of [RFC-001 — Paper Trading Competition](https://github.com/Zero-Arena/zero-arena-sdk/blob/main/docs/RFC-001-paper-trading-competition.md). No chain calls, no network — pure determinism proof that the SDK's `PaperEngine` produces a hash chain compatible with the v0.3 on-chain `LiveCertificate` contract.

## What it proves

1. **Equivalence.** Given the same `(agent, opts, candle[])`, `PaperEngine` (bar-by-bar streaming) produces byte-identical trades + equity curves as `runBacktest` (one-shot batch). The static-cert `runHash` and the live-engine output share the same cryptographic identity.

2. **Chain extension.** Every `barsPerEpoch` bars, the demo builds an `EpochCommit` envelope, takes its `keccak256(stableStringify(envelope))` as the `epochHash`, and folds it into a cumulative chain:

   ```
   cumulativeHash := keccak256(prev || epochHash)
   ```

   Starting from the static cert's `runHash` as genesis. After N epochs, replaying the same fold off-chain reproduces what `LiveCertificate.runs(tokenId).cumulativeHash` would equal once anchored on-chain.

## Run it

```bash
npm install        # if you skipped during init
npm run 03:paper
```

Output (truncated):

```
═══ 03-paper-run — paper trading + hash chain demo ═══

▸ synthetic dataset
  candles:          200
  datasetHash:      0x...

▸ static backtest (would mint as AgentCertificate.runHash)
  agentHash:        0x...
  optionsHash:      0x...
  runHash:          0x...
  finalEquity:      10123.45
  trades:           28

  ✓ paper agent + opts hash identical to static cert

▸ paper-engine epoch chain (5 epochs of 40 bars each)
  genesis (= static runHash):
  └─ 0xabc...
  epoch 00: trades= 6  return=+25 bps  sharpe=1340
      epochHash      0x...
      cumulativeHash 0x...
  ...

▸ equivalence with static BacktestEngine
  hashTrades(paper) == hashTrades(static):   ✓
  hash(equityCurves) match:                  ✓

✓ done.
```

## What's NOT in this example

- **On-chain submission** — Phase 1 (`zero-arena-bacend/src/paper`) wires the operator daemon to `LiveCertificate.update()` via ethers + an operator wallet. This example just shows the math.
- **WebSocket data** — the candles are synthesized deterministically so the demo runs anywhere. Real paper trading subscribes to `wss://stream.binance.com:9443/ws/btcusdt@kline_15m`.
- **TEE attestation** — v0.4 swaps the operator-signed update for a 0G Compute Sealed Inference quote. The ABI does not change.

## File map

```
03-paper-run/
├── agent.ts    same RSI(14) strategy as 01-rsi-spot-btc, framed as "the agent
│               that committed to a static runHash earlier"
├── run.ts      synthesize 200 candles → static backtest → drive PaperEngine
│               bar-by-bar → fold an epoch hash chain → assert equivalence
└── README.md
```

## Why this matters

The v0.1 trust story (T1 + T2) commits an agent's **historical** performance to chain. A skeptic can argue:

> "Your agent might be overfit to the exact 2,891 candles you backtested on. Show me it works on candles you've never seen."

This example shows how `PaperEngine` answers that question. Bar by bar, the engine commits to candles that didn't exist at the moment of static-cert submission. The cumulative hash chain rooted at the static `runHash` makes the live record provably continuous with the original commitment — no gap where the operator could splice in a forged epoch.

That's T2.5 — the new trust tier that lives between v0.1's owner-authorized reproducibility and v0.2's TEE-attested guarantee.
