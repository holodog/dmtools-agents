User request is in the 'input' folder. Read all files there.

**IMPORTANT**: Before writing any test, read and follow these inputs in order:
1. `request.md` — the Test Case ticket: objective, preconditions, steps, expected result, and priority.
2. `comments.md` *(if present)* — ticket comment history; recent comments may contain prior test run results, failure analysis, or reviewer feedback.
3. `linked_bugs.md` *(if present)* — **CRITICAL**: linked bugs that block or are related to this test case.
   - Read the **Solution** field and **AI Fix Comments** for each bug carefully.
   - If the fix introduced **timing or async behavior** (e.g., a heartbeat probe with a delay, a polling interval, a retry timeout) — your test **MUST** wait long enough to observe the effect. Do NOT assert immediately after triggering the action.
   - Example: if a bug was fixed by adding a heartbeat probe that runs every 5 seconds, your test must wait at least 5–10 seconds after blocking auth domains before asserting the error appears.
   - If the bug status is `Done` or `In Testing`, the fix is deployed — **run the test against the live implementation** and expect it to pass.
4. Any other files present in the input folder for additional context.

The feature code is **already implemented** in the `main` branch and **deployed**. Your job is to automate this test case — not to implement features.

## Your task

1. Analyze the Test Case: understand what needs to be verified, what type it is (web, mobile, API), and which framework fits best.
2. Check `e2e/fixtures/` and `e2e/helpers/` for existing components and utilities you can reuse.
3. **Check if test already exists** in `e2e/tests/`. If it does, reuse and update it rather than rewriting from scratch. Only modify what is necessary.
4. **Write the actual test code to disk** — use the **Write tool** to create REAL test files on disk with test functions and assertions, NOT just documentation:
   - **Go backend (ms_back)**: use the Write tool to create `services/<service>/e2e/<feature>_e2e_test.go` with a proper `func TestMAJESENS_XXX(t *testing.T)` containing httptest requests and assertions. See `agents/instructions/test_automation/new_test_automation_instructions.md` for the Go httptest template.
   - **Playwright frontend (ms_front)**: use the Write tool to create `e2e/tests/test_{ticket_key}.spec.ts` with actual Playwright test cases.
5. Write output files describing **what test code was written**. **Do NOT report pass/fail results** — tests have not been run yet. GitHub Actions CI will run them after the PR is created.

You may write code in these locations:
- **Frontend Playwright tests**: `e2e/tests/` and `e2e/fixtures/`
- **Backend Go e2e tests**: `services/<service>/e2e/<feature>_e2e_test.go`

## Output files

**CRITICAL: All output files MUST be written to `outputs/` at the repository root** (e.g. `/home/runner/work/repo/repo/outputs/`).
Do NOT write them inside `input/`, `input/TICKET-KEY/`, or any subfolder of `input/`. The post-processing script reads from `outputs/` at the repo root — writing elsewhere means all results will be silently lost.

Run `mkdir -p outputs` first to ensure the directory exists.

- `outputs/response.md` — test code summary in **Jira Markdown** (posted as Jira ticket comment). Describe what test cases were written, how they verify the feature, and which files were created/modified. **Do NOT report pass/fail results.**
- `outputs/pr_body.md` — test code summary in **GitHub Markdown** (used as PR description). Describe the test cases, approach, and files modified. **Do NOT include "Test Result: PASSED/FAILED" or any fabricated test outcomes.**

`response.md` and `pr_body.md` contain the same information but formatted differently — Jira MD vs GitHub MD.

**Do NOT create** `outputs/test_automation_result.json` or any other result status file — tests have not been executed.

Do NOT create branches or push. Do NOT modify any feature source code outside `e2e/` and `services/*/e2e/`.
