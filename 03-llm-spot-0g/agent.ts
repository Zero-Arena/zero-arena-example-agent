// 03-llm-spot-0g — LLM-driven trading agent on 0G/USDT spot.
//
// The model choice is yours — we pass observations and parse a direction back.
// Default uses Anthropic's Claude SDK because it's a familiar reference, but
// swap the call body for OpenAI / a local model / a hosted Llama / anything.
//
// Determinism caveat (CLAUDE.md §3): LLM API responses are not byte-stable
// across calls. The runHash anchors the *recorded* outputs only — re-running
// with the same agent + dataset will produce a different runHash if the
// model returns different responses. The certificate stays at T2.
// v0.2 lifts this to T3 by running the call inside a 0G Compute TEE and
// capturing a TeeTLS-signed receipt of the outbound request.

import Anthropic from '@anthropic-ai/sdk';
import { Agent, type Action, type Observation } from 'zeroarena';

export interface LlmAgentOptions {
  apiKey?: string;
  model?: string;
  sizeFraction?: number;
}

export class LlmAgent extends Agent {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly sizeFraction: number;

  // Append-only log of every (obs index, model output) pair. Stays inside the
  // agent — picked up by toJSON() so the run log committed via runHash covers
  // every model decision deterministically.
  private readonly decisions: Array<{ index: number; raw: string; direction: -1 | 0 | 1 }> = [];

  constructor(opts: LlmAgentOptions = {}) {
    super();
    const key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.client = key.length > 0 ? new Anthropic({ apiKey: key }) : null;
    this.model = opts.model ?? 'claude-sonnet-4-6';
    this.sizeFraction = opts.sizeFraction ?? 0.5;
  }

  async decide(obs: Observation): Promise<Action> {
    if (!this.client) {
      // Deterministic offline fallback so the example runs without an API key.
      const dir: -1 | 0 | 1 = obs.rsi14 < 35 ? 1 : obs.rsi14 > 65 ? 0 : obs.position > 0 ? 1 : 0;
      this.decisions.push({ index: obs.index, raw: '(offline fallback)', direction: dir });
      return { direction: dir, size: dir === 1 ? this.sizeFraction : 0 };
    }

    const prompt =
      `Bar ${obs.index} of 0G/USDT spot. Close ${obs.close.toFixed(4)}, ` +
      `RSI14 ${obs.rsi14.toFixed(2)}, MACD ${obs.macd.toFixed(4)} signal ${obs.macdSignal.toFixed(4)}, ` +
      `position ${obs.position}, equity ${obs.equity.toFixed(2)}. ` +
      `Answer exactly one word: LONG, FLAT, or HOLD.`;

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .toUpperCase();

    const dir: -1 | 0 | 1 =
      raw.startsWith('LONG') ? 1 :
      raw.startsWith('FLAT') ? 0 :
      obs.position > 0 ? 1 : 0;

    this.decisions.push({ index: obs.index, raw, direction: dir });
    return { direction: dir, size: dir === 1 ? this.sizeFraction : 0 };
  }

  // Surfaces hyperparameters AND every model decision into agentHash. Two
  // runs that produce the same prompts + answers will have the same hash;
  // any drift in model output produces a different hash.
  override toJSON(): Record<string, unknown> {
    return {
      className: 'LlmAgent',
      model: this.model,
      sizeFraction: this.sizeFraction,
      decisions: this.decisions,
    };
  }
}

export default LlmAgent;
