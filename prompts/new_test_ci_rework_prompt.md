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

The feature code is **already in main branch**. Your job is to fix the test based on the CI failure logs.

## Your task

1. Read `ci_failures.md` to understand exactly what failed in CI.
2. Read the current test code from `pr_diff.txt` or open the existing test file in `e2e/tests/` / `services/*/e2e/`.
3. Fix the test to address the CI failures.
4. Write output files.

**Do NOT run the test yourself** — CI will re-run automatically after you push. The test execution happens in GitHub Actions (unit-tests.yml).

You may ONLY write code inside:
- `e2e/tests/`, `e2e/fixtures/`, `e2e/helpers/` (frontend)
- `services/<service>/e2e/` (backend Go)

## Output files

**⚠️ CRITICAL: All output files MUST be written to `outputs/` at the repository root**.

Run `mkdir -p outputs` first.

- `outputs/response.md` — fix summary in **Jira Markdown** (short, factual): what was fixed and why
- `outputs/pr_body.md` — same content in **GitHub Markdown**

Do NOT create branches or push — the commit and push are handled automatically after you finish.
