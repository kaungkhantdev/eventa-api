# Eventa API

Backend API for **Eventa** — a Thai-market, multi-tenant event registration & management platform.
NestJS 11 + TypeScript, Drizzle ORM (Postgres), JWT auth, and a transactional outbox → RabbitMQ for
side effects.

> Architecture, conventions, and the full build plan live in the SDLC docs at
> [`../eventa-docs`](../eventa-docs) and in [CLAUDE.md](CLAUDE.md).

## Prerequisites

- **Node.js 24** — what CI and the image run (`pnpm seed` uses `--env-file-if-exists`, Node 22.9+)
- **pnpm** — `npm i -g pnpm`
- **Docker** + Docker Compose — runs Postgres, Redis, and RabbitMQ locally

## Run it locally

Five steps from a fresh clone to a running API with a login you can actually use.

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create your env file

```bash
cp .env.example .env
```

The defaults already match `docker-compose.yml`, so nothing needs editing for local dev. Config is
zod-validated on boot — if a value is missing or invalid the API refuses to start and tells you which one.

### 3. Start the backing services

```bash
docker compose up -d
```

Brings up Postgres, Redis, and RabbitMQ (see [Ports](#ports)). Confirm they're healthy:

```bash
docker compose ps
```

### 4. Migrate and seed the database

```bash
pnpm migrate
pnpm seed
```

`pnpm seed` creates one tenant and an admin you can sign in as — these are the same values the Swagger
login example is pre-filled with:

| field      | value                          |
| ---------- | ------------------------------ |
| `orgSlug`  | `acme`                         |
| `email`    | `admin@acme.test`              |
| `password` | `correct horse battery staple` |

Re-running `pnpm seed` is safe — it wipes and recreates the `acme` tenant.

### 5. Start the API

```bash
pnpm dev
```

The API listens on **http://localhost:3000** under the **`/api/v1`** prefix (watch mode — restarts on
change). Quick check:

```bash
curl http://localhost:3000/api/v1/health/ready
```

## Try the API in Swagger

Open **http://localhost:3000/api/docs** (raw OpenAPI JSON at `/api/docs/json`).

1. **`POST /auth/login`** → **Try it out** → **Execute**. The pre-filled example matches the seed, so you
   get back an `accessToken` and `refreshToken`. Copy the **`accessToken`**.
2. Click **Authorize** (top-right), paste **just the token** (no `Bearer ` prefix — Swagger adds it),
   then **Authorize** → **Close**.
3. Call the protected endpoints — e.g. **`GET /auth/me`**, **`POST /auth/refresh`**, **`POST /auth/logout`**.

Access tokens last ~15 minutes; if a call returns `401`, log in again or use `/auth/refresh`, then
re-Authorize.

### Create and manage events (organizer console)

Event endpoints live under the organizer console and are guarded two ways: you must be an **admin**
account **and** hold the required **permission**. The seeded `admin@acme.test` has the Admin role (all 12
permissions), so it can do everything below — stay authorized from the login step above.

- **Create** — `POST /events`:
  ```json
  { "name": "Bangkok Tech Conference 2026", "type": "Conference", "startAt": "2026-09-01T09:00:00+07:00" }
  ```
  Returns **201** with a generated `slug`, `status: "draft"` and `bucket: "active"`. Optional fields:
  `description`, `categoryId`, `organizerName`.
- **Attach a category** — add `"categoryId": <id>`. `pnpm seed` creates a few categories and prints their
  ids (Conference / Workshop / Concert) — the ids change on each seed, so read them from the seed output.
  A non-existent id, or one from another workspace, returns **404** (categories are tenant-scoped).
- **List** — `GET /events` returns a **paginated** envelope: `data: [ ... ]` plus
  `meta { page, limit, total, totalPages, hasNext, hasPrevious }`. Query params: `q` (search by name),
  `type`, `bucket` (`active` | `completed`), `sort` (`recent` | `name` | `date`), `page`, `limit`.

**Authorization is enforced server-side (returns 403 — the UI never just hides an action):**

- An **attendee** token can't reach the organizer console → **403** (admin persona required).
- An admin whose role does **not** grant **`evCreate`** → **403** on create/list. Your granted keys are in
  the login response under `data.user.permissions`.
- Swagger / `openapi.json` is the authoritative contract for every field, enum, and status code.

## Optional: the side-effect pipeline (outbox → RabbitMQ → worker)

Every login enqueues an `identity.signed_in` event to the transactional outbox instead of writing the
audit inline. To ship those events, run the relay alongside the API:

```bash
pnpm relay
```

It polls `outbox_events` and publishes to RabbitMQ (with publisher confirms). A consumer in
[`../eventa-worker`](../eventa-worker) turns each event into an audit record. This is **not** needed just
to exercise the HTTP endpoints. Inspect the broker in the RabbitMQ management UI at
http://localhost:15672 (`eventa` / `eventa`).

## Tests

The Docker stack must be up — e2e and integration tests run against real Postgres and RabbitMQ.

```bash
pnpm test        # unit tests (*.spec.ts, beside the code)
pnpm test:e2e    # full-stack flows (HTTP envelope, RLS, relay)
pnpm test:cov    # coverage
```

Run a single test by name or path:

```bash
pnpm test -- auth        # e.g. everything matching "auth"
```

## Ports

| Service     | URL / Port                     | Notes                            |
| ----------- | ------------------------------ | -------------------------------- |
| API         | http://localhost:3000          | global prefix `/api/v1`          |
| Swagger UI  | http://localhost:3000/api/docs | spec at `/api/docs/json`         |
| Postgres    | `localhost:5432`               | `eventa` / `eventa`, db `eventa` |
| Redis       | `localhost:6379`               |                                  |
| RabbitMQ    | `localhost:5672`               | AMQP                             |
| RabbitMQ UI | http://localhost:15672         | `eventa` / `eventa`              |

## Common commands

| Command             | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `pnpm dev`          | API in watch mode                                        |
| `pnpm relay`        | Outbox relay (publishes events to RabbitMQ)              |
| `pnpm migrate`      | Apply pending DB migrations                              |
| `pnpm migrate:prod` | The same, from the build: `node dist/db/migrate.main.js` |
| `pnpm generate`     | Diff `src/db/schema` → a new SQL migration               |
| `pnpm seed`         | Seed a dev tenant + admin                                |
| `pnpm db:studio`    | Drizzle Studio — browse the DB in the browser            |
| `pnpm lint`         | ESLint (type-aware) + Prettier, autofix                  |
| `pnpm build`        | Compile to `dist/` (`dist/main.js`, `dist/relay.js`)     |

## Production image

One `Dockerfile` builds both images. Its last stage is production, so a plain build gives it:

```bash
docker build -t eventa-api .                       # production: compiled JS, production deps only
docker build --target dev -t eventa-api:dev .      # development: what the umbrella compose runs
```

Config is the environment and nothing else — no `.env` is in the image, and none is needed:

```bash
docker run --rm -p 3000:3000 --env-file prod.env eventa-api
```

Migrations are a one-off run of the **same image** with the same environment (plain `node`: the image
has no `tsx`, `drizzle-kit` or package manager to call):

```bash
docker run --rm --init --env-file prod.env eventa-api node dist/db/migrate.main.js
```

`--init` lets Ctrl-C stop it: as PID 1 with no signal handler of its own, node would ignore it. A
stopped run is safe — each migration commits on its own, so the next run resumes after the last one.
The entry point is `src/db/migrate.main.ts`; `pnpm migrate` runs the same code from source
(`scripts/migrate.ts` → `src/db/migration-runner.ts`).

The image follows the twelve-factor app; the `Dockerfile` header says where each factor is kept. In
short: one Dockerfile per repo; a pinned base image, Corepack-pinned pnpm, a frozen lockfile and
production-only `node_modules`; config from the environment; backing services as URLs; build, then an
immutable image that runs `node dist/main`; a read-only filesystem (it runs under `--read-only`, as
the Kubernetes pods do); `$PORT` (3000); one process type; exec-form `CMD`, so node gets `SIGTERM` and
Nest's shutdown hooks close connections; dev and prod from the same base and lockfile; JSON logs on
stdout; admin processes from the same image.

### What has to travel with `dist/`

The PDF report exports (`GET /reports/<report>.pdf`) embed the **Sarabun** Thai face, because a PDF
carries the glyphs it draws — without it every Thai event name prints blank. The faces live in
`assets/fonts/sarabun/` at the repo root, and `nest-cli.json` copies them to **`dist/assets/`** on
build. An image or artifact that ships `dist/` must therefore keep `dist/assets/` with it; the app
falls back to the repo-root `assets/` when it is present, and otherwise refuses the export with a
message naming both paths. Ship the `OFL.txt` beside the faces — the Open Font License requires it.

The migration entry reads the SQL from `src/db/migrations` under the working directory, so the image
ships that folder at `/app/src/db/migrations` beside `dist/`.

## Troubleshooting

- **`DATABASE_URL is required` on `pnpm seed`** — you haven't created `.env` yet (step 2).
- **Login returns `401` for the seed user** — run `pnpm migrate` then `pnpm seed`, and make sure Postgres
  is healthy (`docker compose ps`).
- **API won't boot with an env error** — env is zod-validated on boot; compare your `.env` against
  `.env.example` (`JWT_SECRET` must be at least 16 characters).
- **`Port 3000 already in use`** — change `PORT` in `.env`, or stop whatever is on 3000.
- **Docker services unhealthy** — `docker compose down -v` then `docker compose up -d` to reset (this
  wipes the Postgres volume, so re-run `pnpm migrate` and `pnpm seed`).

## License

Proprietary — all rights reserved. This repository is public so that it can be
read; it is not open-source software, and no right to use, copy, modify or run
it is granted. See [LICENSE](LICENSE).
