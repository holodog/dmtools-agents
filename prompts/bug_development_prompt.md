User request is in 'input' folder, read all files there and do what is requested.

**IMPORTANT** Before anything else, read inputs in this order:
1. `instruction.md` (repo root) — **read this first**: project stack, deployment constraints, approved frameworks, and infrastructure access. All implementation decisions must respect the constraints defined here.
2. `request.md` — full bug ticket: description, steps to reproduce, expected vs actual behaviour, environment, any linked commits
3. `existing_questions.json` — if present, clarification answers from the PO — treat as binding requirements

## ⚠️ CRITICAL: Understand the bug BEFORE looking at code

**Always start by deeply understanding what the user actually experiences**, not what the code looks like.

### Step 0: Reproduce or simulate the bug FIRST

Before reading any source code, do ALL of the following:

1. **Read the Steps to Reproduce carefully** — what does the user click/navigate/do? What is the actual symptom vs expected?
2. **Try to reproduce it**: run the app, open the URL, execute the failing test, or simulate the user action in any way possible.
3. **If a linked test case exists in `request.md`** — run it first. A failing automated test is the fastest way to confirm the root cause. Study what the test actually asserts — it may pinpoint the real problem layer (routing, config, data, UI).
4. **The real root cause may be in routing, configuration, infrastructure, or data** — not in the component named in the ticket title. Follow the symptom, not the title.

**Only if you cannot reproduce the bug** (no browser, no live server, no runnable test) — then fall back to static code analysis. Document in `outputs/rca.md` that reproduction was not possible and why.

## Your workflow (MUST follow in order)

### 1. Root Cause Analysis — write `outputs/rca.md` FIRST

Find the actual root cause in the code before touching anything. See `bug_implementation_instructions.md` for the required format.

### 2. Check if already fixed

After RCA, check recent git history (`git log --oneline -20`) and the relevant code paths.

**If the bug is already fixed in a prior commit**, write `outputs/already_fixed.json`:
```json
{
  "commit": "<short hash>",
  "rca": "<one-sentence root cause>",
  "description": "<which commit/PR fixed it and how>"
}
```
Then write a short summary to `outputs/response.md` and **stop — no code changes**.

### 3. Check if the bug can be fixed at all

If fixing requires external credentials, human decisions, or infrastructure changes outside the codebase — or if there is evidence of multiple failed attempts — write `outputs/blocked.json`:
```json
{
  "reason": "<specific blocker>",
  "tried": ["<what was attempted>"],
  "needs": "<what a human must provide to unblock>"
}
```
Write a clear explanation to `outputs/response.md` and **stop — do not make partial changes**.

### 4. Reproduce the bug with a failing unit test

Write a unit test that fails against the current code. Run it to confirm it fails. This proves the test correctly captures the bug.

### 5. Fix the code

Make the minimum targeted change to fix the root cause. Do not refactor unrelated code.

### 6. Verify

Run the reproduction test (must now pass) and the full test suite (no regressions).

### 7. Write `outputs/response.md`

See `bug_implementation_instructions.md` for the required format (RCA summary, fix description, test coverage, notes).

**OUT OF SCOPE**: E2E automation is not part of this task.

DO NOT create branches or push — focus only on code implementation. You must compile and run tests before finishing.
