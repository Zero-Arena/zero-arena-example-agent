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
