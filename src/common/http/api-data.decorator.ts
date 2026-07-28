import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/** Documents a 200 response wrapped in the `{ data: <model> }` envelope. */
export function ApiData<M extends Type<unknown>>(model: M) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        properties: { data: { $ref: getSchemaPath(model) } },
      },
    }),
  );
}
