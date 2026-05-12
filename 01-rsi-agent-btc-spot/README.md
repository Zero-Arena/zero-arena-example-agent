# 01 — RSI agent on BTC/USDT spot

The canonical "5-minute install-and-run" demo for the Zero Arena SDK.

A simple rule-based RSI(14) mean-reversion agent. The default mode runs
against the live BTC/USDT **15-minute** dataset on 0G Storage (maintained
by [`zero-arena-bacend`](../../zero-arena-bacend/)). The flow demonstrates
the full v0.1 surface: **backtest → certify (T2) → mint as ERC-7857 iNFT**.

For offline iteration, `--backtest-only` reads a deterministic 1h LCG
fixture (`data/btc-usdt-1h.csv`) whose `datasetHash` is stable across
machines — no chain calls, no 0G Storage required.

## Run it

```bash
# from examples/
npm install
npm run 01:backtest        # backtest only — no chain calls, no .env needed
```

You should see something like:

```
▸ dataset: 240 candles  datasetHash=0xa57e…6306
▸ agent:   {"className":"RsiAgent","oversold":30,"overbought":70,"sizeFraction":0.5}

▸ backtest result
  runHash:        0x…
  trades:         …
  totalReturnBps: …
  sharpeX1000:    …
  finalEquity:    …
```

## Full chain flow

To certify the run on Galileo testnet and mint an iNFT:

1. Deploy the contracts (see [`zero-arena-contracts/README.md`](../../contracts/README.md)) and copy the addresses into `.env`.
2. Fund the deployer wallet at <https://faucet.0g.ai>.
3. Copy `../../sdk/.env.example` → `.env` (in this folder or `sdk/`) and fill in `PRIVATE_KEY`, `ZA_ADDR_CERT`, `ZA_ADDR_INFT`, `ZA_ADDR_ORACLE`.
4. Run:

   ```bash
   npm run 01:run
   ```

You'll see the `runHash`, the `certId` from `AgentCertificate.submit`, the
minted `tokenId` from `ZeroArenaINFT.mint`, plus all transaction hashes
linkable on <https://chainscan-galileo.0g.ai>.

The AES key for the encrypted run log is persisted to
`~/.zeroarena/keys/agent-<tokenId>.key` — keep it safe.

## Trust tier disclosure

Certificates issued by this demo are tagged `trustTier: T2`:

- **T1 (commitment)** — the run is bound on-chain; trades cannot be edited
  after submission.
- **T2 (reproducibility)** — anyone you authorize can re-run the agent
  against the same dataset and assert the same `runHash`.
- **T3 (TEE-attested)** — runs inside 0G Compute as a generic confidential
  substrate; no source disclosure required to verify. **Ships in v0.2** —
  see [`CLAUDE.md` 3 and 14](../../CLAUDE.md).
