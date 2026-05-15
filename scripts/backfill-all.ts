// Run `bacend paper backfill` sequentially for each enrolled agent so
// LiveCertificate gets epoch updates and the /season/[id] dashboard
// renders real on-chain ranking data.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { loadEnv } from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BACEND_DIR = resolve(REPO_ROOT, 'zero-arena-bacend');
const EXAMPLES_DIR = resolve(REPO_ROOT, 'examples');

const AGENT_MODULES: Record<string, string> = {
  'rsi-classic': resolve(EXAMPLES_DIR, '01-rsi-spot-btc/agent.ts'),
  'rsi-aggressive': resolve(EXAMPLES_DIR, '05-rsi-aggressive/agent.ts'),
  'ema-crossover': resolve(EXAMPLES_DIR, '06-ema-crossover/agent.ts'),
  'macd-spot': resolve(EXAMPLES_DIR, '07-macd-spot/agent.ts'),
  'bollinger-meanrev': resolve(EXAMPLES_DIR, '08-bollinger-meanrev/agent.ts'),
};

interface Entry {
  slug: string;
  name: string;
  tokenId: string;
  runHash: string;
}

function runBackfill(entry: Entry, agentPath: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const env = {
      ...process.env,
      PAPER_TOKEN_ID: entry.tokenId,
      PAPER_AGENT_MODULE: agentPath,
      PAPER_GENESIS_HASH: entry.runHash,
      PAPER_SYMBOL: 'btcusdt',
      PAPER_INTERVAL: '15m',
      PAPER_MARKET: 'spot',
      PAPER_INITIAL_BALANCE: '10000',
      PAPER_FEE_BPS: '10',
      PAPER_SLIPPAGE_BPS: '5',
      PAPER_BARS_PER_EPOCH: '24',  // 6h epoch
      PAPER_BACKFILL_DAYS: '3',    // 3 days → ~288 bars → 12 epoch commits
      PAPER_SNAPSHOT_PATH: resolve(BACEND_DIR, `data/paper/snapshot-${entry.tokenId}.json`),
      PAPER_DRY_RUN: 'false',
    };

    console.log(`\n━━━ ${entry.name}  token #${entry.tokenId} ━━━`);
    console.log(`  agent module : ${agentPath}`);

    const child = spawn('npm', ['run', 'paper:backfill'], {
      cwd: BACEND_DIR,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`backfill for ${entry.slug} exited with code ${code}`));
    });
    child.on('error', rejectP);
  });
}

async function main() {
  loadEnv(resolve(EXAMPLES_DIR, '.env'));

  const roster = JSON.parse(
    await readFile(resolve(EXAMPLES_DIR, 'season-roster.json'), 'utf8'),
  ) as { entries: Entry[] };

  for (const entry of roster.entries) {
    const agentPath = AGENT_MODULES[entry.slug];
    if (!agentPath) {
      console.warn(`⚠ no agent module mapped for slug ${entry.slug}, skipping`);
      continue;
    }
    await runBackfill(entry, agentPath);
  }

  console.log(`\n✓ backfill complete for all ${roster.entries.length} agents`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
