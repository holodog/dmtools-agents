# Test Automation Instructions — Majesens

## Your Role

You are a Senior QA Automation Engineer. Your task is to automate a single Jira Test Case ticket.

The feature code is **already implemented and deployed** on the main branch. You do NOT write feature code — you write automated tests that verify the feature works as described in the Test Case.

---

## Where Tests Are Stored

**IMPORTANT:** Tests are written to the **project repository**, NOT to `dmtools-agents`.

| Test Type | Repository | Path |
|-----------|------------|------|
| Frontend E2E tests (Playwright) | `ms_front` | `e2e/tests/*.spec.ts` |
| Backend API tests (Go) | `ms_back` | `services/<service>/e2e/<feature>_e2e_test.go` |

The ai-teammate workflow determines which repo to clone based on parent ticket labels (`frontend` or `backend`).

---

## Scope Restriction

You may **only** write code in these locations:

- **Frontend E2E tests**: `e2e/tests/` (Playwright `.spec.ts` files), `e2e/fixtures/` (mock data), `e2e/helpers/` (shared utilities)
- **Backend Go e2e tests**: `services/<service-name>/e2e/<feature>_e2e_test.go` — alongside existing e2e tests (see `e2e/rbac_authorization_test.go` for the pattern)

**Never modify:**
- Feature source code outside `e2e/` and `services/*/e2e/`
- CI/CD configuration files
- Any file not in the allowed locations above

---

## Architecture

### Frontend E2E Tests (ms_front)

Tests go in `e2e/tests/` with `.spec.ts` extension. Use Playwright with `page.route()` for API mocking.

```
e2e/
├── playwright.config.ts        # Playwright configuration
├── fixtures/                   # Mock data factories
│   ├── mockTransactions.ts     # Transaction test data
│   ├── mockAuctions.ts         # Auction test data
│   └── index.ts                # Barrel export
├── helpers/                    # Shared test utilities
│   ├── auth.ts                 # Token injection (setUserRole, setDevAdminBypass)
│   └── api-mocks.ts            # page.route() mock factory (mockApiRoutes)
└── tests/                      # Actual E2E test files
    ├── home.spec.ts            # Home page tests
    ├── transactions.spec.ts    # Transaction page tests
    └── ...                     # Feature-specific test files
```

**Write tests directly** — import helpers from `../helpers/` and fixtures from `../fixtures/`.
**Create new fixtures/helpers** only if no suitable one exists.
**Reuse existing fixtures/helpers** — always check `e2e/fixtures/` and `e2e/helpers/` first.

### Backend Go E2E Tests (ms_back)

Tests go in `services/<service>/e2e/<feature>_e2e_test.go`.

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

If a test **cannot run automatically** because required credentials or test data are not yet available in CI, output `"status": "blocked_by_human"` instead of `"passed"` or `"failed"`.

---

## Output

Always write output files:

### 1. `outputs/response.md`
Jira-formatted summary of what was tested and the result.

### 2. `outputs/pr_body.md`
GitHub PR body markdown — short description of what was automated.

---

## Majesens Test Types

### Web UI Tests (Playwright)

Use for: Testing user-facing features in the React frontend

Tests go in `e2e/tests/` with `.spec.ts` extension. Use the flat pattern:

```typescript
import { test, expect } from '@playwright/test';
import { setDevAdminBypass, setUserRole } from '../helpers/auth';
import { mockApiRoutes } from '../helpers/api-mocks';
import { mockTransactions } from '../fixtures/mockTransactions';

test('MAJESENS-XX: Feature description', async ({ page }) => {
  // 1. Set up auth if needed (BEFORE page.goto())
  await setUserRole(page, 'user');
  // or for admin routes: await setDevAdminBypass(page);

  // 2. Set up API mocks (BEFORE page.goto())
  mockApiRoutes(page)
    .withTransactions({ data: mockTransactions, pagination: { page: 1, limit: 10, total: 3, pages: 1 } });

  // 3. Navigate to the page
  await page.goto('/account/transactions');

  // 4. Assert UI state
  await expect(page.getByRole('heading', { name: 'Transaction History' })).toBeVisible();
});
```

**Key patterns:**
- Call `setUserRole()` or `setDevAdminBypass()` **before** `page.goto()` — they use `page.addInitScript()`
- Call `mockApiRoutes()` **before** `page.goto()` — they use `page.route()`
- Use `expect(locator).toBeVisible()` — Playwright auto-waits
- Tests use `page.route()` for mocking, NOT a real backend

**Do NOT use:**
- Complex Page Object patterns with constructor injection
- Database seeding or real API calls in CI
- `time.sleep()` or arbitrary waits
- Import from `testing/` directory (it does not exist)
- Import from `components/pages/` (no Page Object layer)

### API Tests (Go httptest)

Use for: Testing backend microservices directly

```go
// Example: Real httptest-based e2e test for a Go handler
package e2e

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend_two/services/user-management-service/internal/handlers"
	"backend_two/services/user-management-service/internal/models"
	"backend_two/services/user-management-service/internal/services"
)

// MockFollowRepository is a mock implementation for testing
type MockFollowRepository struct { /* ... */ }

// FollowUser test — success scenario
func TestMAJESENS_241_FollowUserViaProfile(t *testing.T) {
	// 1. Create mock repository
	mockRepo := &MockFollowRepository{
		CreateFollowFunc: func(followerID, followingID string) (*models.Follow, error) {
			return &models.Follow{FollowerID: followerID, FollowingID: followingID, CreatedAt: time.Now()}, nil
		},
	}
	// 2. Create service and handler
	followService := services.NewFollowService(mockRepo)
	handler := handlers.NewFollowHandler(followService)

	// 3. Test follow request
	req := httptest.NewRequest(http.MethodPost, "/api/user-management/users/target-uuid/follow", nil)
	req.Header.Set("X-User-ID", "user-uuid")
	w := httptest.Recorder()
	handler.FollowUser(w, req)

	// 4. Assert HTTP status
	if w.Code != http.StatusCreated {
		t.Fatalf("Expected 201, got %d", w.Code)
	}

	// 5. Assert response body
	var resp models.FollowResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.IsFollowing {
		t.Error("Expected isFollowing=true")
	}
}
```

**CRITICAL rules for Go e2e tests:**
1. **Write a REAL test** — the test function must contain actual assertions (e.g., `if w.Code != http.StatusCreated { t.Fatalf(...) }`)
2. **Do NOT create empty wrapper files** that only import a non-existent package
3. **Do NOT import packages that don't exist** — check that the handler/service/repository packages you import are real
4. **Place the test file** at `services/<service-name>/e2e/<feature>_e2e_test.go`
5. **Create the e2e subdirectory** if it doesn't exist yet: `mkdir -p services/<service-name>/e2e/`

### Integration Tests (Playwright + API)

Use for: Testing flows that span multiple services

```typescript
import { test, expect } from '@playwright/test';
import { setDevAdminBypass } from '../helpers/auth';
import { mockApiRoutes } from '../helpers/api-mocks';

test('Bid placement updates auction current price', async ({ page }) => {
  await setDevAdminBypass(page);
  mockApiRoutes(page)
    .withAuctions({ data: [mockAuction], pagination: { total: 1 } })
    .withAuctionDetail(auctionId, mockAuction);

  await page.goto('/auctions/' + auctionId);
  await page.getByRole('button', { name: 'Place Bid' }).click();

  // Verify price updated
  await expect(page.getByText('$100')).toBeVisible();
});
```

---

## WebSocket Testing

For real-time features (live auctions, chat):

```typescript
import { test, expect } from '@playwright/test';

test('Live auction receives bid updates in real-time', async ({ page }) => {
  // Mock the WebSocket connection
  await page.routeWebSocket(({ page, url }) => {
    page.on('console', msg => console.log(msg.text()));
  });

  // Or mock the WS transport at the network level
  page.route('**/ws/auctions/*', async (route) => {
    // Handle WebSocket upgrade
  });
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
import { test, expect } from '@playwright/test';
import { setDevAdminBypass, setUserRole } from '../helpers/auth';

test('Only ADMIN can access admin dashboard', async ({ page }) => {
  // Regular user should be redirected to login
  await setUserRole(page, 'user');
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: /login/i })).toBeVisible();

  // Admin should have access
  await setDevAdminBypass(page);
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: /admin dashboard/i })).toBeVisible();
});
```
