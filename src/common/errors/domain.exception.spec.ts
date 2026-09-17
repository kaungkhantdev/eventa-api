import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception';
import { ErrorCode } from './error-codes';

interface Body {
  code: ErrorCode;
  message: string;
  errors?: { field: string; message: string }[];
}

const bodyOf = (e: DomainException) => e.getResponse() as Body;

describe('DomainException', () => {
  /**
   * A rule the caller broke in one named field.
   *
   * The name is the point. Without it a client can only drop the sentence at
   * the foot of the form and hope the reader works out which input it means —
   * or match on the message text, which stops working the moment the copy is
   * translated. The field travels in the envelope's `errors` array, the same
   * one class-validator fills, so nothing downstream needs to learn a second
   * shape.
   */
  describe('a validation failure that names its field', () => {
    it('carries the field beside the message', () => {
      const refusal = DomainException.invalidField(
        'taxId',
        'Tax ID must be the 13-digit Thai VAT registration number.',
      );

      expect(bodyOf(refusal).errors).toEqual([
        {
          field: 'taxId',
          message: 'Tax ID must be the 13-digit Thai VAT registration number.',
        },
      ]);
    });

    it('still reads as a sentence for anything not showing a form', () => {
      const refusal = DomainException.invalidField(
        'website',
        'Website must be a valid http(s) address.',
      );

      expect(bodyOf(refusal).message).toBe(
        'Website must be a valid http(s) address.',
      );
    });

    it('is the same status and code as any other validation failure', () => {
      const refusal = DomainException.invalidField('taxId', 'No.');

      expect(refusal.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(bodyOf(refusal).code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('a validation failure with no field to blame', () => {
    it('sends no errors array at all, rather than an empty one', () => {
      // An empty array would read as "there were field errors, none of them
      // about a field", which is not a thing.
      const refusal = DomainException.validation('Validation failed');

      expect(bodyOf(refusal).errors).toBeUndefined();
    });
  });
});
