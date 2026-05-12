// Same RSI mean-reversion strategy as 01-rsi-spot-btc, but framed as a
// "the future" agent — its static cert would have been minted earlier;
// now we feed it brand-new candles to see how it performs live.

import { Agent, type Action, type Observation } from 'zeroarena';

export class RsiPaperAgent extends Agent {
  constructor(
    public readonly oversold = 30,
    public readonly overbought = 70,
    public readonly sizeFraction = 0.5,
  ) {
    super();
  }

  override decide(obs: Observation): Action {
    if (obs.rsi14 < this.oversold) return { direction: 1, size: this.sizeFraction };
    if (obs.rsi14 > this.overbought) return { direction: 0, size: 0 };
    return { direction: obs.position > 0 ? 1 : 0, size: obs.position > 0 ? this.sizeFraction : 0 };
  }

  override toJSON(): Record<string, unknown> {
    return {
      className: 'RsiPaperAgent',
      oversold: this.oversold,
      overbought: this.overbought,
      sizeFraction: this.sizeFraction,
    };
  }
}

export default RsiPaperAgent;
