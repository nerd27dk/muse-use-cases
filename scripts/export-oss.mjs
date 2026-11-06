#!/usr/bin/env node
// scripts/export-oss.mjs — refresh this repository's published contents.
//
// What it does (one command, no dependencies, Node 18+):
//   1. Fetches the live library from the worker API (default: the public
//      everyai-use-cases worker; override with --api <url>).
//   2. Extracts the field-guide-origin cases and regenerates both bundles:
//        worker/src/data/field-guide.js  (worker fallback, merged shape)
//        muse-use-cases.js               (site fallback, raw guide shape)
//      Every non-case export (meta, master prompt, loops, guardrails) is
//      preserved; only the case arrays, snapshots and header comments change.
//   3. Refreshes the headline numbers in README.md from the live counts.
//   4. Verifies: both bundles import, mergeCases() is stable, counts match.
//   5. Prints kept/dropped/added stats. Writes nothing until the fetched
//      data validates, so a failed run never half-updates the tree.
//
// Usage:
//   node scripts/export-oss.mjs                 # refresh from live API
//   node scripts/export-oss.mjs --api <url>     # refresh from another worker
//   node scripts/export-oss.mjs --from <file>   # refresh from saved API JSON
//   node scripts/export-oss.mjs --check         # validate only, write nothing
//
// Exit code is non-zero on fetch/validation failure.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_API = 'https://everyai-use-cases.everyai-com.workers.dev/api/use-cases';
const GUIDE_FILE = 'worker/src/data/field-guide.js';
const TOP_FILE = 'muse-use-cases.js';
const README_FILE = 'README.md';

const GUIDE_KEYS = ['id', 'title', 'category', 'prompt', 'description', 'story',
  'sourceHandle', 'sourceUrl', 'sourceName', 'hasPrompt', 'addedAt', 'origins'];

function usageError(message) {
  console.error(`export-oss: ${message}\nRun: node scripts/export-oss.mjs [--api <url> | --from <file>] [--check]`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { api: DEFAULT_API, from: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--api') {
      opts.api = argv[++i];
      if (!opts.api) usageError('missing value for --api');
    } else if (argv[i] === '--from') {
      opts.from = argv[++i];
      if (!opts.from) usageError('missing value for --from');
    } else if (argv[i] === '--check') {
      opts.check = true;
    } else {
      usageError(`unknown argument: ${argv[i]}`);
    }
  }
  return opts;
}

async function fetchLibrary(apiUrl) {
  let res;
  try {
    res = await fetch(apiUrl, { headers: { accept: 'application/json' } });
  } catch (err) {
    throw new Error(`fetch failed: ${err.message}`);
  }
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  const library = await res.json();
  if (!library || !Array.isArray(library.cases) || !library.cases.length) {
    throw new Error('API returned no cases');
  }
  return library;
}

function guideCases(library) {
  return library.cases.filter(item => (item.origins || []).includes('field-guide'));
}

function validateGuideCases(cases) {
  if (!cases.length) throw new Error('no field-guide-origin cases in library');
  for (const item of cases) {
    if (typeof item.id !== 'string' || !item.id) throw new Error('case without id');
    if (typeof item.title !== 'string' || !item.title) {
      throw new Error(`case ${item.id} without title`);
    }
    if (!item.prompt && !item.description && !item.story) {
      throw new Error(`case ${item.id} carries no content`);
    }
  }
}

function sliceBlock(lines, startMarker) {
  const start = lines.findIndex(line => line.startsWith(startMarker));
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const end = lines.findIndex((line, n) => n > start && (line === '];' || line === '};'));
  if (end < 0) throw new Error(`unterminated block: ${startMarker}`);
  return lines.slice(start, end + 1).join('\n');
}

// One object per line, `": "` / `", "` separators — the same shape the
// original build-muse-module.py writer produced. JSON.stringify per value
// keeps string escaping correct; only the separators are explicit.
function flatValue(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(item => JSON.stringify(item)).join(', ') + ']';
  }
  return JSON.stringify(value ?? null);
}

function flatRow(shaped) {
  const parts = Object.keys(shaped).map(key =>
    JSON.stringify(key) + ': ' + flatValue(shaped[key]));
  return '  {' + parts.join(', ') + '}';
}

function guideRow(item) {
  const shaped = {};
  for (const key of GUIDE_KEYS) shaped[key] = item[key];
  return flatRow(shaped);
}

function rawRow(item) {
  const id = String(item.id || '');
  const shaped = {
    cat: item.category ?? null,
    id: id.startsWith('guide:') ? id.slice('guide:'.length) : id,
    title: item.title ?? null,
    story: item.story ?? null,
    prompt: item.prompt ?? null,
    source_handle: item.sourceHandle ?? null,
    source_url: item.sourceUrl ?? null
  };
  return flatRow(shaped);
}

function buildGuideFile(snapshot, regenDate, cases, current) {
  const lines = current.split('\n');
  const master = lines.find(line => line.startsWith('export const FIELD_GUIDE_MASTER_PROMPT'));
  if (!master) throw new Error('FIELD_GUIDE_MASTER_PROMPT not found');
  const patterns = sliceBlock(lines, 'export const FIELD_GUIDE_PATTERNS');
  const guardrails = sliceBlock(lines, 'export const FIELD_GUIDE_GUARDRAILS');
  const header = [
    '/* ================================================================',
    `   Seed data – Muse use-case field guide (${cases.length} cases, snapshot ${snapshot})`,
    '',
    "   These cases carry the exact prompt that ran them, so they can't be",
    '   fetched from a feed – they\'re bundled with the worker and become the',
    '   base of the merged library that /api/use-cases serves.',
    '',
    '   Regenerated from the live worker API output by scripts/export-oss.mjs',
    `   on ${regenDate}: the original muse.ai share is dead, so the last live`,
    '   snapshot is the source now. Cases keep their origins arrays as served',
    '   (guide + merged crowd data).',
    '',
    '   The master prompt, patterns and guardrails travel with them because',
    '   the capability pack handed to a Muse agent is built from all of it.',
    '   ================================================================ */'
  ].join('\n');
  const meta = [
    'export const FIELD_GUIDE_META = {',
    `  snapshot: "${snapshot}",`,
    '  sourceUrl: "https://muse.ai/s/muse-use-cases-xuxf6fkdeq4oxw",',
    '  agentName: "Muse",',
    '  agentUrl: "https://ai.meta.com/muse/",',
    '  collectedFrom: "X, Threads, Instagram and Hacker News"',
    '};'
  ].join('\n');
  const body = 'export const FIELD_GUIDE_CASES = [\n' +
    cases.map(item => guideRow(item) + ',').join('\n') + '\n];';
  return [header, '', meta, '', master, '', patterns, '', guardrails, '', body, ''].join('\n');
}

function buildTopFile(snapshot, regenDate, cases, current) {
  const lines = current.split('\n');
  const master = lines.find(line => line.startsWith('export const MUSE_MASTER_PROMPT'));
  if (!master) throw new Error('MUSE_MASTER_PROMPT not found');
  const patterns = sliceBlock(lines, 'export const MUSE_PATTERNS');
  const guardrails = sliceBlock(lines, 'export const MUSE_GUARDRAILS');
  const header = [
    '/* ================================================================',
    '   EveryAI - Muse use-case library (bundled fallback)',
    '',
    `   ${cases.length} real Muse (Meta's personal AI agent) use cases, each with the prompt`,
    '   that ran it, plus the master prompt wrapper, the reusable loops and the',
    '   guardrails.',
    '',
    '   This file is the OFFLINE FALLBACK. The live library - which also carries',
    '   crowd-sourced cases, approved community submissions and anything the guide',
    '   adds later - is served by the everyai-use-cases worker and fetched at',
    `   runtime. Snapshot ${snapshot}, regenerated ${regenDate} from live API output`,
    '   (the original muse.ai share is dead) by scripts/export-oss.mjs.',
    '   ================================================================ */'
  ].join('\n');
  const meta = [
    "'use strict';",
    '',
    'export const MUSE_META = {',
    `  snapshot: "${snapshot}",`,
    '  collectedFrom: "X, Threads, Instagram and Hacker News",',
    '  sourceUrl: "https://muse.ai/s/muse-use-cases-xuxf6fkdeq4oxw",',
    '  agentUrl: "https://ai.meta.com/muse/",',
    '  agentName: "Muse"',
    '};'
  ].join('\n');
  const body = 'export const MUSE_CASES = [\n' +
    cases.map(item => rawRow(item) + ',').join('\n') + '\n];';
  return [header, '', meta, '', master, '', patterns, '', guardrails, '', body, ''].join('\n');
}

function refreshReadme(readme, counts) {
  const headline = /\*\*[\d, ]+ real use cases, [\d, ]+ of them with the exact prompt that ran the job\*\*([^\n]*)/;
  const quote = /It covers [\d, ]+ real use cases you can run end to end — [\d, ]+ with the exact prompt/;
  if (!headline.test(readme) || !quote.test(readme)) {
    throw new Error('README headline patterns not found; update README by hand');
  }
  const total = String(counts.total);
  const withPrompt = String(counts.withPrompt);
  return readme
    .replace(headline, `**${total} real use cases, ${withPrompt} of them with the exact prompt that ran the job**$1`)
    .replace(quote, `It covers ${total} real use cases you can run end to end — ${withPrompt} with the exact prompt`);
}

function idSet(text) {
  return new Set([...text.matchAll(/"id": "(guide:[^"]+)"/g)].map(match => match[1]));
}

async function verify(files) {
  const guide = await import(pathToFileURL(join(ROOT, GUIDE_FILE)).href);
  const top = await import(pathToFileURL(join(ROOT, TOP_FILE)).href);
  const sync = await import(pathToFileURL(join(ROOT, 'worker/src/sync.js')).href);
  if (guide.FIELD_GUIDE_CASES.length !== files.guide.length) {
    throw new Error('guide bundle count mismatch after write');
  }
  if (top.MUSE_CASES.length !== files.guide.length) {
    throw new Error('site bundle count mismatch after write');
  }
  const merged = sync.mergeCases([guide.FIELD_GUIDE_CASES]);
  if (merged.length !== files.guide.length) {
    throw new Error(`merge smoke failed: ${merged.length} of ${files.guide.length}`);
  }
  return { guide: guide.FIELD_GUIDE_CASES.length, top: top.MUSE_CASES.length, merged: merged.length };
}

function readLibraryFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${path}: ${err.message}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const library = opts.from ? readLibraryFile(opts.from) : await fetchLibrary(opts.api);
  if (!library || !Array.isArray(library.cases) || !library.cases.length) {
    throw new Error('library has no cases');
  }
  const cases = guideCases(library);
  validateGuideCases(cases);

  const snapshot = (library.agent && library.agent.snapshot) || 'unknown';
  const regenDate = new Date().toISOString().slice(0, 10);
  const currentGuide = readFileSync(join(ROOT, GUIDE_FILE), 'utf8');
  const currentTop = readFileSync(join(ROOT, TOP_FILE), 'utf8');
  const currentReadme = readFileSync(join(ROOT, README_FILE), 'utf8');

  const nextGuide = buildGuideFile(snapshot, regenDate, cases, currentGuide);
  const nextTop = buildTopFile(snapshot, regenDate, cases, currentTop);
  const nextReadme = refreshReadme(currentReadme, library.counts);

  const before = idSet(currentGuide);
  const after = new Set(cases.map(item => item.id));
  const kept = [...before].filter(id => after.has(id)).length;
  const dropped = [...before].filter(id => !after.has(id));
  const added = after.size - kept;

  console.log(`library: total=${library.counts.total} withPrompt=${library.counts.withPrompt} ` +
    `snapshot=${snapshot} refreshedAt=${library.refreshedAt || 'n/a'}`);
  console.log(`guide bundle: ${before.size} -> ${after.size} ` +
    `(kept=${kept} added=${added} dropped=${dropped.length})`);
  for (const id of dropped) console.log(`  dropped: ${id}`);

  if (opts.check) {
    const changed = nextGuide !== currentGuide || nextTop !== currentTop || nextReadme !== currentReadme;
    console.log(changed ? 'check: updates available' : 'check: bundles already fresh');
    process.exit(changed ? 1 : 0);
  }

  writeFileSync(join(ROOT, GUIDE_FILE), nextGuide);
  writeFileSync(join(ROOT, TOP_FILE), nextTop);
  writeFileSync(join(ROOT, README_FILE), nextReadme);
  const verified = await verify({ guide: cases });
  console.log(`verified: guide=${verified.guide} top=${verified.top} merge=${verified.merged}`);
}

main().catch(err => {
  console.error(`export-oss: ${err.message}`);
  process.exit(1);
});
