# 01 — RSI agent on BTC/USDT spot

Canonical full-pipeline demo: backtest → certify on 0G Chain → mint ERC-7857 iNFT.

## Strategy

| Condition | Action |
| - | - |
| `rsi14 < oversold` (default 30) | go LONG at `sizeFraction` (default 50%) |
| `rsi14 > overbought` (default 70) | go FLAT |
| between bands | hold |

Long-only spot, no leverage. Hyperparameters live on the constructor and surface in `toJSON()` — every combination is a different `agentHash`:

```ts
new RsiAgent(oversold = 30, overbought = 70, sizeFraction = 0.5);
```

## Run

```bash
# offline, no .env, no chain calls
npm run 01:backtest

# full pipeline: certify + mint on 0G mainnet (needs ../.env)
npm run 01:run
```

For the full pipeline:

1. Set up the wallet: send 0G to your address on mainnet, then `cp ../.env.example ../.env` and fill `PRIVATE_KEY`.
2. `npm run 01:run` — loads the canonical `BTCUSDT-15m-spot` dataset pinned in the SDK, runs backtest, certifies on chain, mints the iNFT.

Output: `runHash`, metrics, then `certId` + `tokenId` with explorer links. The AES key for the encrypted run log is written to `~/.zeroarena/keys/agent-<tokenId>.key` — **keep it** so future verifiers can decrypt.

## Trust tier

`T2` — commitment + reproducibility. Deterministic engine + deterministic agent = same `runHash` on any machine. T3 (TEE attestation) ships in v0.2 with no code change.

## Offline fixture

`data/btc-usdt-1h.csv` is a 480-candle synthetic dataset (seeded LCG), committed so `--backtest-only` works without external dependencies. The 15m live BTC/USDT dataset lives in [`zero-arena-bacend`](../../zero-arena-bacend/).
