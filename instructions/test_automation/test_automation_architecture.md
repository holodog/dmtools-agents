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

ms_front/testing/             # Frontend UI tests (Playwright/TypeScript)
├── core/
├── components/
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

### Frontend Test Structure (ms_front/testing/)

```
testing/
│
├── core/                           # Shared across ALL test types
│   ├── models/                     # Domain models (User, Auction, Bid...)
│   ├── config/                     # Environment configs, credentials
│   ├── interfaces/                 # Abstract contracts (protocols)
│   ├── utils/                      # Helpers, data generators, logging
│
├── frameworks/                     # Framework-specific implementations
│   └── web/                        # Web UI Testing
│       └── playwright/             # Playwright for React frontend
│
├── components/                     # Reusable test components
│   └── pages/                      # Page Objects (Web - Playwright)
│       ├── login_page
│       ├── registration_page
│       ├── home_page
│       ├── auction_detail_page
│       ├── auction_create_page
│       ├── chat_page
│       └── admin_dashboard
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

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  TESTS                                       │
│                                                                              │
│    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐            │
│    │  MAJESENS-1  │      │  MAJESENS-2  │      │  MAJESENS-3  │            │
│    │   ─────────  │      │   ─────────  │      │   ─────────  │            │
│    │  TEST-1 (web)│      │ TEST-4 (api) │      │TEST-7 (web)  │            │
│    │  TEST-2 (api)│      │ TEST-5 (web) │      │ TEST-8 (api) │            │
│    └──────┬───────┘      └──────┬───────┘      └──────┬───────┘            │
│           │                     │                     │                     │
└───────────┼─────────────────────┼─────────────────────┼─────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              COMPONENTS                                      │
│                        (Reusable Test Objects)                              │
│                                                                              │
│   ┌─────────────────┐                  ┌─────────────────┐                 │
│   │     PAGES       │                  │    SERVICES     │                 │
│   │   (Web UI)      │                  │     (API)       │                 │
│   │                 │                  │                 │                 │
│   │  • LoginPage    │                  │ • AuthService   │                 │
│   │  • HomePage     │                  │ • AuctionService│                 │
│   │  • AuctionPage  │                  │ • UserService   │                 │
│   │  • ChatPage     │                  │ • ChatService   │                 │
│   │  • AdminPage    │                  │ • PaymentService│                 │
│   └────────┬────────┘                  └────────┬────────┘                 │
│            │                                    │                          │
└────────────┼────────────────────────────────────┼──────────────────────────┘
             │                                    │
             ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             FRAMEWORKS                                       │
│                    (Technology Implementations)                              │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────┐      │
│  │         WEB                    │         API                       │      │
│  │                                                                       │      │
│  │  ┌─────────────┐              │  ┌─────────────┐                   │      │
│  │  │ Playwright  │              │  │  Go httptest│                   │      │
│  │  │  (TypeScript)│             │  │  (net/http) │                   │      │
│  │  └─────────────┘              │  └─────────────┘                   │      │
│  │  ┌─────────────┐              │  ┌─────────────┐                   │      │
│  │  │   Vitest    │              │  │  REST client│                   │      │
│  │  │  (unit)     │              │  │  (integration)                  │      │
│  │  └─────────────┘              │  └─────────────┘                   │      │
│  └───────────────────────────────────────────────────────────────────┘      │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               CORE                                           │
│                    (Framework-Agnostic Foundation)                          │
│                                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   MODELS   │  │  CONFIGS   │  │ INTERFACES │  │   UTILS    │            │
│  │            │  │            │  │            │  │            │            │
│  │ • User     │  │ • Env URLs │  │ • IPage    │  │ • Logger   │            │
│  │ • Auction  │  │ • Creds    │  │ • IService │  │ • DataGen  │            │
│  │ • Bid      │  │ • Timeouts │  │ • IClient  │  │ • Waiters  │            │
│  │ • ChatMsg  │  │ • DB config│  │            │  │ • Asserts  │            │
│  │ • Payment  │  │            │  │            │  │            │            │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER           │  RESPONSIBILITY                              │
├─────────────────────────────────────────────────────────────────┤
│                  │                                              │
│  TESTS           │  • Test logic per ticket/story              │
│                  │  • Uses components, not frameworks directly │
│                  │  • Contains test config (which framework)   │
│                  │  • Located: testing/tests/{TICKET-KEY}/     │
│                  │                                              │
├─────────────────────────────────────────────────────────────────┤
│                  │                                              │
│  COMPONENTS      │  • Reusable Page/Service objects            │
│                  │  • Business-level abstractions              │
│                  │  • Framework-agnostic interfaces            │
│                  │  • Pages: testing/components/pages/         │
│                  │  • Services: testing/components/services/   │
│                  │                                              │
├─────────────────────────────────────────────────────────────────┤
│                  │                                              │
│  FRAMEWORKS      │  • Concrete implementations                 │
│                  │  • Playwright (web), Go httptest (API)      │
│                  │  • Wraps vendor libraries                   │
│                  │                                              │
├─────────────────────────────────────────────────────────────────┤
│                  │                                              │
│  CORE            │  • Shared models & configs                  │
│                  │  • Abstract interfaces/protocols            │
│                  │  • Utilities & reporting                    │
│                  │  • Models: testing/core/models/             │
│                  │  • Config: testing/core/config/             │
│                  │                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Test Configuration Per Ticket

```
tests/MAJESENS-XX/
├── README.md              # how to run this specific test
├── config.yaml            # framework, platform, dependencies
└── test_{ticket_key}.ts   # TypeScript Playwright test
or
└── test_{ticket_key}.go   # Go httptest test

Example config.yaml:
─────────────────────
test_id: MAJESENS-XX
type: web | api
framework: playwright | go-httptest
dependencies: []
```

## Majesens Domain Models

### Core Entities

| Model | Description | Key Fields |
|-------|-------------|------------|
| `User` | Platform user | id, email, firstName, lastName, role (USER/MANAGER/ADMIN), avatarUrl, emailVerified |
| `Auction` | Auction listing | id, sellerId, title, description, category, startTime, endTime, minIncrement, reservePrice, currentPrice, status, imageUrls |
| `Bid` | Auction bid | id, auctionId, bidderId, amount, maxAmount (auto-bid), isAuto, status, bidTime |
| `ChatMessage` | Chat message | id, chatId, senderId, content, timestamp, isRead |
| `Payment` | Payment transaction | id, userId, amount, currency, status, stripePaymentIntentId, createdAt |
| `CharityCampaign` | Charity campaign | id, title, description, goalAmount, currentAmount, endDate, status, beneficiary |

### Majesens Services

| Service | Port | Purpose | API Base Path |
|---------|------|---------|---------------|
| authentication-service | 8084 | User auth, registration, OAuth | `/authentication` |
| user-management-service | 8086 | User profiles, Cloudinary | `/user-management` |
| auctions-service | 8083 | Real-time auctions, bids | `/auctions` |
| chat-service | 8085 | Real-time chat (WebSocket) | `/chat` |
| payments-service | 8088 | Stripe integration | `/payments` |
| notifications-service | 8087 | Email, push, SMS | `/notifications` |
| charity-campaigns-service | 8089 | Charity campaigns | `/charity-campaigns` |

## Key Principles

| Principle | Description |
|-----------|-------------|
| **Separation** | Tests don't know about frameworks, only components |
| **Abstraction** | Components use interfaces, not concrete implementations |
| **Flexibility** | Easy to swap frameworks without changing tests |
| **Reusability** | Same business logic, different test scenarios |
| **Isolation** | Each test ticket has its own config and dependencies |

## OOP & Modern Practices

**Apply OOP throughout all test code:**
- **Single Responsibility** — each Page/Service object handles one domain area only
- **Dependency Injection** — pass drivers, clients, and config via constructor; never instantiate them inside components
- **Interfaces first** — all components implement contracts defined in `core/interfaces/`; tests depend on interfaces, not concrete classes
- **Encapsulation** — expose only high-level actions (e.g. `loginPage.loginAs(user)`), never raw selectors or HTTP internals

**Use modern, idiomatic frameworks:**
- **Web**: Playwright with async/await, built-in waits, and native matchers
- **API**: Go httptest with typed models — no raw `http.Get(url)` calls inline in tests
- **Assertions**: Use framework-native matchers (e.g. `expect(locator).toBeVisible()`) — not manual boolean checks

**Test code quality:**
- No hardcoded URLs, credentials, or environment values — use `core/config/`
- No logic duplication — extract shared flows into components
- Tests must be deterministic: no `time.sleep()`, use explicit waits instead
- For WebSocket tests (chat, live auctions): use proper connection handling and message subscription patterns

## Majesens-Specific Test Patterns

### Web UI Tests (Playwright + TypeScript)

```typescript
// Example structure for MAJESENS-XX test
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../../components/pages/LoginPage';
import { HomePage } from '../../../components/pages/HomePage';
import { User } from '../../../core/models/User';

test('MAJESENS-XX: User can login successfully', async ({ page }) => {
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);
  const testUser = User.createTestUser();

  await loginPage.navigateTo();
  await loginPage.loginAs(testUser);
  
  await expect(homePage.getUserMenu()).toBeVisible();
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
| **Test Users** | PostgreSQL `users` table (auth DB) | Created via registration API or seeded fixtures |
| **Test Auctions** | PostgreSQL `auctions` table | Use factory pattern with valid default values |
| **Test Bids** | PostgreSQL `bids` table | Always link to valid auction and user |
| **Test Messages** | Generated per-test | No persistence needed for chat tests |
| **Test Payments** | Stripe test mode | Use Stripe test cards, never real cards |
| **Test Images** | Cloudinary test folder | Use test upload preset |

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
