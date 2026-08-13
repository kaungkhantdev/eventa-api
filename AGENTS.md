# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, …) working in this
repository — the single source of truth; tool-specific files import it.

## What this is

`eventa-api` — the **backend API** for **Eventa**, a Thai-market (THB/satang, VAT 7%, PromptPay,
Asia/Bangkok, bilingual EN/TH) multi-tenant event registration & management platform. NestJS 11 +
TypeScript.

**The foundation is built** (on branch `feat/api-foundation`): zod-validated config (`src/config`), a
global Drizzle `DatabaseModule` (`src/db`), the `src/common` cross-cutting layer (AsyncLocalStorage
request context, correlation-id middleware, `DomainException` + global error-envelope filter, pino
structured logging), the `/api/v1` global prefix + `ValidationPipe`, Swagger/`openapi.json`, a
`/api/v1/health/{live,ready}` probe pair, and a `docker-compose.yml` for Postgres/Redis/RabbitMQ.
Installed stack: `drizzle-orm`/`pg`, `@nestjs/config`, `@nestjs/swagger`, `class-validator`/`-transformer`,
`zod`, `nestjs-pino`, `@nestjs/passport`+`passport-jwt`, `@node-rs/argon2`, `amqplib`. **Built so far
(E1–E6, plus E7's US-MSG-01 and part of E9):** the **schema & migrations**
(identity/organization/platform, events, ticketing/discounts, registration/payments, messaging, finance —
0001…0036) in `src/db/schema`; the **identity family** (JWT auth with 2FA-enforced
sign-in, signup, password, sessions, social); **workspace** (access/RBAC, organization, settings, audit);
the **event family** (`events` + `event-*`, `public-pages`); **ticketing** (`ticketing`, `ticket-sharing`,
`discounts`); the **attendee surface** (`discover`, `saved-events`, `checkout`, `payments`,
`attendee-tickets`, `attendee-payments`, `account-deletion`); **finance** (the payments ledger + refunds in
`payments`, and `invoices` — issue/age/print/void a Thai tax invoice); and the **outbox relay**
(`src/relay.ts` → `RelayModule`) that publishes `outbox_events` to RabbitMQ (consumed by
`../eventa-worker`). Still to come: the rest of finance (payouts, VAT periods, exports — E9), check-in
(E8), the dashboard (E11), the rest of messaging (E7), … — translate `entities.md` one bounded context at
a time. (US-DISC-13 ratings are deferred until after E8 — recorded in the functional requirements.)

The build plan is **not in this repo** — it lives in the sibling SDLC docs at **`../eventa-docs`**. Read
these before adding anything:
- [`../eventa-docs/05-development/development-guide.md`](../eventa-docs/05-development/development-guide.md) — how to build *this* repo (layout, conventions, the feature playbook). **Primary reference.**
- [`../eventa-docs/04-architecture/software-architecture.md`](../eventa-docs/04-architecture/software-architecture.md) — the SAD (modular monolith, outbox, checkout consistency, ADRs).
- [`../eventa-docs/04-architecture/entities.md`](../eventa-docs/04-architecture/entities.md) + `erd.md` — the data-model **source of truth**: 53 tables as the **target** model, of which **40 are built** here. **This repo owns the DB schema & migrations**, so the committed `pgTable` definitions — not the catalogue — are the inventory of what exists.
- [`../eventa-docs/01-requirements-and-features/functional-requirements.md`](../eventa-docs/01-requirements-and-features/functional-requirements.md) — the product backlog; a `US-*` story's acceptance criteria become your tests ([test cases](../eventa-docs/06-testing/test-cases.md)).

Polyrepo siblings: `../eventa-web` (React front-end, consumes this API's `openapi.json`), `../eventa-worker`
(RabbitMQ consumers of the outbox events), `eventa-infra` (Terraform/Helm/Argo CD).

**Framework docs:** NestJS — https://docs.nestjs.com/ (consult it for module/provider/DI, pipes/guards/
interceptors, and testing patterns rather than guessing).

## Commands

Package manager is **pnpm**.

```bash
pnpm install
pnpm start:dev         # watch dev server (nest start --watch); listens on $PORT or 3000
pnpm build             # nest build → dist/  (nest-cli deleteOutDir wipes dist/ first)
pnpm start:prod        # node dist/main
pnpm lint              # eslint --fix (type-aware; also applies prettier)
pnpm format            # prettier --write
pnpm test              # jest unit tests
pnpm test:e2e          # jest e2e tests (separate config)
pnpm test:cov          # coverage
```

Run a **single test**: `pnpm test -- <path-or-name-pattern>` — e.g. `pnpm test -- env.validation` or
`pnpm test -- -t "renders a DomainException"`. Same pattern for e2e: `pnpm test:e2e -- <pattern>`.

**Local development** (needs Docker + a `.env`, copied from `.env.example`):

```bash
docker compose up -d   # Postgres :5432 · Redis :6379 · RabbitMQ :5672 (+ mgmt :15672)
pnpm dev               # HTTP API in watch mode (http://localhost:3000, prefix /api/v1)
pnpm relay             # outbox relay entrypoint (polls outbox_events → RabbitMQ)
pnpm generate          # drizzle-kit: diff src/db/schema → SQL migration in src/db/migrations
pnpm migrate           # drizzle-kit: apply pending migrations
pnpm seed              # local seed data (stub until domain tables exist)
```

Swagger UI is at `/api/docs`, the spec at `/api/docs/json`; `openapi.json` is also written to the repo
root on boot when `EMIT_OPENAPI=true` (git-ignored — regenerated in CI, consumed by `eventa-web`).

## Test-driven development (must follow)

**TDD is mandatory — no production code without a failing test that required it.** For every change:
write the failing test **first**, then the minimal code to make it pass, then refactor with the suite
green. Drive tests from the `US-*` story's acceptance criteria (they *are* the spec — see
[test cases](../eventa-docs/06-testing/test-cases.md)): **unit-test the rules** (VAT 7%, fees, capacity,
discounts, idempotency, seat holds) and **integration-test the flow** (checkout, webhooks, outbox) against
the docker-compose stack. Keep the suite green before every commit and PR; new behaviour ships with its
test in the same change.

## Config specifics & gotchas

- **Two separate jest configs.** Unit config is inline in `package.json` (`rootDir: src`, matches
  `*.spec.ts`) — put fast tests beside the code. E2e is `test/jest-e2e.json` (`rootDir: .`, matches
  `*.e2e-spec.ts`) — put full-stack flows in `test/`.
- **TypeScript is full `strict`** (`tsconfig.json` → `"strict": true`). eslint's `no-explicit-any` is still
  **off** (so an explicit `any` won't error), but the type-aware `no-unsafe-*` rules do — prefer explicit
  types and avoid `any`/`@ts-ignore`/nested ternaries per the engineering standard.
- **ESLint is type-aware** (`recommendedTypeChecked` + `projectService`), so it needs a valid tsconfig to
  run. `no-floating-promises` and `no-unsafe-argument` are **warnings** — heed them on the async/money
  paths especially. `module: nodenext`, `target: ES2023`.
- Nest DI relies on `emitDecoratorMetadata` / `experimentalDecorators` (already set).
- **The production build is scoped to `src`** (`tsconfig.build.json` sets `rootDir: src` and excludes
  root-level `.ts` like `drizzle.config.ts`) so entrypoints emit as `dist/main.js` and `dist/relay.js`.
  Without that scoping a root-level `.ts` widens `rootDir` and output lands under `dist/src/`.
- Prettier: **single quotes, trailing commas everywhere**.

## Target architecture (governs code you add)

The rules below span the SAD + data model, so they're easy to violate if you only read the code. The
foundation already wires the error envelope, `/api/v1` prefix, tenant/correlation request context, and the
Drizzle client; **the module/tenancy/consistency rules below apply as you build each domain module.** Follow
the development guide when implementing:

- **Modular monolith: one NestJS module = one responsibility (SRP at the folder level).** Modules are
  **flat siblings** under `src/modules/` — never nested sub-features inside another module's folder — and
  each owns exactly one concern. A module may depend on another module's **service interface — never on
  another module's tables or repository**. Per module: `<name>.module.ts` · `<name>.controller.ts` (thin
  HTTP) · `<name>.service.ts` (rules) · `<name>.repository.ts` (data access) · `dto/` (validated
  request/response) · `events/` (event contracts). **File names mirror class names**
  (`event-categories.service.ts` → `EventCategoriesService`). Related modules share a **name prefix** so
  they sort together: `auth`, `auth-signup`, `auth-password` · `events`, `event-categories`,
  `event-program`, `event-seating`, `event-sharing`, `event-monitoring`, `event-duplication`.
  Current modules: `auth` (sign-in, tokens, sessions) · `users` (the user record) · `auth-signup` ·
  `auth-password` · `auth-sessions` · `auth-two-factor` · `auth-social` · `access` (members, roles,
  RBAC) · `organization` · `payment-settings` · `notification-preferences` · `audit` · `events` + the
  `event-*` sub-domains (`event-categories`, `event-program`, `event-seating`, `event-sharing`,
  `event-monitoring`, `event-duplication`, `event-page`, `event-page-content`) · `public-pages` ·
  `ticketing` · `ticket-sharing` · `discounts` (promotions & redemption) · `registration` ·
  `registration-stats` · `discover` (anonymous cross-tenant browse/search) · `saved-events` · `checkout`
  (order placement — the money path) · `payments` (provider seam + webhooks) · `attendee-tickets` ·
  `attendee-payments` · `account-deletion` · `profile-photo` · the finance family (`invoices` — Thai tax
  invoices, issue/age/print/void · `tax-periods` — the monthly VAT ledger and PP30 filing · `payouts` —
  balances, settlement history and recovery) · `platform` (outbox/idempotency/audit/jobs). Tree: `src/db/`,
  `src/modules/<name>/`, `src/common/` (`guards/`, `decorators/`, `interceptors/`, `filters/`, `http/`,
  `util/`, tenancy), plus `src/relay.ts` (the outbox publisher) and a generated `openapi.json`.
- **Cross-cutting code lives in `src/common/`, never in a domain module.** A guard, decorator, pipe or
  helper used by more than one module belongs in `common/guards/`, `common/decorators/`, `common/util/`
  etc. — so a controller never imports from an unrelated domain module just to annotate a route
  (`JwtAuthGuard`, `PermissionsGuard`, `AdminGuard`, `@CurrentAuth`, `@RequirePermissions`, `slugify`).
  A module-local default belongs to the module (e.g. an event's slug fallback is a `const` in
  `events.service.ts`, not a wrapper file that shadows the shared util).
- **Multi-tenancy: scope every query by `organization_id`** *and* Postgres **RLS**
  (`SET LOCAL app.current_org` per transaction) — defence in depth.
- **The consistency split is the core design decision.** Money/inventory (checkout, seat holds, ticket
  issue) → **synchronous, in one DB transaction, idempotent** (accept an idempotency key; row-lock with
  Drizzle `.for('update')` → `SELECT … FOR UPDATE`); **never** behind the queue. Side effects
  (email/SMS, calendar, read-models, search) → write a row to the **`outbox`** in the *same* transaction;
  the relay ships it to RabbitMQ and a consumer (in `eventa-worker`) handles it. **Never dual-write.**
- **Drizzle ORM** (SQL-first). Schema in `src/db/schema` (TS) → `pnpm drizzle-kit generate --name <x>`
  diffs it to **plain-SQL** migrations (reviewed in the PR) → `pnpm drizzle-kit migrate` applies them.
  Non-diffable SQL (RLS **policies**, functions) goes in a `--custom` migration. This repo **owns**
  migrations; keep the schema consistent with `entities.md`/`erd.md`, and **never edit a shipped
  migration** — add a new one (expand/contract for zero-downtime).
- **Money is integer satang** (format only at the edge); time stored **UTC**, displayed Asia/Bangkok;
  user-facing strings are **bilingual EN/TH**.
- **REST under `/api/v1`**, DTO-validated inputs, a standard error envelope (`code`/`message`/`details`),
  authz enforced **server-side** (return `403`, don't just hide UI), structured JSON logs carrying a
  correlation id.
- **Payments are PCI SAQ-A** — never touch card/bank data (Stripe hosted fields + PromptPay). Payment
  **webhooks** land here and must be **signature-verified and idempotent** (dedupe via `webhook_events`);
  the webhook is the source of truth for payment state.
- This same service image is also the **check-in pool** deployment and **ships the outbox relay**
  (`relay.ts`) — keep both entrypoints buildable.

## Engineering standards (house rules — apply to all code you add)

Built for long-term maintainability. **Priority order** (never sacrifice architecture for short-term
speed): **Correctness → Maintainability → Readability → Testability → Performance → DX.** The canonical,
exhaustive version is [development-guide.md → Appendix A](../eventa-docs/05-development/development-guide.md);
this is the enforced summary. (Note: the standard is written stack-adapted — we use **Drizzle**, not
TypeORM/entities.)

**SOLID & responsibilities**
- **Single Responsibility** — one job per class: controller = HTTP; service = orchestration; repository =
  DB (Drizzle); `toXResponse` mapper = DTO conversion; DTO/validator = validation; guard/policy = authz +
  business rules; factory = construction. Never mix.
- **Dependency Inversion** — depend on abstractions (injected services, a repository, provider ports /
  injection tokens), not concretions. *(Current gap: repos are injected as concrete classes — acceptable in
  Nest DI; introduce port interfaces when a second impl or heavy mocking appears.)*
- **Open/Closed** — extend via strategy/polymorphism, not long `if/else`; don't edit working business logic
  when you can extend it.

**Structure & layering**
- **Feature-first, never layer-first** — organize by feature under `src/modules/<name>/`; **never**
  top-level `controllers/`·`services/` folders. One module = one responsibility, flat siblings, prefix-grouped
  — the full layout and rules are in **Creating a module** below; follow it whenever you add one. DB schema
  is centralized in `src/db/schema` (Drizzle; the api owns it).

- **Thin controllers** — validate · authenticate · authorize · call service · return. **No business logic.**
- **Services orchestrate** — no SQL, HTTP calls, email, or storage code inside a service; delegate to
  repositories / provider services.
- **Repository pattern** — all DB access lives in repositories with **descriptive** methods
  (`findValidSession`, `getPermissions`), never Drizzle queries in a service.
- **DTOs at the edge** — never return raw Drizzle row/schema types; map request → domain → response DTO
  (`toMeResponse`). Validate every input with **class-validator** DTOs (never trust the client).

### Creating a module (follow this exactly)

**1. Name it after the one thing it does.** If you need "and" to describe it, it's two modules. Modules are
**flat siblings** under `src/modules/` — never a sub-feature folder nested inside another module. Related
modules share a **prefix** so they sort together and their kinship is obvious:
`auth`, `auth-signup`, `auth-password` · `events`, `event-categories`, `event-program`, `event-seating`,
`event-sharing`, `event-monitoring`, `event-duplication`.

**2. Lay it out like this** — file names mirror the module name, and class names mirror the file names
(`event-categories.service.ts` → `EventCategoriesService`; never `service.ts` or `index.ts` barrels):

```
src/modules/<name>/
├── <name>.module.ts          # wiring only: imports, controllers, providers, exports
├── <name>.controller.ts      # thin HTTP: validate · authorize · call service · return
├── <name>.service.ts         # the rules (orchestration; no SQL, no HTTP, no email)
├── <name>.repository.ts      # all DB access (Drizzle), descriptive method names
├── <name>.mapper.ts          # row → response DTO (`toXResponse`), when non-trivial
├── <name>.types.ts           # internal domain types (never exported as API shapes)
├── dto/                      # class-validator request DTOs + response DTOs
├── events/                   # outbox event contracts this module produces (versioned)
└── ports/                    # abstract classes this module CONSUMES (see 4)
```
A module may hold **extra, descriptively-named** services when they're facets of the same concern
(`event-program/` has `sessions.service.ts` + `speakers.service.ts`; `events/` has `events.service.ts` for
writes and `events-query.service.ts` for reads). That's SRP at the class level inside one boundary — the
alternative (a sibling module) would have to reach into this module's repository, which is forbidden.

**3. Keep it a black box.** A module may depend on another module's **exported service — never on its
repository, its tables, or its internals.** Export the service (and ports) from `<name>.module.ts`; export
the repository only if another module genuinely owns no other route to that data. If a service needs
another module's rows, call that module's service (`EventsService.getEvent(actor, id)`), don't inject its
repository. *(This is not theoretical: `EventMonitoringService` injected `EventsRepository` while nested
inside `events/`, and it became a runtime DI failure the moment it moved out.)*

**4. Invert cross-context reads with a consumer-owned port.** The **consumer** declares an abstract class in
its own `ports/` folder; the **owner** implements it as an adapter and binds it
(`{ provide: EventStatsPort, useClass: RegistrationStatsAdapter }`). So Events reads registration numbers
without importing Registration's tables. Use `forwardRef` **only** for a genuine bidirectional dependency
(auth↔access, auth↔auth-signup, auth↔auth-password, auth↔auth-social, auth↔users, events↔ticketing,
ticketing↔registration) — not to paper over a bad boundary. Ports in play: `TicketAvailabilityPort` ·
`EventStatsPort` · `TicketSalesPort` ·
`TicketEligibilityPort` (Registration asks Ticketing "may this tier be sold right now?") ·
`CheckoutActivityPort` (Ticketing asks Registration "is anyone mid-checkout?") · `EventLookupPort` ·
`EventOrgLookupPort` (Discounts resolves an anonymous checkout's tenant from the event, never the caller) ·
`EventAttendancePort` (Discover asks RegistrationStats how full an event is) · `CheckoutEventPort` ·
`TicketCatalogPort` · `SeatMapPort` (Checkout reads the event, its tiers and its seats through their
owners) · `OrderPaymentPort` (Payments settles "paid + ticketed" atomically through Checkout's
transaction) · `InvoiceOrderPort` (Invoices bills an order Checkout owns) · `InvoicePaymentPort`
(Invoices learns how and when that order settled, from Payments) · `TaxableSalesPort` (the VAT ledger asks
Payments what was collected each month) · `SettledFundsPort` (Payouts asks Payments what has settled) ·
`PayoutAccountPort` (Payouts asks PaymentSettings whether a payout account is connected) ·
`CheckInEventPort` (the door asks Events whether it may admit, which is also its tenancy check). Provider seams
(infrastructure behind an abstract class, not cross-context reads): `SocialVerifierPort` (OAuth token
verification) · `PaymentProviderPort` (the PSP adapter — PCI SAQ-A; also carries the payout settings link
and payout retry) · `ObjectStoragePort` (S3 for profile photos).

**5. Register it in `app.module.ts`** and write the module docstring: what it owns, what it depends on, and
why any `forwardRef` exists.

**6. Ship it with tests (TDD).** `*.spec.ts` beside the code for the rules; `test/*.e2e-spec.ts` for the
flow. **The e2e suite is what proves the DI graph resolves — a green `tsc` does not.**

**Domain & correctness**
- **Business rules live in a policy / domain service / validator** — never scattered in controllers or inlined.
- **Custom, meaningful exceptions** — throw `DomainException` (factories `.notFound()`/`.forbidden()`/
  `.conflict()`/`.validation()`) with a stable `ErrorCode`; never leak internals.
- **Enums over magic strings** (`pgEnum`, `ErrorCode`); **constants over magic numbers** (module-level `const`).
- **No hard-coding** — never inline a literal that has a canonical home. Magic strings → enums (`pgEnum`,
  `ErrorCode`, `Persona`); magic numbers / limits / timeouts → module-level `const` (`DEFAULT_LIMIT`,
  `MAX_LIMIT`); env, hosts, ports, URLs, secrets, credentials, feature flags → `ConfigService` (zod `Env`),
  **never** a string literal or `process.env` in app code; money & tax rates (VAT 7%, service fee) and
  quotas (per-booking seat cap) → the org-settings row or a named constant, never sprinkled literals.
  **Derive from the single source of truth**: Swagger `enum` lists and DTO validators read the Drizzle
  `pgEnum().enumValues`; seeds and tests reference the same constants — don't re-type the values. Rule of
  thumb: if a literal appears twice, or carries domain meaning, name it once.
- **Transactions for multi-table writes** — use `withTenant(db, orgId, cb)` / `db.transaction` (also sets
  `SET LOCAL app.current_org` for RLS).
- **Side effects via domain events / background jobs** — emit outbox events (→ RabbitMQ → `eventa-worker`)
  for email/SMS/notifications/audit/ERP-sync/reports; keep the request path focused. *(Current: audit +
  last-active are inline until the worker lands.)*

**Cross-cutting**
- **Config only via `ConfigService`** (zod-validated `Env`) — never read `process.env` outside the env schema.
- **Logging via the Nest/pino `Logger`** — never `console.log` in app code; every line carries the
  correlation id (+ user/org/timing where useful). **Never log secrets/tokens/passwords** (pino redacts auth
  headers/cookies).
- **DI budget** — a service with more than ~6 injected deps is a design smell; split responsibilities.
- **No circular dependencies** — extract shared logic or publish an event.
- **Infrastructure behind adapters** — domain code must not import AWS/email/DB/HTTP clients directly; reach
  them through injected services (argon2 → `PasswordService`, jwt → `TokenService`, Drizzle → repository).

**Methods, TypeScript, naming**
- **Small methods** — **house target ≤ 10 lines**, ~40 hard ceiling; extract private methods over giant
  functions; **one level of abstraction** each.
- **TypeScript** — full `strict` is on; use `readonly` where possible, async/await, optional chaining,
  nullish coalescing. Avoid `any`, `@ts-ignore`, **nested ternaries**, deep nesting.
- **Explicit names** — `IdentityRepository`, `PasswordService`, `JwtAuthGuard`. Avoid `Helper`/`Util`/
  `Manager`/`CommonService`/`GeneralService`.

**API, data, security**
- **REST** under `/api/v1`; **one response envelope for every endpoint**. Success =
  `{ success, statusCode, message, data, [meta], timestamp }` (global `ResponseInterceptor`;
  `@ResponseMessage('…')` sets the message; return a `Paginated<T>` for lists → `meta` with
  `page/limit/total/totalPages/hasNext/hasPrevious`). Failure =
  `{ success:false, statusCode, message, [errors], timestamp }` (filter; validation → structured
  `errors:[{field,message}]` via `buildValidationPipe`; 500 → generic message, internals never leaked).
  `correlationId` is on the `x-correlation-id` header, not the body. Opt out with `@SkipResponseEnvelope`
  (health probes). Correct HTTP status codes.
- **Auth** is **passport-jwt**: `JwtStrategy` verifies the Bearer access token; `JwtAuthGuard` (global,
  `AuthGuard('jwt')`) honours `@Public` and stamps tenant context; `TokenService` signs. Principal is on
  `req.user` — read it via `@CurrentAuth()`.
- **Postgres/Drizzle** — explicit FKs/relations; **paginate** list endpoints; index searchable columns;
  transactions for multi-table writes; no N+1; no business logic in schema; never expose schema types.
- **Security** — validate + sanitize input; parameterized queries (Drizzle); enforce authz **server-side**;
  never expose secrets; never log PANs/passwords/tokens; PCI SAQ-A (Stripe hosted fields).

**Review checklist (before finishing a task):** SRP/SOLID respected · no duplicated code · no magic
strings/numbers · DTOs used · validation added · logging where useful · meaningful exceptions · repository
pattern respected · no business logic in controllers · tenant scoping + idempotency on money paths · tests
updated if behavior changed.

**When unsure** — prefer maintainability over clever code; **ask before architectural changes**; don't
refactor unrelated code while implementing a feature.

## Contracts with sibling repos (no shared package)

- **web ↔ api:** this repo emits `openapi.json`; `../eventa-web` generates its typed client from it.
  Controller DTOs drive that spec — keep them accurate.
- **api ↔ worker:** each side owns its event type — the producer defines the payload
  (`modules/*/events/*.event.ts`), the worker validates every message (zod, tolerant reader), and **Pact**
  contract tests (`test/contract/`) fail CI on drift. Payloads carry a `version` field.
