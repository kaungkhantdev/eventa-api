import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

/**
 * The production image installs `dependencies` only (`pnpm install --prod`,
 * the Dockerfile's prod-deps stage). Code that a production entry point
 * reaches and that imports a devDependency compiles, passes every test here
 * and the e2e suite — all of which have devDependencies installed — and then
 * dies with MODULE_NOT_FOUND in the container: the api at boot, the migration
 * Job at deploy. This walks each entry point's imports and names any such
 * package before that happens.
 *
 * What it cannot see: a package named in a string and loaded at run time,
 * such as the logger's pino-pretty transport, which is why the image sets
 * NODE_ENV=production (logger.config.ts loads it everywhere else).
 */

const SRC = __dirname;
const REPO_ROOT = join(SRC, '..');
const PRODUCTION_ENTRIES = ['main.ts', 'db/migrate.main.ts'];

const manifest = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
) as { dependencies: Record<string, string> };

/**
 * Whether the compiled JavaScript keeps this import. The compiler erases
 * `import type`, `export type` and an import whose every name is a type, so
 * those load nothing at run time.
 */
function isKeptAtRuntime(statement: ts.Statement): boolean {
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
  if (!ts.isImportDeclaration(statement)) return false;
  const clause = statement.importClause;
  if (!clause) return true; // `import 'x'`, for its side effects
  if (clause.isTypeOnly) return false;
  const named = clause.namedBindings;
  const onlyTypes =
    !clause.name &&
    named !== undefined &&
    ts.isNamedImports(named) &&
    named.elements.every((element) => element.isTypeOnly);
  return !onlyTypes;
}

/** The module a kept import or re-export names; undefined for anything else. */
function moduleOf(statement: ts.Statement): string | undefined {
  if (!isKeptAtRuntime(statement)) return undefined;
  const { moduleSpecifier } = statement as
    ts.ImportDeclaration | ts.ExportDeclaration;
  return moduleSpecifier && ts.isStringLiteral(moduleSpecifier)
    ? moduleSpecifier.text
    : undefined;
}

function specifiersOf(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  return source.statements
    .map(moduleOf)
    .filter((name): name is string => name !== undefined);
}

function resolveLocal(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const found = [`${base}.ts`, join(base, 'index.ts')].find(existsSync);
  if (!found) throw new Error(`${from}: cannot resolve ${specifier}`);
  return found;
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(specifier);
}

/** Every package the entry's import graph reaches, outside Node itself. */
function packagesReachedFrom(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const queue = [join(SRC, entry)];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) queue.push(resolveLocal(file, specifier));
      else if (!isBuiltin(specifier)) packages.add(packageOf(specifier));
    }
  }
  return packages;
}

describe('the production image holds production dependencies only', () => {
  it.each(PRODUCTION_ENTRIES)('%s reaches no devDependency', (entry) => {
    const reached = [...packagesReachedFrom(entry)];
    const missing = reached.filter((name) => !manifest.dependencies[name]);
    expect(missing).toEqual([]);
  });

  // Guards the guard: an import graph this walk failed to follow would pass
  // the test above by reaching nothing.
  it('follows the whole graph', () => {
    expect([...packagesReachedFrom('main.ts')]).toEqual(
      expect.arrayContaining(['@nestjs/core', 'pg', 'stripe', 'pdfkit']),
    );
    expect([...packagesReachedFrom('db/migrate.main.ts')]).toEqual(
      expect.arrayContaining(['drizzle-orm', 'pg', 'zod']),
    );
  });
});

/**
 * Everything `nest build` compiles ships: the prod stage copies all of dist/.
 * A file that does something when loaded is a script anyone can run there
 * with `node dist/...`, as the image's admin processes are run. The dev seeder
 * is one: it wipes the `acme` tenant and recreates admin@acme.test with the
 * password the README publishes, so in the image it is one command away from
 * the production database. Only the production entry points may run on load;
 * dev scripts run from source with tsx, and tsconfig.build.json leaves them out.
 */

/** The files tsconfig.build.json compiles, relative to src/, as tsc reads it. */
function compiledByTheBuild(): string[] {
  const configPath = join(REPO_ROOT, 'tsconfig.build.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    const { messageText } = read.error;
    throw new Error(ts.flattenDiagnosticMessageText(messageText, '\n'));
  }
  const { fileNames } = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    REPO_ROOT,
    undefined,
    configPath,
  );
  return fileNames.map((file) => relative(SRC, file));
}

/** Whether loading the file runs code: a top-level statement like `void seed();`. */
function runsWhenLoaded(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(SRC, file), 'utf8'),
    ts.ScriptTarget.Latest,
  );
  return source.statements.some((statement) =>
    ts.isExpressionStatement(statement),
  );
}

describe('the production build compiles no dev script', () => {
  // Also guards itself: a config this failed to read would compile nothing,
  // and nothing is not the entry points.
  it('only the production entry points run on load', () => {
    const runnable = compiledByTheBuild().filter(runsWhenLoaded);
    expect(runnable.sort()).toEqual([...PRODUCTION_ENTRIES].sort());
  });
});
