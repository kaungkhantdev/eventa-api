import { DiscountCodeGenerator } from './discount-code.generator';

describe('DiscountCodeGenerator (US-TKT-07)', () => {
  const generator = new DiscountCodeGenerator();

  it('proposes a memorable word-plus-number code', () => {
    expect(generator.generate(new Set())).toMatch(/^[A-Z]+\d{2}$/);
  });

  it('never proposes one that already exists', () => {
    // Everything the generator could reach on its first pass is taken.
    const taken = new Set<string>();
    for (let i = 0; i < 500; i++) taken.add(generator.generate(taken));
    expect(taken.size).toBe(500); // 500 distinct codes, no collisions
  });

  it('keeps going when its whole vocabulary is taken', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const code = generator.generate(taken);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
  });

  it('only produces codes the policy would accept', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generator.generate(taken);
      expect(code).toMatch(/^[A-Z0-9-]{3,24}$/);
      taken.add(code);
    }
  });
});
