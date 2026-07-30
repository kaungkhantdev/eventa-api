import { defineConfig } from 'drizzle-kit';

// drizzle-kit config. `pnpm generate` diffs src/db/schema → SQL migrations in src/db/migrations;
// `pnpm migrate` applies them. Falls back to the docker-compose DB when DATABASE_URL is unset so
// codegen works offline. See development-guide §6.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  casing: 'snake_case',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://eventa:eventa@localhost:5432/eventa',
  },
  verbose: true,
  strict: true,
});
