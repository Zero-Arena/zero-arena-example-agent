// 02-macd-perp-btc — leveraged momentum agent on BTC/USDT perpetuals.
//
// Strategy: MACD-vs-signal crossover with directional confirmation.
//   - Go LONG  when MACD > MACD-signal AND MACD > 0   (bullish + uptrend confirmed)
//   - Go SHORT when MACD < MACD-signal AND MACD < 0   (bearish + downtrend confirmed)
//   - FLAT otherwise.
//
// Each entry anchors a stop-loss + take-profit at fixed percentages off the
// entry price (NOT trailing — these stay locked at entry). At 5x leverage,
// a 2% adverse move costs ~10% of equity per losing trade, well clear of
// the 20% adverse move that would trigger isolated-margin liquidation.
//
// Determinism contract — every input below is either:
//   - a config hyperparameter exposed via toJSON()  → in agentHash
//   - read from `obs` (pre-computed by the engine)  → deterministic
//   - internal entry-price state                    → deterministic given the obs stream
// No Math.random, no Date.now, no LLM calls.

import { Agent, type Action, type Direction, type Observation } from 'zeroarena';

export interface MacdPerpAgentConfig {
  /** Stop-loss as a fraction of entry price. Default 0.02 (2%). */
  stopLossPct?: number;
  /** Take-profit as a fraction of entry price. Default 0.04 (4%). */
  takeProfitPct?: number;
  /**
   * Fraction of equity to deploy per position, in [0, 1]. Notional traded
   * = equity * sizeFraction * leverage. Default 1.0 (use full margin).
   */
  sizeFraction?: number;
}

export class MacdPerpAgent extends Agent {
  readonly stopLossPct: number;
  readonly takeProfitPct: number;
  readonly sizeFraction: number;

  // Entry-tracking state. Held in-memory across decide() calls so SL/TP
  // remain anchored to the entry price, not the current bar's close.
  private entryDirection: Direction = 0;
  private entryPrice = 0;

  constructor(config: MacdPerpAgentConfig = {}) {
    super();
    this.stopLossPct = config.stopLossPct ?? 0.02;
    this.takeProfitPct = config.takeProfitPct ?? 0.04;
    this.sizeFraction = config.sizeFraction ?? 1.0;
  }

  override decide(obs: Observation): Action {
    const signal = signalDirection(obs);

    // Detect entries/flips. When direction changes, re-anchor entry price
    // to the current close so subsequent bars use it as the SL/TP reference.
    if (signal !== this.entryDirection) {
      this.entryDirection = signal;
      this.entryPrice = obs.close;
    }

    if (signal === 1) {
      return {
        direction: 1,
        size: this.sizeFraction,
        stopLoss: this.entryPrice * (1 - this.stopLossPct),
        takeProfit: this.entryPrice * (1 + this.takeProfitPct),
      };
    }
    if (signal === -1) {
      return {
        direction: -1,
        size: this.sizeFraction,
        stopLoss: this.entryPrice * (1 + this.stopLossPct),
        takeProfit: this.entryPrice * (1 - this.takeProfitPct),
      };
    }
    return { direction: 0, size: 0 };
  }

  override toJSON(): Record<string, unknown> {
    // Only configuration is hashed — internal entry-tracking state is
    // initialized to zero on every fresh instance, so it stays out of
    // the agent's cryptographic identity.
    return {
      className: 'MacdPerpAgent',
      stopLossPct: this.stopLossPct,
      takeProfitPct: this.takeProfitPct,
      sizeFraction: this.sizeFraction,
    };
  }
}

/** MACD crossover with directional confirmation. */
function signalDirection(obs: Observation): Direction {
  const above = obs.macd > obs.macdSignal;
  const below = obs.macd < obs.macdSignal;
  if (above && obs.macd > 0) return 1;
  if (below && obs.macd < 0) return -1;
  return 0;
}

export default MacdPerpAgent;
