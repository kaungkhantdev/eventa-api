# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
`zod`, `nestjs-pino`. **The domain modules are not built yet** — `src/modules/*` is empty and
`src/db/schema` has no tables; translate `entities.md` one bounded context at a time. The RabbitMQ client
and the outbox relay are still stubs (`src/relay.ts`).

The build plan is **not in this repo** — it lives in the sibling SDLC docs at **`../eventa-docs`**. Read
these before adding anything:
- [`../eventa-docs/05-development/development-guide.md`](../eventa-docs/05-development/development-guide.md) — how to build *this* repo (layout, conventions, the feature playbook). **Primary reference.**
- [`../eventa-docs/04-architecture/software-architecture.md`](../eventa-docs/04-architecture/software-architecture.md) — the SAD (modular monolith, outbox, checkout consistency, ADRs).
- [`../eventa-docs/04-architecture/entities.md`](../eventa-docs/04-architecture/entities.md) + `erd.md` — the data-model **source of truth** (47 tables). **This repo owns the DB schema & migrations.**
- [`../eventa-docs/01-requirements-and-features/functional-requirements.md`](../eventa-docs/01-requirements-and-features/functional-requirements.md) — the product backlog; a `US-*` story's acceptance criteria become your tests ([test cases](../eventa-docs/06-testing/test-cases.md)).

Polyrepo siblings: `../eventa-web` (React front-end, consumes this API's `openapi.json`), `eventa-worker`
(RabbitMQ consumers — not created yet), `eventa-infra` (Terraform/Helm/Argo CD).

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
pnpm relay             # outbox relay entrypoint (stub for now)
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
- **TypeScript is only partly strict.** `tsconfig.json` sets `strictNullChecks` but **not** full
  `strict`: `noImplicitAny` is `false`, and eslint's `no-explicit-any` is turned **off**. This is looser
  than both the development guide's "strict, no `any`" intent and the `../eventa-web` repo. Prefer
  explicit types; consider tightening `tsconfig` before the domain code grows.
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

- **Modular monolith: one NestJS module = one bounded context** (`identity`, `organization`, `events`,
  `ticketing`, `registration`, `attendance`, `payments`, `engagement`, `meetings`, plus `platform` for
  outbox/idempotency/audit/jobs). A module may depend on another module's **service interface — never on
  another module's tables**. Per module: `*.controller.ts` (thin HTTP) · `*.service.ts` (rules) ·
  repository (data access) · `dto/` (validated request/response) · `events/` (event contracts). Target
  tree: `src/db/`, `src/modules/<domain>/`, `src/common/` (guards/interceptors/filters/tenancy), plus
  `src/relay.ts` (the outbox publisher) and a generated `openapi.json`.
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
- **Feature-first** — `src/modules/<feature>/` owns its `controller` · `service` · `repository` · `dto` ·
  `events` (and, as it grows: `validators/`, `policies/`, `mappers/`, `listeners/`, `interfaces/`,
  `use-cases/`). **Never** top-level `controllers/`·`services/` layer folders. DB schema is centralized in
  `src/db/schema` (Drizzle; the api owns it).
- **Thin controllers** — validate · authenticate · authorize · call service · return. **No business logic.**
- **Services orchestrate** — no SQL, HTTP calls, email, or storage code inside a service; delegate to
  repositories / provider services.
- **Repository pattern** — all DB access lives in repositories with **descriptive** methods
  (`findValidSession`, `getPermissions`), never Drizzle queries in a service.
- **DTOs at the edge** — never return raw Drizzle row/schema types; map request → domain → response DTO
  (`toMeResponse`). Validate every input with **class-validator** DTOs (never trust the client).

**Domain & correctness**
- **Business rules live in a policy / domain service / validator** — never scattered in controllers or inlined.
- **Custom, meaningful exceptions** — throw `DomainException` (factories `.notFound()`/`.forbidden()`/
  `.conflict()`/`.validation()`) with a stable `ErrorCode`; never leak internals.
- **Enums over magic strings** (`pgEnum`, `ErrorCode`); **constants over magic numbers** (module-level `const`).
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
- **TypeScript** — `readonly` where possible, async/await, optional chaining, nullish coalescing. Avoid
  `any`, `@ts-ignore`, **nested ternaries**, deep nesting. *(Repo tsconfig is only partly strict today —
  `noImplicitAny:false`; full `strict` is the target — see Config gotchas.)*
- **Explicit names** — `IdentityRepository`, `PasswordService`, `JwtAuthGuard`. Avoid `Helper`/`Util`/
  `Manager`/`CommonService`/`GeneralService`.

**API, data, security**
- **REST** under `/api/v1`; **consistent response format** (standard error envelope; lists paginated);
  correct HTTP status codes.
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
