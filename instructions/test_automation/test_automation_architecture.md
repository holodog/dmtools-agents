# Test Automation Architecture — Majesens

## High-Level Structure

Tests are stored in the **project repository** (`ms_front` or `ms_back`), NOT in the `dmtools-agents` submodule.

The `dmtools-agents` repo contains:
- Agent configuration JSON files
- Instruction markdown files (this folder)
- JavaScript pre/post-action scripts
- Prompts for CLI agents

The **generated tests** go in:
```
ms_back/testing/              # Backend API tests (Go)
├── core/
├── components/
└── tests/

ms_front/e2e/                 # Frontend E2E tests (Playwright)
├── fixtures/
├── helpers/
└── tests/
```

### Backend Test Structure (ms_back/testing/)

```
testing/
│
├── core/                           # Shared across ALL test types
│   ├── models/                     # Domain models (User, Auction, Bid, ChatMessage...)
│   ├── config/                     # Environment configs, credentials
│   ├── interfaces/                 # Abstract contracts (protocols)
│   ├── utils/                      # Helpers, data generators, logging
│
├── frameworks/                     # Framework-specific implementations
│   └── api/                        # API Testing
│       └── go/                     # Go httptest + REST clients
│
├── components/                     # Reusable test components
│   └── services/                   # API Service Objects
│       ├── auth_service
│       ├── auction_service
│       ├── user_service
│       ├── chat_service
│       ├── payment_service
│       └── charity_campaign_service
│
├── tests/                          # Actual test cases by ticket/story
│   ├── MAJESENS-1/
│   ├── MAJESENS-2/
│   └── MAJESENS-3/
│
└── fixtures/                       # Shared test fixtures & data
    ├── users/
    ├── auctions/
    └── campaigns/
```

### Frontend Test Structure (ms_front/e2e/)

```
e2e/
├── playwright.config.ts        # Playwright configuration
├── fixtures/                   # Mock data factories
│   ├── mockTransactions.ts     # Transaction test data
│   ├── mockAuctions.ts         # Auction test data
│   └── index.ts                # Barrel export
├── helpers/                    # Shared test utilities
│   ├── auth.ts                 # Token injection helpers
│   └── api-mocks.ts            # page.route() mock factory
└── tests/                      # Actual E2E test files
    ├── home.spec.ts            # Home page tests
    ├── transactions.spec.ts    # Transaction page tests
    └── ...                     # Feature-specific test files
```

**Key principles for frontend tests:**
- Tests go in `e2e/tests/` with `.spec.ts` extension
- Use `page.route()` for API mocking — no backend needed in CI
- Use `setUserRole(page, role)` or `setDevAdminBypass(page)` from `../helpers/auth.ts` for auth
- Write tests directly — no Page Object layer, no constructor injection
- Keep tests simple and self-contained

## Key Principles

| Principle | Description |
|-----------|-------------|
| **Simplicity** | Frontend tests are flat — no layered abstractions |
| **API Mocking** | All Playwright tests use `page.route()` — no backend needed |
| **Auth Injection** | Use `setUserRole()` or `setDevAdminBypass()` helpers |
| **Reusability** | Share mock data via `e2e/fixtures/` and utilities via `e2e/helpers/` |
| **Isolation** | Each test sets up its own mocks, no shared state between tests |

## OOP & Modern Practices

**Frontend (Playwright) — simple patterns:**
- **Direct usage** — tests call Playwright APIs directly with helper utilities
- **No Page Objects** — no constructor injection, no interfaces, no layered architecture
- **Auto-waiting** — use Playwright's built-in auto-wait (e.g., `expect(locator).toBeVisible()`)
- **API mocking** — use `page.route()` for all API calls

**Backend (Go httptest):**
- **Single Responsibility** — each Service object handles one domain area only
- **Dependency Injection** — pass drivers, clients, and config via constructor
- **Interfaces first** — all components implement contracts defined in `core/interfaces/`
- **Encapsulation** — expose only high-level actions, never raw selectors or HTTP internals

**Use modern, idiomatic frameworks:**
- **Web**: Playwright with async/await, built-in waits, and native matchers
- **API**: Go httptest with typed models — no raw `http.Get(url)` calls inline in tests
- **Assertions**: Use framework-native matchers (e.g. `expect(locator).toBeVisible()`) — not manual boolean checks

**Test code quality:**
- No hardcoded URLs or credentials — use the helpers from `e2e/helpers/` (frontend) or `core/config/` (backend)
- No logic duplication — extract shared flows into `e2e/fixtures/` or `e2e/helpers/` (frontend)
- Tests must be deterministic: no `time.sleep()`, use explicit waits instead
- For WebSocket tests (chat, live auctions): use proper connection handling and message subscription patterns

## Majesens-Specific Test Patterns

### Frontend E2E Tests (Playwright + TypeScript)

```typescript
import { test, expect } from '@playwright/test';
import { setDevAdminBypass, setUserRole } from '../helpers/auth';
import { mockApiRoutes } from '../helpers/api-mocks';
import { mockTransactions } from '../fixtures/mockTransactions';

test('MAJESENS-XX: User can view transactions', async ({ page }) => {
  // 1. Set up auth BEFORE navigation
  await setUserRole(page, 'user');

  // 2. Set up API mocks BEFORE navigation
  mockApiRoutes(page).withTransactions({
    data: mockTransactions,
    pagination: { page: 1, limit: 10, total: 3, pages: 1 },
  });

  // 3. Navigate
  await page.goto('/account/transactions');

  // 4. Assert — Playwright auto-waits
  await expect(page.getByRole('heading', { name: 'Transaction History' })).toBeVisible();
  await expect(page.getByText('Romantic Dinner for Two')).toBeVisible();
});
```

### API Tests (Go httptest)

```go
// Example structure for MAJESENS-XX test
package tests

import (
    "net/http/httptest"
    "testing"
    "majesens/testing/core/models"
    "majesens/testing/components/services"
)

func TestMAJESENS_XX_CreateAuction(t *testing.T) {
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

### Test Data Strategy

For Majesens tests, use the following test data sources:

| Data Type | Source | Notes |
|-----------|--------|-------|
| **Frontend (E2E)** | Mock data in `e2e/fixtures/` | Use `page.route()` — no backend needed |
| **Test Users** | PostgreSQL `users` table (auth DB) | Created via registration API or seeded fixtures (backend) |
| **Test Auctions** | PostgreSQL `auctions` table | Use factory pattern with valid default values (backend) |
| **Test Bids** | PostgreSQL `bids` table | Always link to valid auction and user (backend) |
| **Test Messages** | Generated per-test | No persistence needed for chat tests (backend) |
| **Test Payments** | Stripe test mode | Use Stripe test cards, never real cards (backend) |
| **Test Images** | Cloudinary test folder | Use test upload preset (backend) |

### CI Credentials for Majesens

Tests running in CI have access to:

| Credential | Type | Description |
|------------|------|-------------|
| `DB_AUTH_URL` | Variable | PostgreSQL connection string for auth service |
| `DB_USERS_URL` | Variable | PostgreSQL connection string for user service |
| `DB_AUCTIONS_URL` | Variable | PostgreSQL connection string for auctions service |
| `REDIS_URL` | Variable | Redis connection for caching/pub-sub |
| `JWT_SECRET` | Secret | JWT signing key for auth tests |
| `STRIPE_SECRET_KEY` | Secret | Stripe test mode key |
| `CLOUDINARY_CLOUD_NAME` | Variable | Cloudinary account name |
| `CLOUDINARY_API_KEY` | Variable | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Secret | Cloudinary API secret |
| `FRONTEND_URL` | Variable | Frontend base URL (e.g., `https://localhost:5173`) |
| `API_GATEWAY_URL` | Variable | Nginx gateway URL (e.g., `https://localhost:8080`) |
