User request is in the 'input' folder. Read all files there.

**IMPORTANT**: Read in order:
1. `request.md` *(if present)* — full ticket details
2. `comments.md` *(if present)* — ticket comment history; recent comments contain previous test run results and review feedback
3. `linked_bugs.md` *(if present)* — **CRITICAL**: linked bugs that block or relate to this test case.
   - Read the **Solution** field and **AI Fix Comments** carefully — they describe HOW the bug was fixed.
   - If the fix introduced **timing or async behavior** (e.g., a heartbeat probe with an interval, retry delay, polling timeout) — your test **MUST** wait long enough to observe the effect. Do NOT assert immediately after triggering the action.
   - Example: if the bug was fixed by a heartbeat probe that runs every 5 seconds, the test must wait at least 5–10 seconds after simulating the failure condition before asserting the error appears.
4. `ticket.md` — the Test Case ticket (objective, steps, expected result)
5. `ci_failures.md` *(if present)* — **CRITICAL**: failed CI check output for the current test PR. This is the primary reason the ticket is in rework — fix what these failures describe.
6. `pr_info.md` — PR metadata
7. `pr_diff.txt` — current test code
8. `merge_conflicts.md` *(if present)* — **Resolve all merge conflicts FIRST** before touching anything else: edit the listed files to remove every `<<<<<<<` / `=======` / `>>>>>>>` marker, keeping the correct code. Do NOT run any git commands — staging is handled by post-processing.
9. `pr_discussions.md` — review comments that must be addressed
10. `pr_discussions_raw.json` — structured thread data with IDs

The feature code is **already in the main branch**. Your job is to:
1. Fix all issues raised by CI failures and PR review comments (address every thread)
2. Write the output files

## IMPORTANT: Do NOT run tests

**You do NOT execute tests.** GitHub Actions CI re-runs the tests after your changes are pushed. Do NOT run `go test`, `npx playwright test`, `vitest`, `pytest`, or any test command, and do NOT report pass/fail results.

## IMPORTANT: Do NOT run git commands

Do NOT run `git add`, `git commit`, `git push`, or any git command. Staging, committing, and pushing are handled by the post-processing step.

**You may ONLY modify test code** — `e2e/` (frontend Playwright) and `services/<service>/e2e/` (backend Go). Do NOT modify feature source code.

## Output files — MANDATORY

**⚠️ CRITICAL: All output files MUST be written to `outputs/` at the repository root.** Run `mkdir -p outputs` first. If these files are missing, the pipeline cannot publish your fixes — the run is wasted.

- `outputs/response.md` — rework summary in **Jira Markdown** (short, factual): what was fixed and why. Do NOT report pass/fail — CI determines that.
- `outputs/pr_body.md` — same content in **GitHub Markdown** (posted as a PR comment; use `##`, `**bold**`, backticks — NOT Jira syntax).

## ⚠️ VERIFICATION STEP — before you finish

1. `git status` is NOT allowed — instead: `ls -la` the modified test files and `head -5` them to confirm your changes exist on disk.
2. `ls -la outputs/` — verify `response.md` and `pr_body.md` exist and are non-empty.
3. If any file is MISSING or EMPTY — CREATE IT NOW before finishing.
