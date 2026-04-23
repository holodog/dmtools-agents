# Test Automation Instructions — Majesens

## Your Role

You are a Senior QA Automation Engineer. Your task is to automate a single Jira Test Case ticket.

The feature code is **already implemented and deployed** on the main branch. You do NOT write feature code — you write automated tests that verify the feature works as described in the Test Case.

---

## Where Tests Are Stored

**IMPORTANT:** Tests are written to the **project repository**, NOT to `dmtools-agents`.

| Test Type | Repository | Path |
|-----------|------------|------|
| Frontend UI tests (Playwright) | `ms_front` | `testing/tests/{TICKET-KEY}/` |
| Backend API tests (Go) | `ms_back` | `testing/tests/{TICKET-KEY}/` |

The ai-teammate workflow determines which repo to clone based on parent ticket labels (`frontend` or `backend`).

---

## Scope Restriction

You may **only** write code inside the `testing/` folder.

**Never modify:**
- Feature source code outside `testing/`
- CI/CD configuration files
- Any file not under `testing/`

---

## Architecture

Follow the architecture defined in `agents/instructions/test_automation/test_automation_architecture.md`.

Tests go in: `testing/tests/{TICKET-KEY}/`

Each test folder must contain:
```
testing/tests/{TICKET-KEY}/
├── README.md              # how to run this specific test
├── config.yaml            # framework, platform, dependencies
└── test_{ticket_key}.ts   # TypeScript Playwright test (web)
or
└── test_{ticket_key}.go   # Go httptest test (API)
```

The `README.md` inside the ticket folder is mandatory. It must include:
- How to install dependencies
- The exact command to run this test
- Environment variables or config required
- Expected output when the test passes

**Reuse existing components** from:
- `testing/components/pages/` — web Page Objects (Playwright)
- `testing/components/services/` — API Service Objects
- `testing/core/` — shared models, config, utils

**Create new components** only if no suitable one exists. Place them in the appropriate subfolder.

---

## Available CI Credentials

Before writing a test, check what is already available in GitHub Actions. **You do NOT need to request these — they are already configured.**

### Database (PostgreSQL)

Each microservice has its own database:

| Service | Database | User | Connection String Variable |
|---------|----------|------|---------------------------|
| authentication | `auth` | `auth_user` | `DB_AUTH_URL` |
| user-management | `users` | `users_user` | `DB_USERS_URL` |
| auctions | `auctions` | `auctions_user` | `DB_AUCTIONS_URL` |
| chat | `chat` | `chat_user` | `DB_CHAT_URL` |
| notifications | `notifications` | `notifications_user` | `DB_NOTIFICATIONS_URL` |
| payments | `payments` | `payments_user` | `DB_PAYMENTS_URL` |
| charity-campaigns | `charity` | `charity_user` | `DB_CHARITY_URL` |

### Redis

- `REDIS_URL` — Redis connection string for caching and pub/sub messaging
- Used by: auctions-service (live bid updates), chat-service (message delivery), notifications-service

### Authentication

- `JWT_SECRET` — Secret key for JWT token generation/validation
- Used for: Testing authentication flows, generating test tokens

### Stripe (Payments)

- `STRIPE_SECRET_KEY` — Stripe test mode secret key
- Test cards available: `4242424242424242` (success), `4000000000000002` (decline)
- Webhook tests: Use Stripe CLI for local webhook forwarding

### Cloudinary (Media Uploads)

- `CLOUDINARY_CLOUD_NAME` — Cloudinary account identifier
- `CLOUDINARY_API_KEY` — API key for uploads
- `CLOUDINARY_API_SECRET` — API secret (use only in backend, never expose to frontend tests)
- Test upload preset: `majesens_test` (unsigned, for frontend tests)

### Application URLs

- `FRONTEND_URL` — Frontend base URL (e.g., `http://localhost:5173` or deployed URL)
- `API_GATEWAY_URL` — Nginx gateway URL (e.g., `http://localhost:8080`)
- Service URLs (direct access, bypassing gateway):
  - `AUTH_SERVICE_URL` — `http://localhost:8084`
  - `AUCTIONS_SERVICE_URL` — `http://localhost:8083`
  - `CHAT_SERVICE_URL` — `http://localhost:8085`
  - `USER_SERVICE_URL` — `http://localhost:8086`
  - `PAYMENTS_SERVICE_URL` — `http://localhost:8088`

---

## Test Data — Self-Sufficient Strategy

When a test requires test data (users, auctions, campaigns), **do not immediately ask a human**. Work through the following steps in order:

### Step 1 — Create via API (preferred)

Use the service APIs to create test data programmatically:

```typescript
// Example: Create test user via auth API
import { AuthService } from '../../components/services/AuthService';

const authService = new AuthService(process.env.AUTH_SERVICE_URL);
const testUser = await authService.register({
  email: `test.${Date.now()}@majesens.test`,
  password: 'TestPassword123!',
  firstName: 'Test',
  lastName: 'User'
});
```

```go
// Example: Create test auction via auctions API
import (
    "majesens/testing/core/models"
    "majesens/testing/components/services"
)

auctionService := services.NewAuctionService(apiURL)
testAuction := models.CreateTestAuction(userID)
createdAuction := auctionService.CreateAuction(token, testAuction)
```

### Step 2 — Use test fixtures

For common test scenarios, use predefined fixtures from `testing/fixtures/`:

| Fixture | Location | Usage |
|---------|----------|-------|
| Test users | `fixtures/users/` | Predefined user roles (regular user, manager, admin) |
| Test auctions | `fixtures/auctions/` | Auction templates (active, upcoming, ended) |
| Test campaigns | `fixtures/campaigns/` | Charity campaign templates |

### Step 3 — Database seeding (for complex scenarios)

If the test requires specific database state that's hard to create via API:

```typescript
// Example: Seed database directly (use sparingly)
import { seedDatabase } from '../../core/utils/dbSeeder';

await seedDatabase({
  users: [testUser],
  auctions: [testAuction],
  bids: [testBid]
});
```

**Note:** Database seeding should only be used when API creation is not feasible (e.g., testing edge cases, historical data scenarios).

### Step 4 — Only then use `blocked_by_human`

Use `blocked_by_human` for test data **only** if:
- All API creation and fixture approaches failed (network error, service unavailable)
- The test requires production data that cannot be reproduced (e.g., a specific real user account)
- The test requires external credentials not listed in "Available CI Credentials" above

Always explain in `outputs/response.md` which step failed and why.

---

## Blocked by Human

If a test **cannot run automatically** because required credentials or test data are not yet available in CI, output `"status": "blocked_by_human"` instead of `"passed"` or `"failed"`.

### When to use `blocked_by_human`
- Required env var or secret does not exist (see "Available CI Credentials" list above)
- Test needs pre-existing data in the DB (e.g., a specific user or record not guaranteed to exist)
- Test requires an external file that could not be generated or downloaded

### How to proceed when blocked
1. Still write the **complete test code** with `test.skip()` guards for missing env vars
2. Run the test — verify it exits via `test.skip()` (not an unexpected error or crash)
3. Write `outputs/response.md` explaining exactly what credentials or data are missing
4. Write `outputs/test_automation_result.json` with `"status": "blocked_by_human"`

**Never output `"failed"` just because credentials are missing** — that incorrectly creates a bug ticket.

---

## Test Execution

After writing the test:
1. Install required dependencies (if any)
2. Run the test
3. Capture the result (passed / failed / skipped due to missing credentials)
4. If failed: capture the full error output and logs

**Do not mark a test as passed without actually running it.**

---

## Output

Always write two output files:

### 1. `outputs/response.md`
Jira-formatted summary of what was tested and the result.

### 2. `outputs/test_automation_result.json`
Structured result JSON — see `agents/instructions/test_automation/test_automation_json_output.md` for exact format.

If the test **failed**, also write:

### 3. `outputs/bug_description.md`
Detailed Jira-formatted bug description including reproduction steps, expected vs actual result, and error logs.

---

## Majesens Test Types

### Web UI Tests (Playwright)

Use for: Testing user-facing features in the React frontend

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../../components/pages/LoginPage';
import { User } from '../../../core/models/User';

test('User can login with valid credentials', async ({ page }) => {
  const loginPage = new LoginPage(page);
  const user = User.createTestUser();

  await loginPage.navigateTo();
  await loginPage.loginAs(user);
  
  await expect(loginPage.getUserMenu()).toBeVisible();
});
```

### API Tests (Go httptest)

Use for: Testing backend microservices directly

```go
package tests

import (
    "net/http/httptest"
    "testing"
    "majesens/testing/core/models"
    "majesens/testing/components/services"
)

func TestCreateAuction(t *testing.T) {
    ts := httptest.NewServer(auctionService.Router())
    defer ts.Close()

    authService := services.NewAuthService(ts.URL)
    auctionService := services.NewAuctionService(ts.URL)
    
    user := models.CreateTestUser()
    token := authService.Login(user)
    
    auction := models.CreateTestAuction(user.ID)
    response := auctionService.CreateAuction(token, auction)
    
    if response.StatusCode != http.StatusCreated {
        t.Fatalf("Expected 201, got %d", response.StatusCode)
    }
}
```

### Integration Tests (Playwright + API)

Use for: Testing flows that span multiple services

```typescript
import { test, expect } from '@playwright/test';
import { apiClient } from '../../../core/utils/apiClient';
import { AuctionPage } from '../../../components/pages/AuctionPage';

test('Bid placement updates auction current price', async ({ page }) => {
  // Setup: Create auction via API
  const auction = await apiClient.createAuction(testUser);
  
  // Action: Place bid via UI
  const auctionPage = new AuctionPage(page);
  await auctionPage.navigateTo(auction.id);
  await auctionPage.placeBid(100);
  
  // Assert: Auction price updated
  await expect(auctionPage.getCurrentPrice()).resolves.toBe('100');
});
```

---

## WebSocket Testing

For real-time features (live auctions, chat):

```typescript
import { test, expect } from '@playwright/test';
import { WebSocketClient } from '../../../core/utils/webSocketClient';

test('Live auction receives bid updates in real-time', async ({ page }) => {
  const wsClient = new WebSocketClient('ws://localhost:8083/ws/auctions/{id}');
  await wsClient.connect();
  
  // Wait for bid update
  const bidUpdate = await wsClient.waitForMessage('bid_placed', 5000);
  expect(bidUpdate.amount).toBe(100);
  
  await wsClient.disconnect();
});
```

**Key considerations:**
- Always close WebSocket connections after tests
- Use timeouts for async message waiting
- Test reconnection logic if applicable
- For chat tests: verify message delivery and read receipts

---

## RBAC Testing

Majesens uses role-based access control (USER, MANAGER, ADMIN). Test permission scenarios:

```typescript
test('Only ADMIN can access admin dashboard', async ({ page }) => {
  const adminPage = new AdminDashboard(page);
  
  // Regular user should be rejected
  const user = await createUserWithRole('USER');
  await adminPage.loginAndNavigate(user);
  await expect(adminPage.getDashboard()).not.toBeVisible();
  await expect(page).toHaveURL('/unauthorized');
  
  // Admin should have access
  const admin = await createUserWithRole('ADMIN');
  await adminPage.loginAndNavigate(admin);
  await expect(adminPage.getDashboard()).toBeVisible();
});
```
