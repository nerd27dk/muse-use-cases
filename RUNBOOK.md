# Dataset refresh runbook (muse-use-cases)

How to refresh our picture of the upstream use-case library and see exactly what changed. Repeatable without any chat history. Scope: the dataset refresh only - nothing here publishes anything to RAISE or changes existing repo files.

## Data classes

- RAW snapshot: full API response, texts included. PRIVATE. Lives only in the private raw storage (`RAW_STORE`), never in this repo, never in git.
- FINGERPRINT: case IDs + sha256 per field. PUBLIC, in git under `snapshots/`.
- Diff reports: PUBLIC, under `diffs/`.
- Publish decisions (what goes to RAISE and why): PRIVATE, outside this repo.

## Where things live (two separate places)

- `RAW_STORE`: a private LOCAL directory outside any git repo. This is the working store every command below uses. Its concrete path is recorded in the operator's private notes, and a copy of this runbook with the real path filled in sits next to the raws, so the location can be recoverable from either side. Default suggestion: `~/RAISE-raw-snapshots`.
- Drive archive: the Google Drive folder `RAISE-Cases-source-snapshots` in the operator's private My Drive. It is NOT a local path and no shell command below writes to it. Uploading a raw snapshot there is a separate, GO-gated manual step (block F): local file `RAW_STORE/<stem>-raw-api-use-cases.json` -> Drive folder, same filename, plus `RAW_STORE/SHA256SUMS` refreshed after each addition.

## Gates

- Allowed without approval: capture, local storage, fingerprinting, diffing, tests, reading, deleting scratch files in the temp workspace.
- Requires the owner's explicit GO: any commit, any push, EVERY upload to the Drive archive (each refresh, unless the owner grants an explicit standing rule otherwise), deleting any stored snapshot or report, any RAISE publication.

## Naming

Times: `CAP` = capture time (UTC, when WE fetched), `SYNC` = upstream `refreshedAt` (when their worker merged, colons stripped). They differ; both go in the filename.
- Raw (private): `<CAP>-captured_upstream-sync-<SYNC>-raw-api-use-cases.json`
- Fingerprint (public): same stem, `-fingerprint.json`
- Diff report: `diffs/<CAP>.md` (capture time, so several runs on one day never overwrite)
- This naming is a manual procedure done with the shell variables below; there is no naming script.

## Cycle (manual, one block at a time)

Paste ONE labeled block at a time and read its output before continuing. Each block ends in a clear OK / FAILED line; on FAILED stop, do not paste the next block. Blocks avoid `set -e` on purpose (a diff's exit code 1 is normal, not a crash); instead every step chains with `&&` so a failure stops that block before any file move or hash append. Commands run from the repo root unless stated; `( ... )` subshells keep the working directory unchanged. Prerequisites: node 22, repo cloned, branch `dataset-refresh`, clean tree, `shasum` (standard on macOS; on Linux use `sha256sum` - same hash).

**A. Set and verify the private raw store (once per terminal):**

```bash
command -v git >/dev/null && command -v shasum >/dev/null && command -v node >/dev/null && echo TOOLS_OK || echo "TOOLS_FAILED: git, shasum and node are required - stop"
RAW_STORE=~/RAISE-raw-snapshots        # use your real private path; record it in private notes
mkdir -p "$RAW_STORE" && { git -C "$RAW_STORE" rev-parse --is-inside-work-tree 2>/dev/null && echo "FAILED: RAW_STORE is inside a git repo" || echo "OK: $RAW_STORE exists, outside git"; }
```

**B. Capture to scratch (temp dir), validate shape:**

```bash
CAP=$(date -u +%Y-%m-%dT%H%M%SZ) && WORK=$(mktemp -d) && \
curl -sS --fail -o "$WORK/body.json" https://everyai-use-cases.everyai-com.workers.dev/api/use-cases && \
node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(d.cases)||!d.counts||typeof d.counts.total!=="number"||typeof d.refreshedAt!=="string") throw new Error("unexpected API shape"); if(d.cases.length!==d.counts.total) console.log("NOTE: cases.length != counts.total - record this in the diff report"); console.log("cases",d.cases.length,"total",d.counts.total,"sync",d.refreshedAt)' "$WORK/body.json" \
&& echo CAPTURE_OK || echo "CAPTURE_FAILED: stop here, scratch can be discarded"
```

The shape check reflects the API body as observed at the first capture (`cases` array, `counts.total`, `refreshedAt`). It validates shape only, not content semantics. The tooling does not enforce upstream counts; this printed line is the check, by eye.

**C. Derive SYNC automatically from the validated body (fractional seconds removed, colons stripped):**

```bash
SYNC=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const t=Date.parse(d.refreshedAt); if(isNaN(t)) throw new Error("bad refreshedAt"); console.log(new Date(t).toISOString().replace(/\.\d{3}Z$/,"Z").replace(/:/g,""))' "$WORK/body.json") && echo "SYNC_OK $SYNC" || echo "SYNC_FAILED: refreshedAt unparsable - stop"
```

Expected shape: `2026-11-11T060004Z`. No manual typing, no guessing.

**D. Move the body into private storage (no-clobber; hash appended only after a successful move):**

```bash
STEM="${CAP}-captured_upstream-sync-${SYNC}" && RAW="$RAW_STORE/${STEM}-raw-api-use-cases.json" && \
[ -s "$WORK/body.json" ] && [ ! -e "$RAW" ] && \
mv "$WORK/body.json" "$RAW" && \
( cd "$RAW_STORE" && shasum -a 256 "${STEM}-raw-api-use-cases.json" >> SHA256SUMS ) && \
echo "STORE_OK $RAW" || echo "STORE_FAILED: may be partially written - inspect $RAW and $RAW_STORE/SHA256SUMS before any retry"
```

**E. Fingerprint into scratch, validate, publish no-clobber (run from the repo root):**

```bash
FP="snapshots/${STEM}-fingerprint.json" && \
node scripts/compare-snapshots.mjs --fingerprint "$RAW" > "$WORK/fingerprint.json" && \
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(typeof d.case_count!=="number"||typeof d.raw_sha256!=="string") throw new Error("bad fingerprint"); console.log("fingerprint cases",d.case_count,"raw",d.raw_sha256)' "$WORK/fingerprint.json" && \
[ ! -e "$FP" ] && mv "$WORK/fingerprint.json" "$FP" && \
( cd snapshots && shasum -a 256 "${STEM}-fingerprint.json" >> SHA256SUMS ) && \
echo "FINGERPRINT_OK $FP" || echo "FINGERPRINT_FAILED: may be partially written - inspect $FP and snapshots/SHA256SUMS before any retry"
```

Then check by eye: the printed `case_count` equals the `counts.total` from block B, and the printed `raw_sha256` equals the hash recorded in `$RAW_STORE/SHA256SUMS`. On mismatch: the fingerprint file is corrupt or hand-edited - delete the just-created fingerprint (it is this run's scratch output, not a stored snapshot) and regenerate from the raw.

**F. Drive archive upload (SEPARATE manual step, requires a GO for every upload; not a shell command here):**
upload `RAW_STORE/<STEM>-raw-api-use-cases.json` into the Drive folder `RAISE-Cases-source-snapshots` under the same filename, one file per refresh; keep the archive's `SHA256SUMS` copy current alongside it. The archive may also hold the operator's private index and the filled-in copy of this runbook (the one recording the real RAW_STORE path) - all private. Public repo artifacts (fingerprints, diff reports) never go there; raw snapshots never go to the repo.

**G. Diff (run from the repo root).** First run ever: there is no previous fingerprint - skip this block. This baseline only establishes the starting point; a self-diff is a plumbing check and proves nothing about upstream. Later runs - set PREVIOUS to the earlier fingerprint's real path, check it exists, then diff to scratch and publish no-clobber:

```bash
PREVIOUS="snapshots/PASTE-THE-PREVIOUS-FINGERPRINT-FILENAME-HERE.json"   # replace, keep the quotes
DIFF="diffs/${CAP}.md"
if [ ! -f "$PREVIOUS" ]; then echo "DIFF_SKIPPED: PREVIOUS file not found - fix the path, nothing written";
elif [ -e "$DIFF" ]; then echo "DIFF_SKIPPED: $DIFF already exists - nothing written";
else node scripts/compare-snapshots.mjs "$PREVIOUS" "$FP" --md > "$WORK/diff.md"; rc=$?; \
  { [ "$rc" -le 1 ] && mv "$WORK/diff.md" "$DIFF" && echo "DIFF_OK rc=$rc (0 = no case changes, 1 = changes listed in $DIFF)"; } || \
  echo "DIFF_FAILED: bad input (rc=$rc), report not written";
fi
```

**H. Triage the report:**
- Added IDs: new to our records -> candidates for review.
- Removed IDs: note them. Never auto-delete or auto-hide anything downstream.
- Changed IDs: the report lists field names only; read old vs new content in the two RAW files before deciding anything.
- Envelope changes (refreshedAt etc.) are metadata, not case drift.

**I. Decisions:** recorded separately and privately. An upstream change flags an item for re-review; it never overwrites an earlier decision by itself.

**J. After touching the tooling:** `node tests/run-tests.mjs` must print `30 passed, 0 failed`.

## Errors

- Block B prints CAPTURE_FAILED (curl non-zero or shape check throws): upstream down or changed. Discard the scratch body (deleting files inside `$WORK` is always fine - it is temp). Keep the old baseline; retry later. A failed capture never replaces anything.
- Block C prints SYNC_FAILED: fix the SYNC value from block B's output; do not continue until SYNC_OK.
- Block D prints STORE_FAILED: either the scratch body is missing/empty (recapture) or the target raw already exists (pick a fresh CAP - never overwrite a stored snapshot). Because the failure can also happen mid-chain (after mv, during hashing), inspect the target file and the hash log before retrying so no duplicate hash line is appended.
- Block E prints FINGERPRINT_FAILED: investigate the failing stage (its partial output lives in `$WORK` scratch), then inspect `snapshots/` and its SHA256SUMS before rerunning so no duplicate hash line is appended.
- Block G rc>=2 "not valid JSON": a fingerprint file is corrupt - restore it from the raw (block E) rather than editing it by hand. rc>=2 "duplicate id": upstream serves colliding IDs - report it, do not patch the data.
- Block-B NOTE "cases.length != counts.total": upstream envelope is inconsistent; the capture is still storable, but flag it in the diff report.
- API throttling or repeated failures: back off. No rate limit is documented; one GET per cycle is observed to work, not promised.

## Implemented vs proposed

- Implemented and tested: fingerprint generation, fingerprint-vs-fingerprint and raw-vs-raw diff, validation, the 30-assertion test suite.
- Manual procedure, not a tested script: the capture/naming shell blocks above (each block dry-run verified against a local copy of the first capture; the Drive upload step itself is not scripted at all).
- Proposed, NOT implemented: firstSeenAt journal (when WE first saw each ID), scheduled or automatic capture, GitHub automation. Automation may only ever produce a diff report; commits, pushes, Drive uploads and RAISE publication stay GO-gated.
