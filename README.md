# Examples

Reference agents for the [`zeroarena`](https://github.com/Zero-Arena/zero-arena-sdk) SDK. Eight strategies + a multi-mint orchestrator + the full Arena Season pipeline.

> **0G mainnet only** (chainId 16661) from `zeroarena@0.5.0`. Spot + perp are both canonical: example 01 demonstrates the spot pipeline end-to-end on chain, example 02 (`02-macd-perp-btc`) the perp engine (leverage, funding, SL/TP, liquidation).

[![Dashboard](https://img.shields.io/badge/dashboard-live-22c55e)](https://zero-arena-fe.vercel.app) [![Oracle](https://img.shields.io/badge/oracle-live-22c55e)](https://transfer-oracle-production-f390.up.railway.app/health) [![npm](https://img.shields.io/npm/v/zeroarena?color=22c55e&label=zeroarena)](https://www.npmjs.com/package/zeroarena) [![X](https://img.shields.io/badge/X-%400arena__labs-black?logo=x&logoColor=white)](https://x.com/0arena_labs)

## End-to-end arena flow

Backtest → certify → mint **qualifies** your agent. Enroll in a Season → run paper daemon → settle is the **real proof**. Examples here cover every step:

```bash
# Qualify (the entrance ticket)
npm run multi:mint                  # backtest → certify → mint a roster of 5 strategies

# Arena (the verdict)
npm run season:create               # open a fresh season (window, prize pool, dataset spec)
npm run season:enroll-all 1         # enroll every iNFT in season #1 + LiveCertificate.start
npm run season:backfill-all         # paper-engine replays Binance candles, commits epochs
npm run season:status 1             # live ranking + when settle becomes callable
# settle runs automatically via the season-keeper on the backend (permissionless)
```

The live ranking, equity charts, and epoch history all show up at [zero-arena-fe.vercel.app](https://zero-arena-fe.vercel.app) within a minute of the first `EpochCommitted` event.

## Production endpoints (0G mainnet, chainId 16661)

| | Address / URL |
| - | - |
| 0G Chain RPC | `https://evmrpc.0g.ai` |
| 0G Storage indexer | `https://indexer-storage-turbo.0g.ai` |
| `AgentCertificate` | `0x21a5DEA59cfA07B261d389A9554477e137805c2f` |
| `ZeroArenaINFT` | `0x4Bd4d45f206861aa7cD4421785a316A1dD06036f` |
| `ReencryptionOracle` | `0x63909dA30b0d65ad72b32b3C8C82515f7BFA6Fd6` |
| `LiveCertificate` | `0x168c244c872f5FC2D737D3126D08e9EEE45fFbc7` |
| `Season` | `0x4e900860565F9D399B7295c0D28CC7954202524e` |

`.env.example` ships pre-filled with these addresses.

| Folder | Market | Strategy | Demonstrates |
| - | - | - | - |
| [`01-rsi-spot-btc/`](./01-rsi-spot-btc/) | spot | rule-based, long-only | Full pipeline: backtest → certify → mint |
| [`02-macd-perp-btc/`](./02-macd-perp-btc/) | perp | rule-based, long/short, 5× | Leverage, 8h funding, SL/TP, liquidation. Offline backtest fixture; arena flow targets BTCUSDT-15m-perp live. |
| [`03-llm-spot-0g/`](./03-llm-spot-0g/) | spot | LLM (Anthropic Claude by default) | Model-agnostic `decide()` — swap providers without changing the pipeline. T2 caveat. |
| [`04-transfer-flow/`](./04-transfer-flow/) | — | ERC-7857 oracle transfer | Mint → transfer → recipient owns the iNFT + holds the decryption key. |
| [`05-rsi-aggressive/`](./05-rsi-aggressive/) | spot | wider RSI bands (25/75) | Same shape as 01 with a contrast hyperparameter set. |
| [`06-ema-crossover/`](./06-ema-crossover/) | spot | EMA(12) > EMA(26) | Trend-follower using pre-computed indicators only. |
| [`07-macd-spot/`](./07-macd-spot/) | spot | MACD bullish-only | Spot variant of the perp MACD agent (no short leg). |
| [`08-bollinger-meanrev/`](./08-bollinger-meanrev/) | spot | Bollinger Bands mean reversion | Rolling-window indicator computed inside the agent. |

Examples 01, 02, 03 are deterministic when run against a fixed dataset (with the caveat in 03 that LLM responses can drift across calls).

## Run

```bash
npm install
npm run typecheck       # tsc --noEmit across every example
npm run 01:backtest     # spot, offline fixture, no .env needed
npm run 02:backtest     # perp, offline fixture
npm run 03:run          # LLM agent on 0G/USDT (needs .env; falls back offline w/o API key)
npm run 04:transfer     # oracle-attested iNFT transfer (needs oracle service + a minted iNFT)
```

### Multi-strategy mint

The [`multi-mint/`](./multi-mint/) orchestrator backtests + certifies + mints a roster of 5 strategies (RSI Classic, RSI Aggressive, EMA Crossover, MACD Spot, Bollinger MeanRev) against the canonical BTCUSDT-15m-spot dataset in a single run.

```bash
npm run multi:backtest                      # offline, no chain
npm run multi:mint                          # live on 0G mainnet, resume-aware
npm run multi:mint -- --only=ema-crossover  # subset; comma-separated slugs
npm run multi:mint -- --force               # ignore resume scan, re-mint everything
```

**Resume-from-chain**: before each mint, the orchestrator scans `AgentMinted` events on the iNFT contract and joins to certificate runHashes. If your agent's runHash is already minted, the slug is skipped (no gas burned). Use `--force` to override.

Drops a `multi-mint-summary.json` at the repo root with one record per agent: cert id, token id, txs, runHash, and the headline metrics.

### Threshold gotcha

`ZeroArenaINFT` enforces an admin-configurable performance gate. The default is `minTotalReturnBps = 0` + `minSharpeX1000 = 1000` (Sharpe ≥ 1.0) — losing-strategy and low-Sharpe backtests revert with `ThresholdNotMet()`. The contract admin can lower the threshold via `setThresholds(int128 minReturn, uint128 minSharpe)`; certificates are still anchored regardless of threshold, only the iNFT mint is gated.

### Duplicate certificates

Re-running an example with the same agent + dataset produces the same `runHash`. `AgentCertificate.submit` happily anchors duplicates. To dedupe via the SDK:

```ts
const cert = await za.certify(result, { onDuplicate: 'skip' });
// 'submit-anyway' (default) | 'warn' | 'skip' | 'throw'
```

`multi-mint/run.ts` independently dedupes by scanning chain mints — re-runs without `--force` cost zero gas when nothing changed.

### Arena Seasons — script reference

The [`scripts/`](./scripts/) folder is the canonical operator toolkit for running a Season end-to-end against the deployed `Season` + `LiveCertificate` contracts on 0G mainnet:

| Command | Job |
| - | - |
| `npm run season:create` | Open a new Season (window, prize pool, dataset spec) |
| `npm run season:roster` | Snapshot 5 unique strategies → `season-roster.json` |
| `npm run season:enroll-all <id>` | Enroll every iNFT in season #id + `LiveCertificate.start` |
| `npm run season:backfill-all` | Replay 3 days of candles, commits epochs to chain |
| `npm run season:status [<id>]` | Live ranking + settle-readiness |
| `npm run admin:set-thresholds` | Lower iNFT mint thresholds (admin only) |

`create → enroll → backfill → settle` is the real demo path. Settle is permissionless — the season-keeper daemon ([`zero-arena-be`](https://github.com/Zero-Arena/zero-arena-be)) calls it automatically once `endTime` passes, but anyone can.

For the qualifier-only flow (backtest + certify + mint, no Season yet), see [`01-rsi-spot-btc/README.md`](https://github.com/Zero-Arena/zero-arena-example-agent/tree/main/01-rsi-spot-btc).

## Writing your own agent

```ts
import { Agent, type Action, type Observation } from 'zeroarena';

export class MyAgent extends Agent {
  constructor(public readonly threshold = 30) { super(); }

  override decide(obs: Observation): Action {
    // Pure function of `obs`. Return { direction, size, stopLoss?, takeProfit? }.
  }

  override toJSON() {
    return { className: 'MyAgent', threshold: this.threshold };
  }
}
```

Everything in `toJSON()` becomes part of the agent's `agentHash` — tune a value, get a fresh certificate identity. Pre-computed indicators (`rsi14`, `macd`, `macdSignal`, `ema12`, `ema26`) are on `obs`.

LLM agents: call your model from `decide()`. Responses are recorded in the run log and committed via `runHash`. Stays at T2 until v0.2 lifts it to T3.

## Determinism rules

1. No `Math.random()` — seed a PRNG with `obs.timestamp` if you need randomness.
2. No `Date.now()` — use `obs.timestamp`.
3. No `for…in` over objects in the hot path.
4. Internal state initialized in the constructor is fine; cross-run mutation is not.

Break any of these and your `runHash` stops being reproducible.

## Output

Every `run.ts` prints, in order: `runHash`, metrics (return, Sharpe, drawdown, win rate, final equity), and on the live flow also `certId`, `tokenId`, and explorer links. Look anything up at <https://chainscan.0g.ai>.
