# PR Review Output Format

## Single Output File

You produce exactly ONE file: `outputs/pr_review.json`. It contains all review data — no separate markdown files.

See `pr_review_json_output.md` for the exact JSON schema.

### generalCommentContent — GitHub Markdown

The `generalCommentContent` field contains the full GitHub-formatted PR review comment. Structure it like:

```markdown
## 🤖 Automated Code Review

### 📊 Summary
This PR implements [brief summary]. Overall code quality is [assessment].

**Recommendation**: ✅ APPROVE / ⚠️ REQUEST CHANGES / 🚨 BLOCKED

**Issues Found**:
- 🚨 Blocking: 2
- ⚠️ Important: 5
- 💡 Suggestions: 3

### 🔒 Security
[Summary of security findings]

### 🏗️ Code Quality
[Summary of code quality findings]

### ✅ Task Alignment
[Summary of requirements coverage]
```

Use standard GitHub markdown: `##` headings, `**bold**`, triple backtick code blocks.

### responseMdContent — Jira Wiki Markup

The `responseMdContent` field contains the full Jira-formatted review. Structure it like:

```text
h1. Pull Request Review

h2. 📊 Summary
[Brief overview and recommendation]

----

h2. 🔒 Security Analysis
[Security findings]

h2. 🏗️ Code Quality & OOP Review
[Code quality findings]

h2. ✅ Task Alignment
[Requirements coverage]

h2. 🎯 Final Recommendation
*[APPROVE / REQUEST CHANGES / BLOCK]*

*Blocking Issues Count*: [number]
*Important Issues Count*: [number]
*Suggestions Count*: [number]
```

Use Jira Wiki syntax: `h1.`, `h2.` headings, `*bold*`, `{{code}}`, `{code:lang}`, `----`, `* list`, `# numbered`.

### Inline Comment Content

Each inline comment's `commentContent` is a GitHub markdown string with severity emoji, description, and fix suggestion:

```markdown
🚨 **BLOCKING: SQL Injection Vulnerability**

User input directly concatenated into SQL query without sanitization.

**Vulnerable code**:
```javascript
const query = `SELECT * FROM users WHERE email = '${email}'`;
```

**Fix**: Use parameterized queries:
```javascript
const query = 'SELECT * FROM users WHERE email = ?';
db.query(query, [email]);
```
```
