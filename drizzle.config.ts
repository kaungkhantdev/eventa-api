import { defineConfig } from 'drizzle-kit';
import { MIGRATIONS_FOLDER } from './src/db/drizzle.constants';

// drizzle-kit config. `pnpm generate` diffs src/db/schema → SQL migrations in MIGRATIONS_FOLDER,
// the folder `pnpm migrate` and the production image's migration entry apply from. Falls back to
// the docker-compose DB when DATABASE_URL is unset so codegen works offline. See development-guide §6.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: `./${MIGRATIONS_FOLDER}`,
  casing: 'snake_case',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://eventa:eventa@localhost:5432/eventa',
  },
  verbose: true,
  strict: true,
});
