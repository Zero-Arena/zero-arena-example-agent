# 00 — Binance OHLCV ingest

Bootstraps and incrementally maintains a single canonical OHLCV dataset on
0G Storage. Default: BTC/USDT 1h spot, starting 2025-01-01 UTC.

## Why one dataset, repeated re-uploads

0G Storage is content-addressed — every byte change produces a new
`rootHash`. To keep one *logical* dataset that grows over time we:

1. Maintain `data/datasets.lock.json` with the **current** rootHash + an
   append-only `history[]` of every prior upload.
2. On each run, fetch only the candles **after** `lock.endTs`, append to
   the local CSV, and re-upload the full file. The new rootHash becomes
   the head; the previous rootHash moves into `history`.
3. Old certificates that committed to a prior rootHash still resolve —
   the bytes are immutably present on 0G Storage.

This matches the spec in [`CLAUDE.md` §2](../../CLAUDE.md): *"Every backtest
across every machine anchors to the same bytes."* What "the same bytes"
means changes when the lock advances; old runs still verify against their
historic rootHash.

## Run it

```bash
# from examples/
npm install

# Bootstrap from 2025-01-01 → now. Takes ~30s on Galileo testnet.
npm run 00:ingest

# Test the pipeline without uploading (shows datasetHash + size).
npm run 00:ingest -- --dry

# Daily incremental: re-run with no flags. It reads the lock, fetches
# only new candles, and updates.
npm run 00:ingest

# Override defaults.
npm run 00:ingest -- --start 2024-01 --symbol ETHUSDT
```

After a successful run you'll see:

```
✓ lock updated: data/datasets.lock.json
  BTCUSDT-1h-spot → rootHash=0x…
```

That `rootHash` is what every downstream agent example loads via
`za.loadDataset({ rootHash })`.

## Lock file shape

```jsonc
{
  "BTCUSDT-1h-spot": {
    "symbol": "BTCUSDT",
    "interval": "1h",
    "market": "spot",
    "source": "binance",
    "rootHash": "0x… (current)",
    "datasetHash": "0x… (keccak256 of canonical CSV bytes)",
    "startTs": 1735689600000,
    "endTs": 1747915200000,
    "candleCount": 11616,
    "uploadedAt": "2026-05-10T12:00:00.000Z",
    "history": [
      { "rootHash": "0x…", "datasetHash": "0x…", "endTs": …, "candleCount": …, "uploadedAt": "…" }
    ]
  }
}
```

## API source

We hit `https://data-api.binance.vision`, the public market-data mirror
that's globally accessible (the primary `api.binance.com` is geo-blocked
in some regions). Endpoint shape is identical: `/api/v3/klines`.

## Cron / automation

To keep the dataset fresh, schedule daily:

```cron
0 0 * * *  cd /path/to/examples && npm run 00:ingest
```

The script is idempotent — running mid-fetch produces the same outcome,
and an already-up-to-date lock is a no-op.
