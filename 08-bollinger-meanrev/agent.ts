// 08-bollinger-meanrev — Bollinger Bands mean reversion on BTC/USDT spot.
//
// The SDK's Observation doesn't surface Bollinger bands, so we compute
// them ourselves from a rolling window of closes. This is deterministic:
// `decide()` only reads obs values + internal state seeded from prior
// closes — no Math.random, no Date.now.
//
// Rules:
//   - Long when close < lower band (mean - k·σ)
//   - Flat when close > upper band (mean + k·σ)
//   - Hold while inside the bands

import { Agent, type Action, type Observation } from 'zeroarena';

export class BollingerMeanRevAgent extends Agent {
  public readonly window: number;
  public readonly stdK: number;
  public readonly sizeFraction: number;

  // Rolling state — not part of toJSON() (initialized fresh per run).
  private readonly closes: number[] = [];

  constructor(window = 20, stdK = 2, sizeFraction = 0.5) {
    super();
    this.window = window;
    this.stdK = stdK;
    this.sizeFraction = sizeFraction;
  }

  override decide(obs: Observation): Action {
    this.closes.push(obs.close);
    if (this.closes.length > this.window) this.closes.shift();

    // Until the window is warm we sit flat.
    if (this.closes.length < this.window) {
      return { direction: 0, size: 0 };
    }

    const n = this.closes.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.closes[i];
    const mean = sum / n;

    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const d = this.closes[i] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / n);

    const lower = mean - this.stdK * std;
    const upper = mean + this.stdK * std;

    if (obs.close < lower) {
      return { direction: 1, size: this.sizeFraction };
    }
    if (obs.close > upper) {
      return { direction: 0, size: 0 };
    }
    return { direction: obs.position > 0 ? 1 : 0, size: obs.position > 0 ? this.sizeFraction : 0 };
  }

  override toJSON(): Record<string, unknown> {
    return {
      className: 'BollingerMeanRevAgent',
      window: this.window,
      stdK: this.stdK,
      sizeFraction: this.sizeFraction,
    };
  }
}

export default BollingerMeanRevAgent;
