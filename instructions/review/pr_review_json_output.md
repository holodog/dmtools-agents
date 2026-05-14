**IMPORTANT** If a file named `instruction.md` exists in the repository root, read it before reviewing.

## outputs/pr_review.json — Single Source of Truth

This JSON file is the **only** output you must produce. It contains the complete review — no separate markdown files needed.

```json
{
  "recommendation": "APPROVE|REQUEST_CHANGES|BLOCK",
  "summary": "Brief overall assessment in one paragraph",
  "prNumber": null,
  "prUrl": null,
  "generalCommentContent": "GitHub markdown text with the full review comment",
  "resolvedThreadIds": [],
  "inlineComments": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "startLine": 40,
      "side": "RIGHT",
      "commentContent": "GitHub markdown text for this inline comment",
      "severity": "BLOCKING|IMPORTANT|SUGGESTION"
    }
  ],
  "issueCounts": {
    "blocking": 2,
    "important": 5,
    "suggestions": 3
  },
  "responseMdContent": "Jira Wiki Markup text for the ticket comment"
}
```

### Field Descriptions

- **recommendation**: MUST be exactly `"APPROVE"`, `"REQUEST_CHANGES"`, or `"BLOCK"` (uppercase). NOT `"APPROVED"`, NOT `"verdict"`.
- **summary**: One paragraph overall assessment (plain text)
- **prNumber**: Leave null (filled by JS action)
- **prUrl**: Leave null (filled by JS action)
- **generalCommentContent**: Full GitHub-formatted review comment as a string. This becomes the PR comment. Use GitHub markdown (headings with `##`, bold with `**`, code blocks with triple backticks).
- **resolvedThreadIds**: Array of GraphQL thread node IDs from `pr_discussions_raw.json` for threads fully fixed in this rework. Empty `[]` on first review.
- **inlineComments**: Array of inline code review comments. Each entry:
  - **file**: Relative path to file from repo root
  - **line**: Line number to comment on (must be inside a diff hunk in `pr_diff.txt`)
  - **startLine**: (Optional) Start line for multi-line range
  - **side**: "RIGHT" for new code (default), "LEFT" for old code
  - **commentContent**: Full comment text as GitHub markdown string
  - **severity**: BLOCKING, IMPORTANT, or SUGGESTION
- **issueCounts**: Counts matching actual findings by severity
- **responseMdContent**: Full Jira-formatted review summary as a string. Use Jira Wiki syntax (`h1.`, `h2.`, `*bold*`, `{{code}}`, `{code:lang}`, `----`). This becomes the Jira ticket comment.

### ⚠️ CRITICAL: Use `recommendation`, NOT `verdict`

The field MUST be named **`recommendation`** (not `verdict`, not `decision`, not `result`).

❌ Wrong: `"verdict": "APPROVED"`
✅ Correct: `"recommendation": "APPROVE"`

### Inline Comments Policy

**If APPROVE**: `inlineComments` must be empty. No suggestions in general comment either.

**If REQUEST_CHANGES or BLOCK**: Only BLOCKING and IMPORTANT inline comments. No SUGGESTION-level inline comments.

**Diff-only rule**: Inline comments ONLY on lines inside a diff hunk in `pr_diff.txt`. General findings go in `generalCommentContent`.
