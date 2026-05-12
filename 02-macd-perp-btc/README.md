# 02 — MACD perp agent on BTC/USDT

Rule-based momentum at 5× leverage on perpetual futures. Exercises every perp mechanic the SDK supports: leverage, 8h funding accrual, intra-bar SL/TP, isolated-margin liquidation. Offline only — no chain calls.

## Run

```bash
npm run 02:backtest
```

## Strategy

| Condition | Action |
| - | - |
| `macd > macdSignal` AND `macd > 0` | LONG, SL −2%, TP +4% |
| `macd < macdSignal` AND `macd < 0` | SHORT, SL +2%, TP −4% |
| otherwise | flat |

Entry price is stored internally so SL/TP stay anchored to the original fill, not a trailing reference.

## Config

```ts
new MacdPerpAgent({
  stopLossPct:   0.02,
  takeProfitPct: 0.04,
  sizeFraction:  1.0,
});

// engine options
{
  initialBalance: 10_000,
  market: 'perp',
  leverage: 5,
  takerFeeBps: 5,
  slippageBps: 5,
  liquidationMarginBps: 500,   // 5% maintenance margin
}
```

At 5× leverage a 20% adverse move triggers liquidation. The 2% SL closes positions well inside that boundary. Widen the SL or raise leverage and you'll start seeing `reason: 'liquidation'` instead of `'stop_loss'`.

## Offline-only

The canonical perp dataset needs perp ingestion in [`zero-arena-bacend`](../../zero-arena-bacend/), landing later. The bundled `data/btc-perp-fixture.csv` is a seeded Mulberry32 corpus (seed = 43) with realistic 1h OHLC and 8-candle funding ticks.

## Trust tier

`T2`. Deterministic agent + deterministic engine + deterministic fixture. T3 in v0.2 — same code, no API change.
