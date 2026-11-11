#!/usr/bin/env node
// Test runner for compare-snapshots.mjs. Executable assertions, no deps.
// Run: node tests/run-tests.mjs   (from the branch root)
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'compare-snapshots.mjs');
// Temp files live outside the repo and are removed after the run,
// so test fixtures can never pollute the tree or be committed.
const tmp = mkdtempSync(join(tmpdir(), 'compare-snapshots-test-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let pass = 0, fail = 0;
const w = (name, obj) => { const p = join(tmp, name); writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
const run = (a, b, extra = []) => {
  try {
    const out = execFileSync('node', [script, a, b, ...extra], { encoding: 'utf8' });
    return { exit: 0, out };
  } catch (e) { return { exit: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
};
const T = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };
const A = { id: 'guide:a', title: 'Same', category: 'Work', origins: ['field-guide'], description: null };
const B = { id: 'crowd:1', title: 'Old', tags: ['x', 'y'] };

// 1. add / remove / change
let o = w('o1.json', { cases: [A, B, { id: 'submission:old', title: 'Gone' }] });
let n = w('n1.json', { cases: [A, { ...B, title: 'New' }, { id: 'submission:new', title: 'Fresh' }] });
let r = run(o, n); let j = JSON.parse(r.out);
T('1 add/remove/change detected, exit 1', r.exit === 1 && j.added[0]?.id === 'submission:new' && j.removed[0] === 'submission:old' && j.changed[0]?.id === 'crowd:1' && j.unchanged === 1);

// 2. duplicate IDs -> structured error exit 2
r = run(o, w('n2.json', { cases: [A, A] }));
T('2 duplicate id exit 2 with error', r.exit === 2 && JSON.parse(r.out).errors[0].includes('duplicate id'));

// 3. origins reorder ignored; null->value caught; unknown field surfaced
o = w('o3.json', { cases: [{ id: 'g', origins: ['a', 'b'], description: null }] });
n = w('n3.json', { cases: [{ id: 'g', origins: ['b', 'a'], description: 'filled', verifications: 3 }] });
r = run(o, n); j = JSON.parse(r.out);
T('3 origins reorder not a change', r.exit === 1 && j.changed[0].fields.every(f => f.field !== 'origins'));
T('3 null->value is changed', j.changed[0].fields.some(f => f.field === 'description' && f.kind === 'changed'));
T('3 unknown field added+surfaced', j.changed[0].fields.some(f => f.field === 'verifications' && f.kind === 'added') && j.fields_beyond_known_schema.includes('verifications'));

// 4. identical -> exit 0
r = run(o, o); T('4 identical exit 0', r.exit === 0);

// 5. invalid JSON -> structured exit 2
r = run(w('bad.json', 'not json'), o); T('5 invalid JSON exit 2', r.exit === 2 && JSON.parse(r.out).errors[0].includes('not valid JSON'));

// 6. missing file -> structured exit 2 (no throw)
r = run(join(tmp, 'nope.json'), o); T('6 missing file exit 2', r.exit === 2 && JSON.parse(r.out).errors[0].includes('unreadable'));

// 7. malformed roots -> exit 2
T('7a root null exit 2', run(w('r1.json', 'null'), o).exit === 2);
T('7b root number exit 2', run(w('r2.json', '42'), o).exit === 2);
T('7c object without cases exit 2', run(w('r3.json', { nope: 1 }), o).exit === 2);

// 8. object key reorder is not a change
o = w('o8.json', { cases: [{ id: 'g', title: 'T', extra: { a: 1, b: 2 } }] });
n = w('n8.json', { cases: [{ extra: { b: 2, a: 1 }, title: 'T', id: 'g' }] });
r = run(o, n); T('8 key reorder exit 0', r.exit === 0);

// 9. non-origins array reorder IS a change
o = w('o9.json', { cases: [{ id: 'g', tags: ['x', 'y'] }] });
n = w('n9.json', { cases: [{ id: 'g', tags: ['y', 'x'] }] });
r = run(o, n); j = JSON.parse(r.out);
T('9 non-origins array reorder changed', r.exit === 1 && j.changed[0].fields[0].field === 'tags');

// 10. absent key vs explicit null are different
o = w('o10.json', { cases: [{ id: 'g', description: null }] });
n = w('n10.json', { cases: [{ id: 'g' }] });
r = run(o, n); j = JSON.parse(r.out);
T('10a present-null -> absent is removed', r.exit === 1 && j.changed[0].fields[0].kind === 'removed');
r = run(n, o); j = JSON.parse(r.out);
T('10b absent -> present-null is added', r.exit === 1 && j.changed[0].fields[0].kind === 'added');

// 11. envelope refreshedAt alone: reported, exit 0, no case drift
o = w('o11.json', { refreshedAt: 't1', version: 1, cases: [A] });
n = w('n11.json', { refreshedAt: 't2', version: 1, cases: [A] });
r = run(o, n); j = JSON.parse(r.out);
T('11 refreshedAt-only exit 0, envelope lists it', r.exit === 0 && j.envelope_changes.some(e => e.field === 'refreshedAt' && e.kind === 'changed') && j.changed.length === 0);

// 12. usage errors -> exit 2
T('12a unknown flag exit 2', run(o, n, ['--bogus']).exit === 2);
T('12b wrong arg count exit 2', run(o).exit === 2);

// FINGERPRINT MODE
const fp = f => { const r = execFileSync('node', [script, '--fingerprint', f], { encoding: 'utf8' }); return r; };
// 14. fingerprint deterministic + content-free
const fpOut = fp(o); const fpOut2 = fp(o);
j = JSON.parse(fpOut);
T('14 fingerprint deterministic, has raw hash, no URLs/handles', fpOut === fpOut2 && typeof j.raw_sha256 === 'string' && !/x\.com|https?:|@/.test(JSON.stringify(j.cases)));

// 15. fingerprint-vs-fingerprint AGREES with raw-vs-raw on every fixture pair
const pairs = [
  ['base', 'tests/fixtures/base-old.json', 'tests/fixtures/base-new.json'],
  ['evolved', 'tests/fixtures/evolved-old.json', 'tests/fixtures/evolved-new.json'],
  ['tags-reorder', null, null], // built inline below
  ['null-vs-absent', null, null],
];
const inline = {
  'tags-reorder': [['o15a.json', { cases: [{ id: 'g', tags: ['x', 'y'] }] }], ['n15a.json', { cases: [{ id: 'g', tags: ['y', 'x'] }] }]],
  'null-vs-absent': [['o15b.json', { cases: [{ id: 'g', description: null }] }], ['n15b.json', { cases: [{ id: 'g' }] }]],
};
const normRes = j => ({ added: j.added.map(a => a.id), removed: j.removed, changed: j.changed.map(c => ({ id: c.id, fields: c.fields.map(f => f.field + ':' + f.kind) })), histogram: j.field_histogram });
let agree = true, detail = '';
for (const [name, of, nf] of pairs) {
  let op = of, np = nf;
  if (!op) { const [[on, oc], [nn, nc]] = inline[name]; op = w(on, oc); np = w(nn, nc); }
  else { op = join(root, of); np = join(root, nf); }
  const raw = JSON.parse(run(op, np).out);
  const fo = w('fp-' + name + '-o.json', fp(op)), fn = w('fp-' + name + '-n.json', fp(np));
  const fpr = JSON.parse(run(fo, fn).out);
  const a = JSON.stringify(normRes(raw)), b = JSON.stringify(normRes(fpr));
  if (a !== b) { agree = false; detail = name; break; }
}
T('15 fingerprint diff agrees with raw diff on all fixture pairs', agree || (console.log('   mismatch on', detail), false));

// 16. duplicate IDs fail in fingerprint mode too (same validated load)
let threw = false;
try { execFileSync('node', [script, '--fingerprint', w('dup.json', { cases: [A, A] })], { encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { threw = e.status === 2 && (e.stdout || '').includes('duplicate id'); }
T('16 fingerprint mode rejects duplicate IDs exit 2', threw);

// 17. mixed raw vs fingerprint rejected
r = run(o, w('fp-mix.json', fp(o)));
T('17 raw-vs-fingerprint rejected exit 2', r.exit === 2 && r.out.includes('cannot compare'));

// 18. fingerprint envelope: refreshedAt-only change -> exit 0, listed in envelope_changes
const fo18 = w('fp18o.json', fp(w('e18o.json', { refreshedAt: 't1', cases: [A] })));
const fn18 = w('fp18n.json', fp(w('e18n.json', { refreshedAt: 't2', cases: [A] })));
r = run(fo18, fn18); j = JSON.parse(r.out);
T('18 fingerprint refreshedAt-only exit 0, envelope lists it', r.exit === 0 && j.envelope_changes.some(e => e.field === 'refreshedAt') && j.comparison === 'fingerprint-vs-fingerprint');

// 19. fingerprint validation: bad hex, id-key overwrite, empty id, case_count mismatch -> exit 2
let badN = 0;
const badfp = (mut) => { const f = JSON.parse(fp(w('ok-base.json', { cases: [A] }))); mut(f); return w('badfp' + (++badN) + '.json', f); };
T('19a bad hex exit 2', run(badfp(f => { f.cases['guide:a'].title = 'xyz'; }), o).exit === 2);
T('19b id-key in record exit 2', run(badfp(f => { f.cases['guide:a'].id = 'spoof'; }), o).exit === 2);
T('19c empty id exit 2', run(badfp(f => { f.cases[''] = { title: 'a'.repeat(64) }; }), o).exit === 2);
T('19d case_count mismatch exit 2', run(badfp(f => { f.case_count = 999; }), o).exit === 2);

// 20. envelope hashes: non-refreshedAt envelope change surfaces by field name, exit 0
const fe1 = w('fe1.json', fp(w('env1.json', { refreshedAt: 't1', version: 1, cases: [A] })));
const fe2 = w('fe2.json', fp(w('env2.json', { refreshedAt: 't1', version: 2, cases: [A] })));
r = run(fe1, fe2); j = JSON.parse(r.out);
T('20 envelope version change listed, exit 0', r.exit === 0 && j.envelope_changes.some(e => e.field === 'version' && e.kind === 'changed'));

// 21. fingerprint-mode added entries carry id only, no labels
const fa1 = w('fa1.json', fp(w('fa1o.json', { cases: [A] })));
const fa2 = w('fa2.json', fp(w('fa2o.json', { cases: [A, { id: 'crowd:9', title: 'New one', category: 'Fun' }] })));
r = run(fa1, fa2); j = JSON.parse(r.out);
T('21 fingerprint added entry id-only', r.exit === 1 && j.added.length === 1 && j.added[0].id === 'crowd:9' && !('title' in j.added[0]) && !('category' in j.added[0]));

// 13. bare array root accepted
o = w('o13.json', [A]); n = w('n13.json', [{ ...A, title: 'Changed' }]);
r = run(o, n); j = JSON.parse(r.out);
T('13 bare array accepted', r.exit === 1 && j.changed[0].fields[0].field === 'title');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
