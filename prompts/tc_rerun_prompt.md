User request is in the 'input' folder. Read all files there.

**IMPORTANT**: Before running any test, read and follow these inputs in order:
1. `request.md` — the Test Case ticket: objective, preconditions, steps, expected result, and priority.
2. Any other files present in the input folder for additional context.

The feature code is **already implemented** in the `main` branch and the linked bug has been **fixed and merged**. Your job is to **re-run the existing automated test** to verify the fix — not to write new tests.

## Your task

1. Find the existing test in `testing/tests/{TICKET-KEY}/`.
2. Run the test and capture the result.
3. **If the test passes** → write output files with status "passed". Do NOT modify test code unless it had a minor fix.
4. **If the test fails** — investigate WHY:
   - **Bug is still present in the application** → write output files with status "failed". Do NOT change test code.
   - **Test code itself has an issue** (e.g. changed selector, updated API, setup problem unrelated to the bug) → fix only the test code and re-run. Write output with the final result.
5. Write output files.

**You may ONLY write code inside the `testing/` folder, and only if the test code itself needs a fix.**

## Output files

- `outputs/response.md` — re-run result summary in **Jira Markdown** (posted as Jira comment). Include: what was re-run, result, and if the test was fixed — what changed.
- `outputs/pr_body.md` — same content in **GitHub Markdown** (used as PR description if code changed).
- `outputs/test_automation_result.json` — structured result:

```json
{
  "status": "passed|failed",
  "summary": "One-sentence result summary",
  "details": "What was verified and what happened"
}
```

Do NOT create branches or push. Do NOT modify any code outside `testing/`.
