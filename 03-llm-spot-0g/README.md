# 03 — LLM agent on 0G/USDT spot

Demonstrates that any `decide()` body works — including one that calls an external LLM. Model choice is the developer's; Zero Arena is model-agnostic infrastructure (CLAUDE.md §1).

## Strategy

For each 15m candle, the agent serializes the observation (close, RSI14, MACD, position, equity) into a one-shot prompt and parses one of `LONG | FLAT | HOLD` back from the model. Defaults to Anthropic Claude (`claude-sonnet-4-6`) but swap the call body for any provider.

When `ANTHROPIC_API_KEY` is unset the agent falls back to a deterministic RSI heuristic — so the pipeline still runs end-to-end without paid API access.

## Run

```bash
# offline-fallback path (no API key needed)
npx tsx 03-llm-spot-0g/run.ts

# live Claude calls
ANTHROPIC_API_KEY=sk-ant-… npx tsx 03-llm-spot-0g/run.ts
```

Prerequisites:

- `examples/.env` filled (PRIVATE_KEY + mainnet addresses — already pinned by `.env.example`)
- 0G/USDT dataset uploaded to 0G mainnet Storage and pinned in `sdk/src/datasets.ts`. If absent, the script throws with a helpful command to bootstrap.

## Trust tier — read this before you market the cert

The agent records every model decision into `toJSON()` so the prompt/response sequence becomes part of `agentHash`. That means:

- A re-run that gets the exact same model output produces the exact same `runHash`. ✅
- A re-run where the model returns *different* output produces a *different* `runHash`. ⚠️
- LLM responses are not byte-stable across calls. Anyone verifying must either trust the recorded log or accept that they cannot reproduce the agent from source.

The certificate stays at **T2** (reproducible by anyone who has the run log + AES key). v0.2 lifts this to **T3** by running the agent inside a 0G Compute TEE with a TeeTLS-signed receipt of every outbound API call — without changing your model choice or the call body.

## Customizing

Swap providers in `agent.ts`:

```ts
// OpenAI:
const res = await openai.chat.completions.create({ model, messages, max_tokens: 8 });
const raw = res.choices[0]?.message?.content ?? '';

// local model via fetch:
const res = await fetch('http://localhost:11434/api/generate', { ... });
```

Everything outside `decide()` stays the same — backtest engine, hashing, certify, mint.
