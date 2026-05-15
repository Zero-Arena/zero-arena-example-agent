// Build a season-ready roster of 5 unique strategies by joining
// on-chain AgentMinted events with our local multi-mint summary +
// the pre-existing Cert 1 / token 1 (RSI Classic from a prior session).

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import { loadEnv } from 'zeroarena';

const HERE = dirname(fileURLToPath(import.meta.url));

const CERT_ABI = [
  'function get(uint256) view returns ((bytes32 runHash, bytes32 storageRootHash, bytes32 datasetHash, bytes32 attestationHash, int256 totalReturnBps, uint256 sharpeX1000, uint256 maxDrawdownBps, uint256 winRateBps, address owner, uint64 createdAt, uint8 trustTier, uint8 market))',
];
const INFT_ABI = [
  'function metadataHashes(uint256) view returns (bytes32)',
  'function storageRoots(uint256) view returns (bytes32)',
  'function certificateOf(uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
];

interface RosterEntry {
  slug: string;
  name: string;
  description: string;
  strategyClass: 'Rule-based' | 'LLM' | 'Custom';
  tokenId: string;
  certId: string;
  runHash: string;
  datasetHash: string;
  storageRoot: string;
  metadataHash: string;
  owner: string;
  totalReturnBps: number;
  sharpeX1000: number;
  maxDrawdownBps: number;
  winRateBps: number;
  market: 'spot' | 'perp';
}

// Hand-built map: tokenId → (slug, name). Token 1 was minted in the
// pre-multi-mint smoke test; tokens 4–7 by this batch.
const TOKEN_MAP: Record<
  number,
  { slug: string; name: string; description: string; strategyClass: 'Rule-based' | 'LLM' | 'Custom' }
> = {
  1: {
    slug: 'rsi-classic',
    name: 'RSI Classic 30/70',
    description: 'RSI(14) mean reversion · oversold 30 / overbought 70 · 50% size.',
    strategyClass: 'Rule-based',
  },
  4: {
    slug: 'rsi-aggressive',
    name: 'RSI Aggressive 25/75',
    description: 'Wider RSI bands · 25/75 · 70% size · fewer trades, larger conviction.',
    strategyClass: 'Rule-based',
  },
  5: {
    slug: 'ema-crossover',
    name: 'EMA Crossover 12/26',
    description: 'Classic trend-follower · long when fast EMA > slow EMA.',
    strategyClass: 'Rule-based',
  },
  6: {
    slug: 'macd-spot',
    name: 'MACD Spot Bull',
    description: 'Long-only MACD crossover · long while MACD > signal AND > 0.',
    strategyClass: 'Rule-based',
  },
  7: {
    slug: 'bollinger-meanrev',
    name: 'Bollinger Mean Reversion',
    description: 'Buy lower band, flat at upper band · 20-bar window, 2σ.',
    strategyClass: 'Rule-based',
  },
};

async function main() {
  loadEnv(resolve(HERE, '..', '.env'));
  const provider = new ethers.JsonRpcProvider(process.env.ZA_RPC!);
  const cert = new ethers.Contract(process.env.ZA_ADDR_CERT!, CERT_ABI, provider);
  const inft = new ethers.Contract(process.env.ZA_ADDR_INFT!, INFT_ABI, provider);

  const tokenIds = Object.keys(TOKEN_MAP).map(Number).sort((a, b) => a - b);
  const entries: RosterEntry[] = [];

  for (const tid of tokenIds) {
    const meta = TOKEN_MAP[tid];
    const owner: string = await inft.ownerOf(tid);
    const certId: bigint = await inft.certificateOf(tid);
    const metadataHash: string = await inft.metadataHashes(tid);
    const storageRoot: string = await inft.storageRoots(tid);
    const c = await cert.get(certId);

    entries.push({
      slug: meta.slug,
      name: meta.name,
      description: meta.description,
      strategyClass: meta.strategyClass,
      tokenId: String(tid),
      certId: certId.toString(),
      runHash: c.runHash,
      datasetHash: c.datasetHash,
      storageRoot,
      metadataHash,
      owner,
      totalReturnBps: Number(c.totalReturnBps),
      sharpeX1000: Number(c.sharpeX1000),
      maxDrawdownBps: Number(c.maxDrawdownBps),
      winRateBps: Number(c.winRateBps),
      market: Number(c.market) === 0 ? 'spot' : 'perp',
    });
  }

  const outPath = resolve(HERE, '..', 'season-roster.json');
  await writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2));

  console.log(`✓ roster written to ${outPath}`);
  console.log(`${entries.length} agents:`);
  for (const e of entries) {
    const ret = (e.totalReturnBps / 100).toFixed(2);
    const sh = (e.sharpeX1000 / 1000).toFixed(2);
    console.log(`  token #${e.tokenId.padEnd(2)} cert #${e.certId.padEnd(2)}  ${e.name.padEnd(28)} ret=${ret.padStart(7)}%  sharpe=${sh.padStart(6)}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
