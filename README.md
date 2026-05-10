# Zero Arena — examples

End-to-end walkthroughs for the `zeroarena` SDK. Not published to npm.

| Example | Market | What it shows |
| - | - | - |
| `00-binance-ingest/` | — | Fetch BTC/USDT and 0G/USDT OHLCV (spot + perp) from Binance, normalize, hash, upload to 0G Storage. Run this once before the others. |
| `01-rsi-agent-btc-spot/` | BTC spot | Rule-based RSI mean reversion. The canonical 5-minute install-and-run demo. Full backtest → certify → mint flow. |
| `02-claude-llm-agent-0g-spot/` | 0G spot | One example LLM-based agent — Claude via `@anthropic-ai/sdk`. The model is the developer's choice; this is just a reference for the LLM pattern. Swap in GPT, Gemini, a self-hosted Llama, or anything else with no SDK changes. |
| `03-perp-momentum-agent/` | BTC perp | Leveraged momentum agent. Exercises the perp code path: leverage, 8h funding accrual, isolated-margin liquidation. |
| `04-transfer-flow/` | — | ERC-7857 oracle re-encryption transfer between two wallets. |

Each example folder has its own README and a single `run.ts` you can execute against Galileo testnet.

---

## Trust tier per example

Every example explicitly states the trust tier of the certificate it produces. v0.1 ships T1 + T2 only; T3 (full TEE attestation via 0G Compute Sealed Inference) ships in v0.2. See the [trust model in the org README](https://github.com/Zero-Arena) for what each tier proves.

| Example | Trust tier (v0.1) | Trust tier (v0.2) | Notes |
| - | - | - | - |
| `01-rsi-agent-btc-spot` | T2 | T3 | Pure-deterministic agent — fully reproducible today, and the easiest path to T3 once `BacktestEngine` runs in 0G Compute. |
| `02-claude-llm-agent-0g-spot` | T2* | T3 | LLM responses are recorded in the run log; reproducibility (T2) requires the same API responses, which is not guaranteed across calls. v0.2 lifts to T3 by running the agent inside a 0G Compute TEE and using TeeTLS to capture a signed receipt of each outbound API call. **The model itself stays the developer's choice** — TeeTLS attests the call, it does not replace it. |
| `03-perp-momentum-agent` | T2 | T3 | Same path as the RSI agent. Funding rates are snapshotted into the dataset itself, so determinism is preserved. |

\* Read the example's README — the LLM-agent T2 caveat is important.

---

## Setup

```bash
npm install
cp .env.example .env  # fill PRIVATE_KEY (Galileo testnet) + BINANCE_API_KEY (read-only, optional)

# 1. One-time: fetch + upload the BTC/0G corpus to 0G Storage.
npx tsx 00-binance-ingest/ingest.ts

# 2. Run any example. Datasets resolve from data/datasets.lock.json automatically.
npx tsx 01-rsi-agent-btc-spot/run.ts
```

The `data/datasets.lock.json` file is checked into git. It maps `(asset, market)` pairs to their 0G Storage root hashes and dataset hashes, so every run on every machine anchors to the same bytes. Re-running `00-binance-ingest` will append new windows; it does not overwrite existing entries.

---

## Notes on data sources

- **BTC/USDT spot** — Binance public REST `/api/v3/klines`. 1h candles, 365-day rolling window.
- **BTC/USDT perp** — Binance Futures `/fapi/v1/klines` for prices, `/fapi/v1/fundingRate` for the 8h funding series. Funding accruals are baked into the dataset CSV so the backtest stays deterministic.
- **0G/USDT spot** — Binance if listed at the time of ingestion. Otherwise falls back to a DEX OHLCV aggregator. The dataset metadata records `source: "binance"` or `source: "dex:<aggregator>"` so verifiers can re-derive.
- **0G/USDT perp** — Binance Futures if listed; otherwise this market is omitted in the v0.1 examples.

---

## What you get when an example finishes

Every `run.ts` prints, in order:

1. `runHash` — the canonical commitment to the (agent, dataset, options, trades) tuple.
2. `certId` — the on-chain certificate ID, with a Galileo explorer link.
3. `tokenId` — the ERC-7857 iNFT token ID, with the storage root for the encrypted agent + run log.
4. `trustTier` — `T2` in v0.1. (`T3` once v0.2 ships.)

Copy any of these into the explorer to verify them yourself.
