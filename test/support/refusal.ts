import type { DomainException } from '../../src/common/errors/domain.exception';

/**
 * What a call was refused with — and a failed test if it was not refused.
 *
 * `.catch((e) => e)` types the result as "the value OR the error" and passes
 * quietly when the call succeeds, which is the one outcome a refusal test
 * exists to rule out.
 */
export async function refusalOf(
  call: Promise<unknown>,
): Promise<DomainException> {
  try {
    await call;
  } catch (error) {
    return error as DomainException;
  }
  throw new Error('Expected the call to be refused, but it succeeded.');
}
