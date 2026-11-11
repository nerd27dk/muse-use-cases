#!/usr/bin/env node
// compare-snapshots.mjs <old.json> <new.json> [--md]
//
// Read-only diff of two /api/use-cases snapshots. No network; the only output
// is the report on stdout. Input: a full API body ({..., cases: [...]}) or a
// bare case array.
//
// Semantics:
// - Case identity is the string `id`. Duplicate IDs, malformed roots, missing
//   files and invalid JSON are reported as structured errors, exit 2.
// - Object key ORDER is never a change (keys canonicalized recursively).
// - Array order is significant EXCEPT for `origins`, which upstream treats as
//   a set (merge bookkeeping); origins is compared order-insensitively.
// - An ABSENT key and a key explicitly set to null are different things:
//   they are reported as 'added' / 'removed', not 'changed'.
// - Fields are compared over the UNION of all keys seen in both snapshots;
//   unknown future fields are compared and listed in fields_beyond_known_schema,
//   never dropped.
// - Root envelope fields (version, refreshedAt, counts, ...) are diffed
//   separately in envelope_changes. They never affect the case verdict and
//   never set the exit code: a new `refreshedAt` alone is not content drift.
//
// Exit: 0 = no case differences, 1 = case differences found, 2 = bad input.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const paths = args.filter(a => !a.startsWith('--'));
const usage = 'usage: compare-snapshots.mjs <old.json> <new.json> [--md]\n' +
  '       compare-snapshots.mjs --fingerprint <snapshot.json>   (print public-safe per-field hash map)';
if (flags.some(f => f !== '--md' && f !== '--fingerprint') ||
    (flags.includes('--fingerprint') ? (paths.length !== 1 || flags.includes('--md')) : paths.length !== 2)) {
  console.error(usage); process.exit(2);
}
const [oldPath, newPath] = paths;
const errors = [];
const sha256 = p => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
  catch (e) { errors.push(`${p}: unreadable (${e.code || e.message})`); return null; } };
const sha256buf = b => createHash('sha256').update(b).digest('hex');
const canon = v => {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
};
const canonField = (field, v) => {
  if (field === 'origins' && Array.isArray(v)) return '[' + v.map(canon).sort().join(',') + ']';
  return canon(v);
};
const FAIL = Symbol('read-failure');
const readJson = (p, label) => {
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) { errors.push(`${label}: unreadable file (${e.code || e.message})`); return FAIL; }
  try { return JSON.parse(raw); } catch (e) { errors.push(`${label}: not valid JSON (${e.message})`); return FAIL; }
};
const load = (p, label) => {
  const d = readJson(p, label);
  if (d === FAIL) return { map: new Map(), envelope: null, fingerprint: false };
  // Fingerprint format: {format:'use-cases-fingerprint/1', cases:{id:{field:hash}}}
  if (d && typeof d === 'object' && !Array.isArray(d) && d.format === 'use-cases-fingerprint/1') {
    if (!d.cases || typeof d.cases !== 'object' || Array.isArray(d.cases)) {
      errors.push(`${label}: fingerprint has no cases map`); return { map: new Map(), envelope: null, fingerprint: false };
    }
    const m = new Map();
    for (const [id, fields] of Object.entries(d.cases)) {
      if (!id) { errors.push(`${label}: fingerprint has an empty id`); continue; }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) { errors.push(`${label}: fingerprint case "${id}" is not a field map`); continue; }
      if (Object.prototype.hasOwnProperty.call(fields, 'id')) { errors.push(`${label}: fingerprint case "${id}" must not contain an 'id' field`); continue; }
      const bad = Object.entries(fields).find(([, v]) => typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v));
      if (bad) { errors.push(`${label}: fingerprint case "${id}" field "${bad[0]}" is not a 64-hex hash`); continue; }
      m.set(id, { id, ...fields });
    }
    if (typeof d.case_count === 'number' && d.case_count !== m.size && !errors.length) errors.push(`${label}: case_count ${d.case_count} != ${m.size} cases in map`);
    // Envelope: refreshedAt carried in plain; every other envelope field is a hash.
    const envelope = { refreshedAt: d.upstream_refreshedAt ?? null };
    if (d.envelope_hashes && typeof d.envelope_hashes === 'object') Object.assign(envelope, d.envelope_hashes);
    return { map: m, envelope, raw_sha256: d.raw_sha256 ?? null, fingerprint: true };
  }
  let cases, envelope = null;
  if (Array.isArray(d)) { cases = d; }
  else if (d && typeof d === 'object') {
    if (!Array.isArray(d.cases)) { errors.push(`${label}: root object has no cases array`); return { map: new Map(), envelope: null, fingerprint: false }; }
    cases = d.cases;
    envelope = Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'cases'));
  } else { errors.push(`${label}: root must be an object or array`); return { map: new Map(), envelope: null, fingerprint: false }; }
  const m = new Map();
  for (const [i, c] of cases.entries()) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(`${label}: case #${i} is not an object`); continue; }
    if (typeof c.id !== 'string' || !c.id) { errors.push(`${label}: case #${i} missing non-empty string id`); continue; }
    if (m.has(c.id)) errors.push(`${label}: duplicate id "${c.id}"`);
    m.set(c.id, c);
  }
  return { map: m, envelope, fingerprint: false };
};

// --fingerprint mode: print a public-safe per-field hash map of one snapshot.
// Reuses the SAME validated load + canonicalization as the differ, so a
// fingerprint diff can never diverge from a raw diff. Duplicate IDs and
// malformed input fail exactly as in comparison mode.
if (flags.includes('--fingerprint')) {
  const S = load(paths[0], 'input');
  if (errors.length) { console.log(JSON.stringify({ errors }, null, 2)); process.exit(2); }
  if (S.fingerprint) { console.log(JSON.stringify({ errors: ['input is already a fingerprint'] }, null, 2)); process.exit(2); }
  const out = {
    format: 'use-cases-fingerprint/1',
    raw_sha256: sha256(paths[0]),
    upstream_refreshedAt: (S.envelope && S.envelope.refreshedAt) || null,
    envelope_hashes: Object.fromEntries(Object.entries(S.envelope || {})
      .filter(([k]) => k !== 'refreshedAt').sort().map(([k, v]) => [k, sha256buf(canon(v))])),
    case_count: S.map.size,
    cases: Object.fromEntries([...S.map.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([id, c]) => [id,
      Object.fromEntries(Object.keys(c).filter(k => k !== 'id').sort().map(k => [k, sha256buf(canonField(k, c[k]))]))])),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
const oldS = load(oldPath, 'old'), newS = load(newPath, 'new');
if (errors.length) { console.log(JSON.stringify({ errors }, null, 2)); process.exit(2); }
if (oldS.fingerprint !== newS.fingerprint) {
  console.log(JSON.stringify({ errors: ['cannot compare a raw snapshot against a fingerprint; fingerprint both sides first'] }, null, 2));
  process.exit(2);
}

const allFields = [...new Set([...oldS.map.values(), ...newS.map.values()].flatMap(c => Object.keys(c)))].sort();
const KNOWN = ['id','title','category','prompt','description','story','sourceHandle','sourceUrl','sourceName','hasPrompt','addedAt','origins'];
const added = [], removed = [], changed = [], histogram = {};
for (const [id, c] of [...newS.map.entries()].sort()) {
  const o = oldS.map.get(id);
  if (!o) { added.push(oldS.fingerprint ? { id } : { id, category: c.category ?? null, title: c.title ?? null, addedAt: c.addedAt ?? null }); continue; }
  const fields = [];
  for (const f of allFields) {
    if (f === 'id') continue;
    const inO = Object.prototype.hasOwnProperty.call(o, f), inN = Object.prototype.hasOwnProperty.call(c, f);
    if (inO && !inN) fields.push({ field: f, kind: 'removed' });
    else if (!inO && inN) fields.push({ field: f, kind: 'added' });
    else if (canonField(f, o[f]) !== canonField(f, c[f])) fields.push({ field: f, kind: 'changed' });
  }
  if (fields.length) { changed.push({ id, fields }); for (const { field } of fields) histogram[field] = (histogram[field] || 0) + 1; }
}
for (const id of [...oldS.map.keys()].sort()) if (!newS.map.has(id)) removed.push(id);

const envelope_changes = [];
if (oldS.envelope || newS.envelope) {
  const keys = [...new Set([...Object.keys(oldS.envelope || {}), ...Object.keys(newS.envelope || {})])].sort();
  for (const k of keys) {
    const inO = oldS.envelope && Object.prototype.hasOwnProperty.call(oldS.envelope, k);
    const inN = newS.envelope && Object.prototype.hasOwnProperty.call(newS.envelope, k);
    if (inO && !inN) envelope_changes.push({ field: k, kind: 'removed' });
    else if (!inO && inN) envelope_changes.push({ field: k, kind: 'added' });
    else if (canon(oldS.envelope[k]) !== canon(newS.envelope[k])) envelope_changes.push({ field: k, kind: 'changed' });
  }
}
const report = {
  old_sha256: sha256(oldPath), new_sha256: sha256(newPath),
  comparison: oldS.fingerprint ? 'fingerprint-vs-fingerprint' : 'raw',
  old_raw_sha256: oldS.raw_sha256 ?? null, new_raw_sha256: newS.raw_sha256 ?? null,
  old_total: oldS.map.size, new_total: newS.map.size,
  added, removed, changed,
  unchanged: newS.map.size - added.length - changed.length,
  field_histogram: histogram,
  fields_observed: allFields,
  fields_beyond_known_schema: allFields.filter(f => !KNOWN.includes(f)),
  envelope_changes,
  note: 'envelope_changes (e.g. refreshedAt) never affect the case verdict or the exit code',
};
if (flags.includes('--md')) {
  const fmt = c => `- ${c.id}: ` + c.fields.map(f => f.kind === 'changed' ? f.field : `${f.field} (${f.kind})`).join(', ');
  const L = [
    `# Snapshot diff`, ``,
    `- old: ${report.old_total} cases, sha256 ${report.old_sha256}`,
    `- new: ${report.new_total} cases, sha256 ${report.new_sha256}`,
    `- added: ${added.length} | removed: ${removed.length} | changed: ${changed.length} | unchanged: ${report.unchanged}`, ``,
    `## Field change histogram`, ...(Object.keys(histogram).length ? Object.entries(histogram).sort().map(([f, n]) => `- ${f}: ${n}`) : ['- (none)']), ``,
    `## Fields beyond the known schema`, ...(report.fields_beyond_known_schema.length ? report.fields_beyond_known_schema.map(f => `- ${f}`) : ['- (none)']), ``,
    `## Envelope changes (metadata only; not case drift)`, ...(envelope_changes.length ? envelope_changes.map(e => `- ${e.field} (${e.kind})`) : ['- (none)']), ``,
    `## Added IDs`, ...(added.length ? added.map(a => a.title !== undefined ? `- ${a.id} (${a.category}) ${a.title}` : `- ${a.id}`) : ['- (none)']), ``,
    `## Removed IDs`, ...(removed.length ? removed.map(r => `- ${r}`) : ['- (none)']), ``,
    `## Changed IDs`, ...(changed.length ? changed.map(fmt) : ['- (none)']),
  ];
  console.log(L.join('\n'));
} else {
  console.log(JSON.stringify(report, null, 2));
}
process.exit(added.length || removed.length || changed.length ? 1 : 0);
