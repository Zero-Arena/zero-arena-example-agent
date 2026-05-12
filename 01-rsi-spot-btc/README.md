# 01 — RSI agent on BTC/USDT spot

The canonical "install, run, verify" demo for the Zero Arena SDK.

A rule-based **RSI(14) mean-reversion** agent on **BTC/USDT spot**.
This is the full end-to-end pipeline: backtest → certify on 0G Chain →
mint as ERC-7857 iNFT. Use this as your template when your strategy
is deterministic (no LLM, no external API calls).

## The strategy

`RsiAgent` is dead simple — three thresholds:

| Condition | Action |
| - | - |
| `rsi14 < oversold` (default 30) | go LONG at `sizeFraction` (default 50% of equity) |
| `rsi14 > overbought` (default 70) | go FLAT |
| between bands | hold whatever position is open |

Long-only. Spot. No leverage. Default hyperparameters give you a working
agent on the first run; tune them to get something that clears the on-
chain mint thresholds.

## Agent config

Hyperparameters live on the constructor and are surfaced in `toJSON()`,
so they become part of the agent's cryptographic identity (`agentHash`):

```ts
new RsiAgent(
  oversold     = 30,   // RSI level that triggers entry
  overbought   = 70,   // RSI level that triggers exit
  sizeFraction = 0.5,  // fraction of equity per position, in [0, 1]
);
```

Want a more aggressive RSI? Try `new RsiAgent(25, 75, 0.75)`. Every new
combination is a different `agentHash` → a different certificate
identity. The on-chain story stays clean as you iterate.

## Run it

```bash
# from examples/
npm install
npm run 01:backtest        # offline LCG fixture, no chain calls, no .env
```

Expected output (deterministic — every machine produces the same
`runHash`):

```
▸ dataset: 480 candles  datasetHash=0x…
▸ agent:   {"className":"RsiAgent","oversold":30,"overbought":70,"sizeFraction":0.5}

▸ backtest result
  runHash:        0x…
  trades:         …
  totalReturnBps: …
  sharpeX1000:    …
  finalEquity:    …
```

## Full chain flow

To certify the run on Galileo testnet and mint an iNFT pointed at it:

1. **Bootstrap the canonical dataset** (one-time):
   ```bash
   cd ../zero-arena-bacend && npm install && npm run dataset:upload && cd ../examples
   ```
   That puts BTC/USDT 15-minute spot candles on 0G Storage and pins the
   `rootHash` in `../zero-arena-bacend/data/datasets.lock.json`.

2. **Set up your wallet**:
   - Fund it at <https://faucet.0g.ai>.
   - Copy `../.env.example` → `../.env` and fill in `PRIVATE_KEY` (Galileo addresses are pre-filled).

3. **Run the full pipeline**:
   ```bash
   npm run 01:run
   ```

You'll see, in order:
- `runHash` — the cryptographic commitment to (agent, dataset, options, trades).
- `certId` from `AgentCertificate.submit`, plus the explorer link.
- `tokenId` from `ZeroArenaINFT.mint`, plus the storage root for the
  encrypted agent metadata.

The AES key for the encrypted run log is written to
`~/.zeroarena/keys/agent-<tokenId>.key`. **Keep it.** It's how a future
verifier can decrypt the run log to confirm the trades.

## Trust tier

`T2` (commitment + reproducibility):

- **T1** — the run is bound on-chain; trades cannot be edited after
  submission.
- **T2** — anyone you authorize can re-run the same agent against the
  same dataset and assert the same `runHash`. This works today because
  every input is deterministic (pre-computed indicators in `obs`, no
  `Date.now()`, no randomness).
- **T3** (TEE-attested) — same agent code, same backtest, executed
  inside a 0G Compute enclave. Trustless verification by anyone, no
  source disclosure required. Ships in a later release with no code
  change to this example.

For the bigger picture see [`CLAUDE.md` 3 + 14](../../CLAUDE.md).

## Offline fixture

`data/btc-usdt-1h.csv` is a 480-candle synthetic dataset generated from
a seeded LCG. It's committed to the repo so `--backtest-only` works
without any external dependency. The fixture is hash-identical across
machines, so its `datasetHash` (and thus `runHash` for a given agent)
is stable everywhere.

For the live BTC/USDT 15-minute dataset, see
[`zero-arena-bacend/`](../../zero-arena-bacend/).
