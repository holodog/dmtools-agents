User request is in the 'input' folder. Read all files there.

**IMPORTANT**: Before writing any test, read and follow these inputs in order:
1. `request.md` — the Test Case ticket: objective, preconditions, steps, expected result, and priority.
2. `comments.md` *(if present)* — ticket comment history; recent comments may contain prior test run results, failure analysis, or reviewer feedback.
3. `linked_bugs.md` *(if present)* — **CRITICAL**: linked bugs that block or are related to this test case.
   - Read the **Solution** field and **AI Fix Comments** for each bug carefully.
   - If the fix introduced **timing or async behavior** (e.g., a heartbeat probe with a delay, a polling interval, a retry timeout) — your test **MUST** wait long enough to observe the effect. Do NOT assert immediately after triggering the action.
   - Example: if a bug was fixed by adding a heartbeat probe that runs every 5 seconds, your test must wait at least 5–10 seconds after the trigger before asserting the effect appears.
4. Any other files present in the input folder for additional context.

The feature code is **already implemented** in the `main` branch and **deployed**. Your job is to automate this test case — not to implement features.

## Your task

1. Analyze the Test Case: understand what needs to be verified, what type it is (web, API), and which framework fits.
2. Check existing test utilities and fixtures you can reuse:
   - **Frontend (ms_front)**: `e2e/helpers/`, `e2e/fixtures/`, existing `e2e/tests/*.spec.ts`
   - **Backend (ms_back)**: existing `services/<service>/e2e/*_test.go` patterns
3. **Check if the test already exists**. If it does, reuse and update it rather than rewriting from scratch. Only modify what is necessary.
4. **Write the actual test code** — a REAL test file with test functions and assertions, NOT documentation:
   - **Go backend (ms_back)**: `services/<service>/e2e/<feature>_e2e_test.go` with `func TestMAJESENS_XXX(t *testing.T)` using httptest requests and assertions against the running stack.
   - **Playwright frontend (ms_front)**: `e2e/tests/test_{ticket_key}.spec.ts` with actual Playwright test cases, using `page.route()` API mocks and the helpers in `e2e/helpers/`.

## IMPORTANT: Do NOT run tests

**You do NOT execute tests.** Your job is to write test code only. GitHub Actions CI runs the tests after the PR is created.

- Do NOT run `go test`, `npx playwright test`, `npm run test`, `vitest`, `pytest`, or any test command.
- Do NOT report pass/fail results — CI determines the outcome.

## IMPORTANT: Do NOT run git commands

Do NOT run `git add`, `git commit`, `git push`, or any git command. Staging, committing, pushing, and PR creation are handled automatically by the post-processing step.

## Output files — MANDATORY

**⚠️ CRITICAL: All output files MUST be written to `outputs/` at the repository root.** Run `mkdir -p outputs` first. If these files are missing, the pipeline cannot publish your test — the run is wasted.

1. `outputs/response.md` — **Jira Markdown** summary of what test code was written: which test cases, their structure, how they verify the feature. Do NOT report pass/fail.
2. `outputs/pr_body.md` — **GitHub Markdown** PR description: what was automated, approach, files added/modified. Do NOT include "Test Result: PASSED/FAILED".

## ⚠️ VERIFICATION STEP — before you finish

You MUST verify that every file you claim to have created actually exists on disk:

1. `ls -la` the test file path — verify it exists and is non-empty
2. `head -5` the test file — verify it contains real test code
3. `ls -la outputs/` — verify `response.md` and `pr_body.md` exist
4. If any file is MISSING or EMPTY — CREATE IT NOW before finishing.

You may write code only in these locations:
- **Frontend Playwright tests**: `e2e/tests/`, `e2e/fixtures/`
- **Backend Go e2e tests**: `services/<service>/e2e/`

Do NOT modify any feature source code outside those paths.
