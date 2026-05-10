// Zero Arena — Agent Starter Template
// ------------------------------------------------------------
// Copy this folder, rename, and replace the body of `decide()` with your
// own strategy. Everything else (backtest engine, encryption, certify,
// mint) is handled by the SDK — you only own the decision function.
//
// Available signals on `obs` (all pre-computed deterministically):
//   obs.timestamp     — candle epoch ms (use this, never Date.now())
//   obs.open/high/low/close/volume — current bar
//   obs.rsi14         — 14-period RSI
//   obs.ema12 / ema26 — exponential moving averages
//   obs.macd          — MACD line (ema12 - ema26)
//   obs.macdSignal    — 9-period EMA of macd
//   obs.position      — current position size (base units, signed)
//   obs.equity        — total equity in quote currency
//   obs.cash          — available cash
//   obs.leverage      — current leverage (perp only; 1 on spot)
//
// Action shape:
//   direction: 1 = long, 0 = flat, -1 = short (perp only)
//   size:      fraction of equity to allocate, [0, 1]
//
// Determinism rules (the SDK enforces these — don't break them):
//   - No Math.random()
//   - No Date.now()
//   - No object iteration in the hot path
//   - Keep `decide()` pure: same inputs → same outputs

import { Agent, type Action, type Observation } from 'zeroarena';

export class MyAgent extends Agent {
  // TODO: declare your hyperparameters here. They become part of the
  // agent's cryptographic identity (`agentHash`) via `toJSON()` below.
  constructor(
    public readonly threshold = 50,
    public readonly sizeFraction = 0.3,
  ) {
    super();
  }

  override decide(obs: Observation): Action {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TODO: replace this with your strategy.
    //
    // The example below is a no-op (always flat). Suggestions to start:
    //
    //   if (obs.rsi14 < 30) return { direction: 1, size: this.sizeFraction };
    //   if (obs.rsi14 > 70) return { direction: 0, size: 0 };
    //
    //   if (obs.macd > obs.macdSignal && obs.ema12 > obs.ema26)
    //     return { direction: 1, size: this.sizeFraction };
    //
    //   if (obs.close > obs.ema26 * 1.02)
    //     return { direction: 1, size: this.sizeFraction };
    //
    // For LLM-based agents: call your model from inside decide(). The
    // request/response is captured in the run log and committed via
    // `runHash`. See examples/02-claude-llm-agent for the pattern.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    return { direction: 0, size: 0 };
  }

  // Override `toJSON` so your hyperparameters are part of the
  // cryptographic identity of the agent. A re-tuned variant should
  // produce a different `agentHash`.
  override toJSON(): Record<string, unknown> {
    return {
      className: 'MyAgent', // ← rename when you rename the class
      threshold: this.threshold,
      sizeFraction: this.sizeFraction,
    };
  }
}

// Default-export so the CLI's `--agent` flag and the run.ts loader can
// pick up the class without you having to wire imports manually.
export default MyAgent;
