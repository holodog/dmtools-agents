User request is in the 'input' folder. Read all files there.

**IMPORTANT**: Read in order:
1. `request.md` *(if present)* — full ticket details
2. `ci_failures.md` *(if present)* — **CRITICAL**: CI check failure logs with error details. This is your primary input for fixing the test.
3. `comments.md` *(if present)* — ticket comment history
4. `linked_bugs.md` *(if present)* — linked bugs that block or relate to this test case.
   - Read the **Solution** field and **AI Fix Comments** carefully.
   - If the fix introduced **timing or async behavior** — the test **MUST** wait long enough to observe the effect.
5. `ticket.md` — the Test Case ticket (objective, steps, expected result)
6. `pr_info.md` — PR metadata
7. `pr_diff.txt` — current test code diff

The feature code is **already in main branch**. Your job is to **fix the failing test** based on the CI failure logs.

## Your task

1. Read `ci_failures.md` to understand exactly what failed in CI.
2. Read the current test code — open existing test files in `e2e/tests/` or `services/*/e2e/`.
3. Fix the test code to address the CI failures.
4. **Run the test locally** and capture the result:
   - For Go: `go test -v ./services/<service>/e2e/ -run TestMAJESENS`
   - For Playwright: `npx playwright test e2e/tests/test_*.spec.ts`
5. **Perform the CRITICAL VERIFICATION STEP** (see `test_automation_instructions.md` for details).
6. Write output files.

You may ONLY write code inside:
- `e2e/tests/`, `e2e/fixtures/`, `e2e/helpers/` (frontend)
- `services/<service>/e2e/` (backend Go)

## Output files

**⚠️ CRITICAL: All output files MUST be written to `outputs/` at the repository root**.

Run `mkdir -p outputs` first.

- `outputs/response.md` — fix summary in **Jira Markdown** (short, factual): what was fixed and why, test result
- `outputs/pr_body.md` — same content in **GitHub Markdown**
- `outputs/test_automation_result.json` — **MANDATORY** — always write this file. Use exactly:
  ```json
  { "status": "passed", "passed": 1, "failed": 0, "skipped": 0, "summary": "1 passed, 0 failed" }
  ```
  or for failure:
  ```json
  { "status": "failed", "passed": 0, "failed": 1, "skipped": 0, "summary": "0 passed, 1 failed", "error": "AssertionError: <exact error message>" }
  ```
  The `"status"` field **must** be exactly `"passed"` or `"failed"` (lowercase).
- `outputs/bug_description.md` — detailed bug report (only if test still FAILED after fix)

## ⚠️ CRITICAL VERIFICATION STEP — Before you finish

You MUST verify that ALL files you claim to have created actually exist on disk. Do NOT skip this step.

1. Run: `ls -la e2e/tests/test_MAJESENS-*.spec.ts` (or the path to your test file)
2. Run: `cat e2e/tests/test_MAJESENS-*.spec.ts | head -5` — verify the file has content
3. Run: `ls -la outputs/test_automation_result.json`
4. Run: `cat outputs/test_automation_result.json` — verify it has `{"status": "passed"}` or `{"status": "failed"}`

If any file is MISSING or EMPTY, CREATE IT NOW before finishing. Do NOT report PASSED unless the test file exists on disk and contains actual test code.

## ⚠️ CRITICAL: When the test still FAILS — write a detailed bug report

If the test fails after your fix, `outputs/bug_description.md` **must** contain enough detail for a developer to reproduce and fix the bug.

**Required in `bug_description.md`:**

1. **Exact steps to reproduce** — what the test does and what happens at failure point
2. **Exact error message or assertion failure** — full output from test runner
3. **Actual vs Expected** — be specific about what went wrong
4. **Environment details** — URL, browser, OS, config values
5. **Screenshots or logs** — if available

The same level of detail applies to `response.md` — the Jira comment must clearly state **which step failed and why**.

Do NOT create branches or push. Do NOT modify any feature source code outside `e2e/` and `services/*/e2e/`.
