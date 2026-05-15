// 05-rsi-aggressive — wider-band RSI mean-reversion on BTC/USDT 15m spot.
//
// Same shape as 01-rsi-spot-btc but with 20/80 thresholds. Wider bands
// produce fewer entries and longer holds — useful as a contrast strategy
// in the multi-agent showcase.

import { Agent, type Action, type Observation } from 'zeroarena';

export class RsiAggressiveAgent extends Agent {
  constructor(
    public readonly oversold = 25,
    public readonly overbought = 75,
    public readonly sizeFraction = 0.7,
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
      className: 'RsiAggressiveAgent',
      oversold: this.oversold,
      overbought: this.overbought,
      sizeFraction: this.sizeFraction,
    };
  }
}

export default RsiAggressiveAgent;
