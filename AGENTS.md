# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, …) working in this
repository — the single source of truth; tool-specific files import it.

## What this is

`eventa-api` — the **backend API** for **Eventa**, a Thai-market (THB/satang, VAT 7%, PromptPay,
Asia/Bangkok, bilingual EN/TH) multi-tenant event registration & management platform. NestJS 11 +
TypeScript.

**The foundation is built**: zod-validated config (`src/config`), a
global Drizzle `DatabaseModule` (`src/db`), the `src/common` cross-cutting layer (AsyncLocalStorage
request context, correlation-id middleware, `DomainException` + global error-envelope filter, pino
structured logging), the `/api/v1` global prefix + `ValidationPipe`, Swagger/`openapi.json`, a
`/api/v1/health/{live,ready}` probe pair, and a `docker-compose.yml` for Postgres/Redis/RabbitMQ — plus
Mailpit (the dev mail catcher) and MinIO (not optional: it is the S3 bucket, so without it every
upload fails at the browser's PUT).
Installed stack: `drizzle-orm`/`pg`, `@nestjs/config`, `@nestjs/swagger`, `class-validator`/`-transformer`,
`zod`, `nestjs-pino`, `@nestjs/passport`+`passport-jwt`, `@node-rs/argon2`, `amqplib`, `stripe` (the
PSP behind `PaymentProviderPort`), `@aws-sdk/client-s3` + `s3-request-presigner` (behind
`ObjectStoragePort`), `ioredis`, `pdfkit` + `qrcode` (tickets and tax invoices), `exceljs` (finance
exports), `sanitize-html` (rich text), `prom-client` (the `metrics` module). `package.json` is the
list — this one goes stale.

**What is built: measure it, do not read it here.** This section used to
enumerate the finished epics and list what was "still to come", and it was wrong within weeks — it still
named payouts, VAT periods, check-in, the dashboard and messaging as unbuilt long after all five shipped.
A reader who trusted it would have rebuilt working modules. So the inventory lives where it cannot drift:

- **What exists** — `ls src/modules` (53 today), `ls src/db/migrations` (`0000`…`0071`), and the
  committed `pgTable` definitions in `src/db/schema` (57 tables).
- **What is left** — the `US-*` backlog in
  [`../eventa-docs/01-requirements-and-features/functional-requirements.md`](../eventa-docs/01-requirements-and-features/functional-requirements.md),
  which is the only place a story's acceptance criteria live. Before building, find the story and quote
  the criterion; if there is no story, it is not work.

One thing worth knowing here because no listing shows it: `US-DISC-13` (ratings) is deliberately
deferred, which is recorded in the functional requirements rather than being an oversight.

**The outbox relay is NOT in this repo.** This file claimed for a long time that `src/relay.ts` →
`RelayModule` was a second entrypoint out of this image, that `pnpm relay` ran it, that
`tsconfig.build.json` existed partly to emit `dist/relay.js`, and that both entrypoints had to be kept
buildable. None of it is true: there is no `src/relay.ts`, no `RelayModule`, no `relay` script and no
`dist/relay.js`. The relay is its own repo, **`../eventa-relay`** (`src/relay/`,
`outbox-reader.repository.ts`), which polls `outbox_events` and publishes to RabbitMQ. This repo's only
part in it is WRITING those rows — see the outbox rule below.

The build plan is **not in this repo** — it lives in the sibling SDLC docs at **`../eventa-docs`**. Read
these before adding anything:
- [`../eventa-docs/05-development/development-guide.md`](../eventa-docs/05-development/development-guide.md) — how to build *this* repo (layout, conventions, the feature playbook). **Primary reference.**
- [`../eventa-docs/04-architecture/software-architecture.md`](../eventa-docs/04-architecture/software-architecture.md) — the SAD (modular monolith, outbox, checkout consistency, ADRs).
- [`../eventa-docs/04-architecture/entities.md`](../eventa-docs/04-architecture/entities.md) + `erd.md` — the data dictionary: **57 tables**, all of which exist today. Note the direction: those documents are **read back from the live schema**, so where a document and the database disagree the database wins and the *document* is corrected. **This repo owns the schema & migrations**, so the committed `pgTable` definitions are the inventory — and `entities.md` is where you learn *why* a table exists.
- [`../eventa-docs/01-requirements-and-features/functional-requirements.md`](../eventa-docs/01-requirements-and-features/functional-requirements.md) — the product backlog; a `US-*` story's acceptance criteria become your tests ([test cases](../eventa-docs/06-testing/test-cases.md)).

Polyrepo siblings: `../eventa-web` (React front-end, reads this API's `openapi.json`), `../eventa-worker`
(RabbitMQ consumers of the outbox events), `../eventa-relay` (polls `outbox_events` and publishes them —
the step between the two), `../eventa-docs` (the SDLC docs and the `US-*` backlog), `../eventa-ui-kit`
(the static HTML/Tailwind kit the front-end ports), `../eventa-infra` (Terraform/Helm/Argo CD).

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
pnpm typecheck         # tsc --noEmit over src + test (+ drizzle.config.ts) — the only type check the specs get
pnpm format            # prettier --write
pnpm test              # jest unit tests
pnpm test:e2e          # jest e2e tests (separate config)
pnpm test:cov          # coverage
pnpm check:openapi     # nest build -p tsconfig.openapi.json, then scripts/check-openapi.cjs
```

Run a **single test**: `pnpm test -- <path-or-name-pattern>` — e.g. `pnpm test -- env.validation` or
`pnpm test -- -t "renders a DomainException"`. Same pattern for e2e: `pnpm test:e2e -- <pattern>`.

**Local development** (needs Docker + a `.env`, copied from `.env.example`):

```bash
docker compose up -d   # Postgres :5432 · Redis :6379 · RabbitMQ :5672 (+ mgmt :15672)
                       # · Mailpit :1025 SMTP, inbox on :8025 · MinIO :9000 (console :9001)
                       # MinIO is NOT optional: it is the only storage backend, so without
                       # it the API boots and every upload fails at the browser's PUT.
                       # · Mailpit :1025 (inbox :8025) · MinIO :9000 (console :9001)
pnpm dev               # HTTP API in watch mode (http://localhost:3000, prefix /api/v1)
pnpm generate          # drizzle-kit: diff src/db/schema → SQL migration in src/db/migrations
pnpm migrate           # drizzle-kit: apply pending migrations
pnpm seed              # seeds the `acme` tenant + admin@acme.test, idempotent (src/db/seed.ts)
pnpm db:studio         # drizzle-kit studio — browse the local DB
```

Swagger UI is at `/api/docs`, the spec at `/api/docs/json`; `openapi.json` is also written to the repo
root on boot when `EMIT_OPENAPI=true` **and** `NODE_ENV` is not `production` (git-ignored —
regenerated in CI, consumed by `eventa-web`).

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
  `*.e2e-spec.ts`) — put full-stack flows in `test/`. **Neither one type-checks:** `tsconfig.json` sets
  `isolatedModules: true`, which puts ts-jest in transpile-only mode, and `tsconfig.build.json` excludes
  the specs — so a spec can go green while it no longer compiles. `pnpm typecheck` must be green before
  a commit.
- **TypeScript is full `strict`** (`tsconfig.json` → `"strict": true`). eslint's `no-explicit-any` is still
  **off** (so an explicit `any` won't error), but the type-aware `no-unsafe-*` rules do — prefer explicit
  types and avoid `any`/`@ts-ignore`/nested ternaries per the engineering standard.
- **ESLint is type-aware** (`recommendedTypeChecked` + `projectService`), so it needs a valid tsconfig to
  run. `no-floating-promises` and `no-unsafe-argument` are **warnings** — heed them on the async/money
  paths especially. `module: nodenext`, `target: ES2023`.
- Nest DI relies on `emitDecoratorMetadata` / `experimentalDecorators` (already set).
- **The production build is scoped to `src`** (`tsconfig.build.json` sets `rootDir: src` and excludes
  root-level `.ts` like `drizzle.config.ts`) so the entrypoint emits as `dist/main.js`.
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
  **`ls src/modules` is the list** — 53 of them, and a prose copy here went stale by fourteen before
  anybody noticed. What a listing cannot tell you is which name means what, so these are the ones worth
  knowing before you add a sibling next to them: `auth` (sign-in, tokens, sessions) and its prefix family
  (`auth-signup`, `auth-password`, `auth-sessions`, `auth-two-factor`, `auth-social`) · `users` (the user
  record) · `access` (members, roles, RBAC) · `events` and its `event-*` sub-domains · `discover`
  (anonymous cross-tenant browse/search) · `checkout` (order placement — the money path) · `payments`
  (provider seam + webhooks) · the finance family (`invoices`, `tax-periods` — the monthly VAT ledger and
  PP30 filing, `payouts`) · `platform` (the transactional outbox, and only that — its docstring reserves
  idempotency, audit and jobs for later, so do not go looking for them there; `audit` is its own
  module and order idempotency lives in `checkout`/`payments`).
  Tree: `src/db/`, `src/modules/<name>/`, `src/common/` (`guards/`, `decorators/`, `interceptors/`,
  `filters/`, `http/`, `util/`, tenancy), plus a generated `openapi.json`.
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
  (email/SMS, calendar, read-models, search) → write a row to **`outbox_events`** in the *same* transaction;
  the relay ships it to RabbitMQ and a consumer (in `eventa-worker`) handles it. **Never dual-write.**
- **Drizzle ORM** (SQL-first). Schema in `src/db/schema` (TS) → `pnpm drizzle-kit generate --name <x>`
  diffs it to **plain-SQL** migrations (reviewed in the PR) → `pnpm drizzle-kit migrate` applies them.
  Non-diffable SQL (RLS **policies**, functions) goes in a `--custom` migration. This repo **owns**
  migrations; keep the schema consistent with `entities.md`/`erd.md`, and **never edit a shipped
  migration** — add a new one (expand/contract for zero-downtime).
- **Money is integer satang** (format only at the edge); time stored **UTC**, displayed Asia/Bangkok;
  user-facing strings are **bilingual EN/TH**.
- **REST under `/api/v1`**, DTO-validated inputs, the standard failure envelope
  (`{ success:false, statusCode, [code], message, [errors], timestamp }` — spelled out under
  **API, data, security** below; there is no `details` field),
  authz enforced **server-side** (return `403`, don't just hide UI), structured JSON logs carrying a
  correlation id.
- **Payments are PCI SAQ-A** — never touch card/bank data (Stripe hosted fields + PromptPay). Payment
  **webhooks** land here and must be **signature-verified and idempotent** (dedupe via `webhook_events`);
  the webhook is the source of truth for payment state.
- This same service image is also the **check-in pool** deployment. It does NOT ship the relay — that
  is `../eventa-relay`, its own repo and its own deployment.

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
ticketing↔registration, ticketing↔checkout — which pulls discounts→ticketing into the cycle too) — not to
paper over a bad boundary. Ports in play — the cross-context reads worth knowing; there are 45
`*Port` abstract classes today and `grep -rn 'abstract class .*Port' src` is the inventory (the
`reports`/`dashboard` read families and the payment-setup ports are not listed here):
`TicketAvailabilityPort` ·
`EventStatsPort` · `TicketSalesPort` ·
`TicketEligibilityPort` (Registration asks Ticketing "may this tier be sold right now?") ·
`CheckoutActivityPort` (Ticketing asks Registration "is anyone mid-checkout?") ·
`WaitlistOffersPort` (Ticketing asks Checkout to offer a raised allocation's new places to the waitlist) ·
`EventLookupPort` ·
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
  last-active are still written inline — not because the worker is missing, it landed, but because
  neither has been moved yet.)*

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
  `{ success:false, statusCode, [code], message, [errors], timestamp }` (filter; validation → structured
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

- **web ↔ api:** this repo emits `openapi.json` and `../eventa-web` reads it as the contract — but it
  does NOT generate from it. Its wire types are hand-written on purpose ("Keeping it hand-written is
  deliberate while the surface is still moving", `eventa-web/src/lib/api/envelope.ts`), so a DTO you
  change here does not break a build over there. **Nothing catches that drift automatically**, and it
  has cost real bugs: a field renamed here read `undefined` in the console for weeks, and a key removed
  from `UpdateProfileDto` left two profile forms answering 400 on every save, because
  `forbidNonWhitelisted` refuses an undeclared key outright rather than ignoring it. Change a request or
  response shape and grep `../eventa-web/src` for the field in the same change.
- **api ↔ worker:** each side owns its event type — the producer defines the payload
  (`modules/*/events/*.event.ts`) and the worker validates every message (zod, tolerant reader) with a
  `version` field so the two can evolve apart. There are **no contract tests**: this file used to
  promise "Pact contract tests (`test/contract/`) fail CI on drift", and there is no `test/contract`
  directory and no pact dependency in either repo. The tolerant reader is the whole of the safety net,
  so add a field rather than rename one, and never make an existing field required.
