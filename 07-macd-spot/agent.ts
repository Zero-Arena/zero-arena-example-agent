// 07-macd-spot — long-only MACD crossover for spot markets.
//
// Long when MACD > signal AND MACD > 0 (bullish momentum confirmed).
// Flat otherwise. Spot has no shorts, so the bearish leg from the perp
// variant is simply a "go flat" instead of "go short".

import { Agent, type Action, type Observation } from 'zeroarena';

export class MacdSpotAgent extends Agent {
  constructor(
    public readonly sizeFraction = 0.6,
  ) {
    super();
  }

  override decide(obs: Observation): Action {
    const bullish = obs.macd > obs.macdSignal && obs.macd > 0;
    if (bullish) {
      return { direction: 1, size: this.sizeFraction };
    }
    return { direction: 0, size: 0 };
  }

  override toJSON(): Record<string, unknown> {
    return {
      className: 'MacdSpotAgent',
      sizeFraction: this.sizeFraction,
    };
  }
}

export default MacdSpotAgent;
