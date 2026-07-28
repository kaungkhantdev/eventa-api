import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PageMetaDto } from './paginated';

/**
 * Documents a response wrapped in the success envelope
 * `{ success, statusCode, message, data: <model>, timestamp }`. Pass `status`
 * for non-200 successes (e.g. 201 Created) so the spec matches the real code.
 */
export function ApiData<M extends Type<unknown>>(
  model: M,
  status: number = HttpStatus.OK,
) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          statusCode: { type: 'number', example: status },
          message: { type: 'string' },
          data: { $ref: getSchemaPath(model) },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    }),
  );
}

/**
 * Documents a paginated success envelope: `data` is an ARRAY of the model plus a
 * `meta` PageMeta block. Use on list endpoints that return `Paginated<T>` — the
 * openapi.json is the api↔web contract, so the array + meta must be accurate.
 */
export function ApiPage<M extends Type<unknown>>(
  model: M,
  status: number = HttpStatus.OK,
) {
  return applyDecorators(
    ApiExtraModels(model, PageMetaDto),
    ApiResponse({
      status,
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          statusCode: { type: 'number', example: status },
          message: { type: 'string' },
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMetaDto) },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    }),
  );
}
