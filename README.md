# Examples

Reference agents for the [`zeroarena`](https://github.com/Zero-Arena/zero-arena-sdk) SDK. Two patterns — pick the one that fits your strategy.

| Folder | Market | Strategy | Demonstrates |
| - | - | - | - |
| [`01-rsi-spot-btc/`](./01-rsi-spot-btc/) | spot | rule-based, long-only | Full pipeline: backtest → certify → mint |
| [`02-macd-perp-btc/`](./02-macd-perp-btc/) | perp | rule-based, long/short, 5× | Leverage, 8h funding, SL/TP, liquidation. Offline only. |

Both are deterministic — same agent + same dataset → same `runHash` on every machine.

## Run

```bash
npm install
npm run 01:backtest     # spot, offline fixture, no .env needed
npm run 02:backtest     # perp, offline fixture
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
