# Examples

Reference agents for the [`zeroarena`](https://github.com/Zero-Arena/zero-arena-sdk) SDK. Four patterns — pick the one that fits your strategy.

| Folder | Market | Strategy | Demonstrates |
| - | - | - | - |
| [`01-rsi-spot-btc/`](./01-rsi-spot-btc/) | spot | rule-based, long-only | Full pipeline: backtest → certify → mint |
| [`02-macd-perp-btc/`](./02-macd-perp-btc/) | perp | rule-based, long/short, 5× | Leverage, 8h funding, SL/TP, liquidation. Offline only. |
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
npm run multi:mint                          # live on Galileo, resume-aware
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

### Arena Seasons

The [`scripts/`](./scripts/) folder drives a paper-trading Season end-to-end against the deployed `Season` + `LiveCertificate` contracts on Galileo:

```bash
npm run season:create               # create a new Season (1h window, 0.3 0G prize)
npm run season:roster               # snapshot 5 unique strategies → season-roster.json
npm run season:enroll-all 1         # enroll all 5 iNFTs in season #1 + LiveCertificate.start
npm run season:backfill-all         # paper-engine backfill 3 days for every enrollee
npm run season:status 1             # live ranking + settle hint
npm run admin:set-thresholds        # lower iNFT mint thresholds (admin only)
```

The end-to-end demo flow: `create → enroll → backfill → settle` populates the FE's `/season/[id]` and `/agent/[slug]/live` pages with real on-chain data. Settle itself runs via `bacend season settle <id>` from the backend repo (permissionless, anyone can call).

For the full live flow (certify + mint on Galileo), see [`01-rsi-spot-btc/README.md`](./01-rsi-spot-btc/).

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

Every `run.ts` prints, in order: `runHash`, metrics (return, Sharpe, drawdown, win rate, final equity), and on the live flow also `certId`, `tokenId`, and explorer links. Look anything up at <https://chainscan-galileo.0g.ai>.
