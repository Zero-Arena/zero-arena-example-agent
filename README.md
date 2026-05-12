# Zero Arena — examples

Reference agents for the [`zeroarena`](../sdk/) SDK. Two patterns, one
for each market type. Clone whichever fits your strategy as a starting
point.

| Folder | Market | Strategy type | Demonstrates |
| - | - | - | - |
| [`01-rsi-spot-btc/`](./01-rsi-spot-btc/) | spot | rule-based, long-only | Full e2e pipeline — backtest → certify on 0G Chain → mint as ERC-7857 iNFT. Use this template when your strategy is deterministic. |
| [`02-macd-perp-btc/`](./02-macd-perp-btc/) | perpetual futures | rule-based, long/short, 5× leverage | Every perp mechanic the SDK supports — leverage, 8h funding, SL/TP, isolated-margin liquidation. Offline backtest (bundled fixture). |

Both are rule-based and deterministic on purpose. They produce the same
`runHash` on every machine, which is what the SDK's T2 reproducibility
guarantee depends on.

## Quick start

```bash
npm install

npm run 01:backtest   # spot, offline LCG fixture, no chain calls
npm run 02:backtest   # perp 5× leverage, offline LCG fixture, no chain calls
```

That gets you running in under a minute, no `.env` needed.

To go end-to-end against a live dataset on 0G Storage + certify + mint
on chain, see `01-rsi-spot-btc/README.md` "Full chain flow" — it walks
you through bootstrapping the canonical 15-minute BTC/USDT spot dataset
via [`zero-arena-bacend`](../zero-arena-bacend/) and running the full
pipeline.

## What you'll get when an example finishes

Every `run.ts` prints, in order:

1. `runHash` — the canonical commitment to `(agent, dataset, options, trades)`.
2. `metrics` — return, Sharpe, Sortino, profit factor, max drawdown, win rate, final equity.
3. (Full flow only) `certId` on `AgentCertificate`, with an explorer link.
4. (Full flow only) `tokenId` on `ZeroArenaINFT`, plus the storage root for the encrypted agent.
5. `trustTier` — `T2` in this release.

Copy any of those into <https://chainscan-galileo.0g.ai> to verify.

## Writing your own agent

Both examples follow the same recipe — read either `agent.ts` and you'll
see the pattern in under 50 lines:

```ts
import { Agent, type Action, type Observation } from 'zeroarena';

export class MyAgent extends Agent {
  constructor(public readonly hyperparam1 = ..., ...) { super(); }

  override decide(obs: Observation): Action {
    // Pure function of `obs`. Return { direction, size, stopLoss?, takeProfit? }.
  }

  override toJSON(): Record<string, unknown> {
    return { className: 'MyAgent', hyperparam1: this.hyperparam1, ... };
  }
}
```

All imports come from the top-level `zeroarena` package — no deep `dist/` paths.

The engine pre-computes indicators on every bar (`obs.rsi14`, `obs.macd`,
`obs.macdSignal`, `obs.ema12`, `obs.ema26`), so your `decide()` is just
"signal in, action out." Anything you put in `toJSON()` becomes part of
the agent's `agentHash`, so changing it (e.g., tuning a threshold)
produces a fresh certificate identity.

For an LLM-based agent: call your model from inside `decide()`. The full
request/response is recorded in the run log and committed via `runHash`.
This works today at trust tier T2 — but the response stream is what
gets hashed, not the inference itself, so reproducibility requires the
same LLM responses. The TEE-attested path lifting this to T3 ships in a
later release; the agent surface does not change.

## Determinism rules

The SDK enforces these — your agent must respect them:

1. **No `Math.random()`.** Need randomness? Seed a PRNG with `obs.timestamp`.
2. **No `Date.now()`.** Use `obs.timestamp` for any time-dependent logic.
3. **No `for…in` over objects** in the hot path — insertion order can drift.
4. **No mutating shared state** between `decide()` calls in ways that
   depend on previous runs. Internal state initialized in the
   constructor (like 02's entry-price tracker) is fine because it
   resets every fresh instance.

Break any of these and your `runHash` stops being reproducible, which
silently demotes your certificate from T2 to T1.

## Trust tier table

| Example | Trust tier (today) | Notes |
| - | - | - |
| `01-rsi-spot-btc` | T2 | Pure-deterministic. Easiest path to T3 once the engine runs inside 0G Compute. |
| `02-macd-perp-btc` | T2 | Same — deterministic agent, deterministic engine, deterministic fixture. |

T3 (TEE-attested via 0G Compute) ships in a later release. The
certificate format already reserves the `attestationHash` slot, so the
upgrade is wiring, not redesign. See [`CLAUDE.md` 3 + 14](../CLAUDE.md).
