/**
 * Seed local/test data. Run: `pnpm seed`.
 *
 * Target (development-guide §6): ≥2 tenants, events across states, ticket types,
 * test cards, sandbox PromptPay. Stubbed until the domain schema exists
 * (see ../../../eventa-docs/04-architecture/entities.md).
 */
function seed(): void {
  console.log(
    '[seed] no domain tables yet — translate entities.md into src/db/schema first.',
  );
}

seed();
