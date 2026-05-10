// Thin wrapper over Binance's public market-data mirror. We hit
// `data-api.binance.vision` instead of `api.binance.com` because the latter
// is geo-blocked in some regions. The response shape is identical.
//
// Endpoint reference: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data

import type { Candle } from 'zeroarena';

const HOST = 'https://data-api.binance.vision';
const KLINES_PER_REQUEST = 1000;

export interface FetchOpts {
  symbol: string;        // e.g. 'BTCUSDT'
  interval: string;      // e.g. '1h'
  startTs: number;       // ms epoch (inclusive)
  endTs: number;         // ms epoch (exclusive)
  /** Optional callback for progress logging. */
  onPage?: (i: number, fetched: number) => void;
}

/**
 * Page through Binance klines from startTs to endTs and return a
 * deduplicated, chronologically sorted Candle[].
 */
export async function fetchKlines(opts: FetchOpts): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = opts.startTs;
  let page = 0;

  while (cursor < opts.endTs) {
    const url = new URL(`${HOST}/api/v3/klines`);
    url.searchParams.set('symbol', opts.symbol);
    url.searchParams.set('interval', opts.interval);
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(opts.endTs));
    url.searchParams.set('limit', String(KLINES_PER_REQUEST));

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`fetchKlines: ${res.status} from ${url} — ${body.slice(0, 200)}`);
    }
    const rows = (await res.json()) as unknown[][];
    if (rows.length === 0) break;

    for (const r of rows) {
      out.push({
        timestamp: Number(r[0]),
        open:   Number(r[1]),
        high:   Number(r[2]),
        low:    Number(r[3]),
        close:  Number(r[4]),
        volume: Number(r[5]),
      });
    }

    page += 1;
    opts.onPage?.(page, out.length);

    const lastTs = Number(rows[rows.length - 1]![0]);
    if (lastTs >= opts.endTs) break;
    // Advance cursor to one ms after the last candle's openTime to avoid
    // re-fetching it on the next page.
    cursor = lastTs + 1;

    // Be polite to the public mirror.
    await sleep(100);
  }

  // De-duplicate (in case a window boundary caused overlap) and sort.
  const dedup = new Map<number, Candle>();
  for (const c of out) dedup.set(c.timestamp, c);
  return [...dedup.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
