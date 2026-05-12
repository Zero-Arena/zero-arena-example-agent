// 01-rsi-agent-btc-spot — canonical 5-minute demo agent.
//
// Rule-based RSI mean reversion on BTC/USDT spot (long-only). The agent
// goes long when RSI(14) drops below `oversold` and flat when it rises
// above `overbought`. Hyperparameters are surfaced via `toJSON()` so they
// become part of the agent's cryptographic identity (`agentHash`).

import { Agent, type Action, type Observation } from 'zeroarena';

export class RsiAgent extends Agent {
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
    // Hold whatever we have between bands.
    return { direction: obs.position > 0 ? 1 : 0, size: obs.position > 0 ? this.sizeFraction : 0 };
  }

  override toJSON(): Record<string, unknown> {
    return {
      className: 'RsiAgent',
      oversold: this.oversold,
      overbought: this.overbought,
      sizeFraction: this.sizeFraction,
    };
  }
}

export default RsiAgent;
