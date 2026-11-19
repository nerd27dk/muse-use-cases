# Cases batch lifecycle: from upstream diff to live RAISE cases

How a batch of new upstream use cases becomes reviewed, imported and verified live
cases on RAISE (https://raise.commonworld.one/cases). Written so that any agent can
read it, check every source, and run the full chain. First end-to-end run: the
32-case batch CASE-0755..0786 on 2026-11-19, which is the example set below.

Conventions (same as `docs/ATLAS-SUGGESTION-LIFECYCLE.md` in commonworld-one/commonworld):

- [RULE] = written source, linked. [PRACTICE] = habit observed across runs.
  [OBSERVED] = a verified fact of one run, not a universal rule.
- Every step: Prerequisites / Action / Readiness gate (where to look, what exactly
  must match, when to stop) / GO.
- GO means an explicit, scoped approval from the owner. A GO covers only the action
  it answers; no upstream yes covers a downstream step. Shared rules (identities,
  PR order, Codex review, merge) live in `AGENTS.md` and are not repeated here.
- English only in the repo. Private data never enters this repo (see Data classes).

## Scope and neighbours

- Before this document: `RUNBOOK.md` (dataset refresh: capture, private RAW,
  public fingerprint, public diff). It ends at the diff report.
- This document: triage of the diff -> editorial review -> private reviewed
  archive -> import into the RAISE production database -> live verification ->
  journal. It changes no upstream data and no repo code.
- The RAISE application itself lives in https://github.com/commonworld-one/raise;
  this document only references its database and public pages, it does not
  duplicate that repo's rules.

## Data classes (hard boundaries)

- RAW upstream snapshot: PRIVATE. Never in git. (`RUNBOOK.md`, Data classes.)
- Draft and final card texts, review verdicts and evidence, the published-case
  registry, the pre-import database backup, the executed SQL, the import receipt:
  PRIVATE. They live only in the owner-only Google Drive archive; every Drive
  upload is its own GO-gated step.
- Fingerprint (IDs + per-field sha256) and the diff report: PUBLIC, in git under
  `snapshots/` and `diffs/`. They carry no texts, URLs or handles.
- In this repo, a public artifact must never contain private raw texts, registry
  ledgers, SQL or anything from the private Drive archive.

## Step 0. Entry point and trigger

A short owner message such as "new batch of cases" or "refresh the cases" starts
PREPARATION ONLY: read `RUNBOOK.md` and this document, then work the steps below.
Private preparation (drafts, review, private archives, journal files) runs under
the authority of that request or a standing grant; ask only for what they do not
cover. Public or production-affecting writes (push, PR, import, merge, deploy)
always stop for an explicit GO with exact content.

## Step 1. Refresh and diff (per RUNBOOK.md)

Prerequisites: `RUNBOOK.md` blocks A-E done; the raw is in private storage with
its sha256 in the private `SHA256SUMS`.
Action: run the diff against the previous fingerprint (block G).
Readiness gate: the diff report lists added / removed / changed IDs;
`cases.length` vs `counts.total` anomaly (if any) is recorded in the report.
Record the exact capture time (CAP) at capture. If a capture ever deviates from
the RUNBOOK naming, write a provenance addendum stating the recorded interval and
the exception, and keep it with the private archive
[OBSERVED 2026-11-19: capture had no exact timestamp; the interval
16:54:02-16:54:04 Europe/Riga and the layout exception were recorded in an
addendum, and the public diff carries the interval start as CAP with a note].
GO: none for local capture/fingerprint/diff. Publishing fingerprint + diff to
git always needs an explicit GO; the raw upload to the Drive archive follows the
gate in `RUNBOOK.md` (GO unless the owner has granted a standing rule).

## Step 2. Triage the diff (private)

Action: attach registry context to every added/changed ID (linkage tool from the
refresh work): our status, existing CASE id if any, prior hold reason, reopen
condition. Output is a PRIVATE review list, not a publish/hide decision.
A vanished upstream ID is recorded, history kept; a published case is never
auto-hidden on that alone. A source change is something to study, not a trigger
to edit cases [PRACTICE, owner 2026-11-11].
Readiness gate: every added ID has a triage line (candidate / held + reason).
GO: none. The selection of a batch is proposed to the owner in chat.

## Step 3. Draft the batch (private)

Action: for each selected ID draft the card fields (title, story, reconstructed
prompt, category, proposed curator, source handle/URL, supporting follow-ups).
House wording: faithful retelling of the public post, explicit caveats; prompts
are labelled reconstructed; curators are proposals, not original authors.
GO: none (private drafting).

## Step 4. Editorial gate - the independent final review (private, mandatory)

This step exists because on 2026-11-19 it was missing from every written
procedure and had to be reconstructed from chat history. Never skip it.
Action, on the EXACT final set (after any late additions or removals):
1. Fresh source reads: read every original post again, signed out, plus its
   supporting follow-ups and the author's current bio; read linked repos or
   homepages referenced by a story. No login, no challenge bypass.
2. Per-ID verdicts: PASS / FIX / HOLD, each with evidence. Attribution and
   disclosure: material ties visible in a current bio (e.g. vendor or competitor
   affiliation) are disclosed without backdating them to the post date. [OBSERVED 2026-11-19: 31 PASS, 1 FIX of exactly this kind, 0 HOLD.]
3. Bounded duplicate check: exact URL/status-ID, same-handle, textual and
   thematic comparison against the live published catalog and within the batch.
   Record it as bounded - not an absolute guarantee against unknown aliases or
   reposts. Merge only true same-story follow-ups (primary source + follow-up
   link); merely similar stories by different authors stay separate.
4. FIX loop: apply each fix, recompute the batch content hash, and verify the
   diff shows exactly the intended corrections and nothing else. The corrected
   hash is recorded in the private archive, not in git.
5. Record what PASS means and does not mean: faithful retelling of public
   statements with attribution and caveats - not verification of real refunds,
   bookings, finances or integrations. Note which media were personally viewed
   and which were not (e.g. images seen, videos not fully played), and reflect
   exactly that in the texts.
Readiness gate: all IDs PASS on the corrected manifest; the corrected content
hash is recorded; per-ID verdicts and evidence are saved.
GO: none (private review). The outcome is reported to the owner with the hash.

## Step 5. Private reviewed archive

Action: package source reference, registry, drafts, review verdicts, evidence and
the provenance addendum as a new, separate zip with internal SHA256SUMS; never
overwrite a previous archive. Upload to the owner-only Drive folder (a private
write, covered by the current request or a standing grant; ask only if it is
not), then download the uploaded file back and verify the full sha256 and
every internal checksum; verify access live (single owner, not shared).
[OBSERVED 2026-11-19: a 37-file reviewed-32 zip, named with its own sha256
prefix, download-back verification passed, owner-only confirmed; the previous
archive untouched. Exact archive names stay in the private journal, not in git.]
Readiness gate: downloaded-back bytes match; no other grants on the file.
GO: not required when the request or a standing grant covers the upload.

## Step 6. STOP POINT A - ready for push/PR (public repo artifacts)

Separate from any database work: publish the refresh's public artifacts
(fingerprint + diff report) to git, and any repo document changes, as a PR.
Action: stage only public artifacts (see Data classes), run the repo tests,
compose the PR body (what was captured and when, baseline, added/removed/changed
counts, anomaly notes).
Readiness gate: `git status` shows exactly the intended files; tests pass; no
private content in the diff (`git diff --cached` read in full before reporting).
Report to the owner: the exact file list, hashes and the PR title/body. STOP.
GO: required for push and for opening the PR. PR order then follows `AGENTS.md`:
CI green -> Codex review requested from the owner's personal account -> fixes ->
a separate, explicit merge GO.

## Step 7. Import into RAISE production (GO-gated)

Prerequisites: the reviewed archive (step 5) verified; the owner gave an explicit
GO for THIS import, naming the batch and its content hash.
Action:
1. Fresh full baseline re-read from the live production database: all existing
   case rows, all marks, the muses table and the schema. Compare against the
   pre-import backup archive; on any drift, stop and report.
2. Verify the batch content hash against the reviewed archive.
3. One guarded INSERT for exactly the batch rows (shared created_at). No other
   writes anywhere: no PR, push, deploy, backup-bucket write or restore.
[OBSERVED 2026-11-19: full baseline re-read, no drift; one INSERT for the whole
batch. Row counts, statement size and hash were recorded in the private journal.]
Readiness gate (post-checks, all mandatory): re-read the inserted rows from the
database - every column equals the manifest; old rows identical to before;
marks and hidden counts unchanged; live public pages and API show the new total,
the new cases first, all titles/stories/prompts/source URLs present; a visual
check of the list and one new case page. Record the executed SQL, the new rows
and a receipt into the private journal (a private write, same authority rule as
the archive).
On failure: verify the actual write state before any retry; a rollback stays
within the approved scope and preserves history; never a whole-database restore
without new authority.
GO: required for the import. The journal upload after it is a private
write under the same authority rule.

## Step 8. Close-out report

One message to the owner: what went live (IDs, totals), what was verified and
how, what is NOT done (e.g. unpublished fingerprint/diff, deferred decisions),
and where the journal entry and archives are. Loose ends are named, not dropped.
