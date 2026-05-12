# 02 — MACD perp agent on BTC/USDT

Rule-based momentum agent on the **perpetual futures** market. Uses
5× leverage, isolated margin, with stop-loss + take-profit anchored at
entry. Demonstrates every perp-specific mechanic the SDK supports:

- Leverage (notional = equity × size × leverage)
- 8-hour funding accrual
- Intra-bar stop-loss / take-profit resolution
- Isolated-margin liquidation

Pure offline backtest — no chain calls, no 0G Storage round-trip. The
example focuses on the *agent + engine* surface so devs can read it
end-to-end in one sitting.

## Run it

```bash
# from examples/
npm install
npm run 02:backtest
```

Expected output (deterministic — same `runHash` on any machine):

```
▸ dataset (offline LCG perp fixture): 480 candles
  datasetHash=0xac99229cf38d…
  market=perp granularity=1h
▸ agent:   {"className":"MacdPerpAgent","stopLossPct":0.02,"takeProfitPct":0.04,"sizeFraction":1}
▸ options: {"initialBalance":10000,"market":"perp","leverage":5,…}

▸ backtest result
  runHash:           0xd1c1550c35d4…
  trades:            345
  totalReturnBps:    338  (= 3.38%)
  sharpeX1000:       497
  …
```

## The strategy

`MacdPerpAgent` enters on MACD-vs-signal crossover **with directional
confirmation**:

| Condition | Action |
| - | - |
| `macd > macdSignal` AND `macd > 0` | go LONG, set SL −2%, TP +4% |
| `macd < macdSignal` AND `macd < 0` | go SHORT, set SL +2%, TP −4% |
| otherwise | flat |

The agent stores the entry price internally so SL and TP stay anchored
to the original fill, not a trailing reference.

## Agent config

Everything tunable is a constructor argument and lives in `toJSON()`,
so it becomes part of the agent's cryptographic identity (`agentHash`):

```ts
new MacdPerpAgent({
  stopLossPct:   0.02,   // 2% adverse move closes the position
  takeProfitPct: 0.04,   // 4% favorable move closes the position
  sizeFraction:  1.0,    // use full available margin per entry
});
```

To explore: try `stopLossPct: 0.01` for tighter stops (more losses,
fewer drawdowns), or `takeProfitPct: 0.06` for wider targets (fewer
wins, larger winners). Each new combination yields a different
`agentHash` and so a different certificate identity.

## Backtest options

`run.ts` configures the engine at:

```ts
{
  initialBalance: 10_000,
  market: 'perp',
  leverage: 5,             // 5×
  takerFeeBps: 5,          // Binance VIP-0 perp taker fee
  slippageBps: 5,          // 0.05% per fill
  liquidationMarginBps: 500, // 5% maintenance margin
}
```

The `liquidationMarginBps: 500` setting is the textbook isolated-margin
threshold. At 5× leverage, an adverse move of roughly 20% from entry
would trigger liquidation. The 2% stop-loss above is far inside that
boundary — the design is "let SL close the trade before liquidation
ever fires." If you widen the SL or increase leverage, expect to see
trades exit with `reason: 'liquidation'` instead of `'stop_loss'`.

## Why offline-only

The canonical perp dataset on 0G Storage requires perp ingest in
[`zero-arena-bacend`](../../zero-arena-bacend/), which lands in a later
sprint. The bundled `data/btc-perp-fixture.csv` is generated from a
seeded Mulberry32 PRNG (seed = 43) with realistic 1h OHLC, 0.4%
per-bar volatility, and funding-rate ticks every 8 candles — enough
to exercise every code path in the SDK's perp engine without an
external dependency.

When the backend ships perp ingestion, this folder will gain a `--live`
flag to load `BTCUSDT-15m-perp` from 0G Storage and certify + mint the
run on chain (same `runHash` schema; only the dataset changes).

## Trust tier

`T2` (commitment + reproducibility). The agent is deterministic:

- No `Math.random()`. The `signalDirection` decision is a pure function of
  pre-computed indicators in `obs`.
- No `Date.now()`. The engine uses each candle's own `timestamp`.
- Internal entry-price state is initialized to zero on construction;
  every run on every machine produces byte-identical trades and the
  same `runHash`.

T3 (TEE-attested) ships in a later release — same agent code, same
backtest, executed inside a 0G Compute enclave with no source
disclosure required to verify. See [`CLAUDE.md` 3 + 14](../../CLAUDE.md).
