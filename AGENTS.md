# Agent rules for this repository

Shared rules for any agent (or human helper) preparing changes here. Project
procedures (`RUNBOOK.md`, `docs/CASES-BATCH-LIFECYCLE.md`) reference this file
instead of repeating it.

## Ownership and decision rights

- The owner is the GitHub account `nerd27dk`. Nothing merges, deploys or is
  published without the owner's explicit, scoped decision. Agents never merge,
  never force-push, never bypass checks. Do not infer a standing exception from
  any past run.
- GO means an explicit approval that names the exact action and content. A GO
  covers only the action it answers; no upstream yes covers a downstream step.
  Every public or production-affecting write (commit push, PR open, PR
  comment, tag, workflow dispatch, database import) carries its own GO.
  Private preparation writes (drafts, review archives, journal files in
  private storage) run under the authority of the current request or a
  standing grant; ask only for what they do not cover. A failed or stale
  write is reported and re-authorized, never silently retried.

## Pull request order

1. A PR is opened by the team's GitHub App (cw-instinct[bot]) and says so,
   naming its operator.
2. Wait for CI green.
3. Request the Codex review from the owner's personal account `@nerd27dk`
   (a `@codex review` comment from the bot does not start the review).
   Request it on the final version, not on intermediate ones.
4. Apply review fixes, re-check CI.
5. Merge ONLY on a separate, explicit merge GO for that PR. A merge GO for a
   repository with auto-deploy is also a deploy GO - say so when asking.

## Content rules

- English only in the repo: code, data, commit messages, PR text.
- Data classes are defined in `RUNBOOK.md` and `docs/CASES-BATCH-LIFECYCLE.md`:
  raw snapshots, draft/reviewed card texts, registries, database backups, SQL
  and journal receipts are PRIVATE and never enter git. Only IDs + per-field
  checksums (`snapshots/`) and diff reports (`diffs/`) are public.
- Restorability: before a merge that touches published state, record a restore
  point and report it (a pre-merge tag, the practice observed in
  commonworld-one/commonworld, is one good form; this repo has no tag mandate
  of its own yet).
