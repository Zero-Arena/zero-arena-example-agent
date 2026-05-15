// 06-ema-crossover — classic 12/26 EMA crossover, long-only, BTC/USDT spot.
//
// Long while ema12 > ema26 (trend up). Flat otherwise. No stops — the
// crossover is the exit. Comes from the family of trend-following rules
// the SDK's pre-computed indicators support directly.

import { Agent, type Action, type Observation } from 'zeroarena';

export class EmaCrossoverAgent extends Agent {
  constructor(
    public readonly sizeFraction = 0.8,
    public readonly minSpreadBps = 0,
  ) {
    super();
  }

  override decide(obs: Observation): Action {
    const spreadBps = ((obs.ema12 - obs.ema26) / obs.ema26) * 10_000;
    if (spreadBps > this.minSpreadBps) {
      return { direction: 1, size: this.sizeFraction };
    }
    return { direction: 0, size: 0 };
  }

  override toJSON(): Record<string, unknown> {
    return {
      className: 'EmaCrossoverAgent',
      sizeFraction: this.sizeFraction,
      minSpreadBps: this.minSpreadBps,
    };
  }
}

export default EmaCrossoverAgent;
