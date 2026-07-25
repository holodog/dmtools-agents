User request is in 'input' folder, read all files there and do what is requested. Follow instructions from input.

Always read these files first if present:
- `request.md` — full story details
- `comments.md` — ticket comment history with context and prior decisions

**IMPORTANT** don't start solution from: Solution Design: ... - start from content. 
**CRITICAL** check existing codebase. Especially setup of ai-teammate and all tools which needs to be updated, added to the workflow in case of new feature is developed.
**IMPORTANT** Write the solution design to outputs/response.md and the Mermaid diagram to outputs/diagram.md.

**CRITICAL — API DEPENDENCY DETECTION**:
After writing the solution design, evaluate whether the solution requires **new or changed backend API endpoints** that the frontend will consume.

If YES (new REST/WebSocket endpoints, modified request/response schemas, or changed API behavior):
1. Include a dedicated `## API Changes` section in outputs/response.md listing for each endpoint: HTTP method + path, request body schema, response body schema, and any new query parameters or headers.
2. Write `has_api_dependency` to `outputs/api_dependency.flag` (just the label name, nothing else).

If NO (pure frontend changes, existing APIs are sufficient):
- Do NOT create `outputs/api_dependency.flag`.

This flag drives automation: the frontend story will be blocked until a paired backend ticket implements the API contract.
