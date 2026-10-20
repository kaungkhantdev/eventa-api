# eventa-api — the one Dockerfile for this repo (twelve-factor I: one codebase,
# one build recipe). Two images come out of it:
#
#   docker build -t eventa-api .              the production image (last stage)
#   docker build --target dev -t eventa-api:dev .
#                                             the watch-mode image the umbrella
#                                             eventa/docker-compose.yml runs
#
# Both start from the same base, the same lockfile and the same install, so
# development runs what production runs, minus the compiler (X: dev/prod
# parity). Stages:
#
#   base ─┬─ deps ─┬─ dev          pnpm dev, the source mounted over /app
#         │        └─ build        nest build → dist/
#         ├─ prod-deps             production dependencies only
#         └─ prod (last)           dist/ + prod node_modules, run as node
#
# The twelve factors, and where each one is kept:
#   I    Codebase      this file, in this repo; one image per release.
#   II   Dependencies  a pinned base image, pnpm pinned by package.json's
#                      "packageManager" through Corepack, a frozen lockfile, and
#                      pnpm-workspace.yaml's allowBuilds; the production image
#                      holds production dependencies only.
#   III  Config        the environment only. No .env is in any image
#                      (.dockerignore), and none is needed to boot: the app
#                      validates process.env against src/config/env.validation.ts.
#   IV   Backing       Postgres, Redis, RabbitMQ, S3 and SMTP are URLs and
#        services      credentials in that environment (DATABASE_URL, REDIS_URL,
#                      RABBITMQ_URL, S3_*), attached and swapped without a rebuild.
#   V    Build,        `build` compiles; `prod` copies the result and never
#        release, run  builds or installs at start. A release is this image plus
#                      an environment; the image is the same in every one.
#   VI   Processes     stateless: the image is read-only to the process (root
#                      owns /app) and it writes nothing to its filesystem, so it
#                      runs under `docker run --read-only` and Kubernetes'
#                      readOnlyRootFilesystem. Files go to S3, state to Postgres
#                      and Redis.
#   VII  Port binding  the app serves HTTP itself on $PORT (default 3000).
#   VIII Concurrency   one process type per image (the HTTP API). Scale it by
#                      running more containers; the relay and the worker are
#                      their own repos and images.
#   IX   Disposability exec-form CMD, so node is PID 1 and receives SIGTERM
#                      itself; main.ts enables Nest's shutdown hooks, which close
#                      connections before exit. Start is `node dist/main` — no
#                      compile, no install.
#   X    Dev/prod      one base, one lockfile, one Dockerfile; compose runs the
#        parity        same kinds of backing service as production.
#   XI   Logs          pino writes JSON to stdout; the image keeps no log files.
#   XII  Admin         one-off processes of this same image and environment:
#        processes       docker run --rm --env-file <env> eventa-api \
#                          node dist/db/migrate.main.js
#                      (the api chart's migration Job runs exactly that).

# ─── base ────────────────────────────────────────────────────────────────────
# Debian (glibc), not Alpine (musl): @node-rs/argon2 and esbuild ship prebuilt
# binaries per libc, and the glibc ones are what CI's Ubuntu runner proves.
# A full version tag, so a rebuild cannot silently move to another Node; bump
# it deliberately (CI runs Node 24 too).
FROM node:24.22.0-bookworm-slim AS base

# pnpm via Corepack, which ships with Node 24. `corepack install` (in the
# stages below, once package.json is there) fetches exactly the pnpm that
# "packageManager" names, at build time, so no container downloads it on start.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

WORKDIR /app

# ─── deps: every dependency, for development and the build ───────────────────
FROM base AS deps

# The container must never install dependencies by itself. Before
# `pnpm <script>`, pnpm 11 checks node_modules against the lockfile and by
# default runs `pnpm install` when they differ, which writes into the project
# directory: under compose that is the read-only checkout, so it would fail
# half-way with a file-system error. `error` stops with
# ERR_PNPM_VERIFY_DEPS_BEFORE_RUN instead, which means: dependencies changed,
# rebuild this image.
ENV pnpm_config_verify_deps_before_run=error

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install

# Installed the way CI installs: frozen lockfile and pnpm 11's strict
# build-script policy (no dangerouslyAllowAllBuilds), so a dependency whose
# install script pnpm-workspace.yaml has not approved fails the build with
# ERR_PNPM_IGNORED_BUILDS instead of leaving a half-built node_modules.
# The pnpm store lives in a BuildKit cache, not in the image, so a rebuild
# after a dependency change only downloads what is new.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ─── dev: what the umbrella compose runs (`target: dev`) ─────────────────────
# Development only: devDependencies, the TypeScript compiler in watch mode, and
# root, because `nest start` writes dist/ under /app. The compose file
# bind-mounts the live source READ-ONLY over this snapshot, so a save on the
# host recompiles here as `pnpm dev` does on the host. The snapshot lets the
# image also run on its own; .dockerignore keeps node_modules, dist and every
# .env file out of it.
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

# ─── build: compile once (V) ─────────────────────────────────────────────────
# Only what `nest build` reads, so an edit to a test or a document does not
# invalidate the production build. tsconfig.build.json extends tsconfig.json;
# nest-cli.json copies assets/fonts/sarabun into dist/assets (the Thai face the
# PDF exports embed). The compiled output includes dist/db/migrate.main.js,
# the migration entry point.
FROM deps AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY assets ./assets
COPY src ./src
RUN pnpm build

# ─── prod-deps: production dependencies only (II) ────────────────────────────
# A clean install with --prod rather than pruning the full one: nothing from
# devDependencies (tsx, drizzle-kit, typescript, jest, esbuild) is ever in
# this node_modules to be left behind. Same lockfile, same allowBuilds.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store

# ─── prod: the production image (last, so `docker build .` gives it) ─────────
FROM base AS prod
# Not only a label: outside production the api writes openapi.json into its
# working directory when EMIT_OPENAPI is set, which a read-only filesystem (VI)
# refuses. Keep it production. Logs are JSON under any NODE_ENV: pretty output
# needs pino-pretty, a devDependency this image does not have, and the logger
# checks that it is installed before asking pino for it
# (src/config/logger.config.ts).
ENV NODE_ENV=production

# Owned by root and read-only to the process: the release cannot change itself
# (VI), and nothing here needs to be written at run time.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The SQL the migration entry applies, at the path it resolves from WORKDIR —
# the same src/db/migrations it has in a checkout (src/db/drizzle.constants.ts).
COPY --from=build /app/src/db/migrations ./src/db/migrations

# The image's `node` user, by number: Kubernetes' runAsNonRoot can only verify
# a numeric user, and eventa-infra's pod securityContext runs as 1000:1000.
USER 1000:1000

# VII: the port the app binds, $PORT (env.validation.ts defaults it to 3000).
EXPOSE 3000

# For `docker run` and compose; Kubernetes ignores this and uses the chart's
# probes. Node's own fetch, so the image needs no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/api/v1/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# IX: exec form, so node itself is PID 1 and receives SIGTERM.
CMD ["node", "dist/main"]
