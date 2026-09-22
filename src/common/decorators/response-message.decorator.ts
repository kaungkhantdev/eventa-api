import { SetMetadata } from '@nestjs/common';

/**
 * Reads the message off what the handler answered, for a route whose outcome is
 * not fixed — a broadcast that went out now versus one recorded for later. A
 * literal there would tell half the callers the wrong thing.
 */
export type ResponseMessageResolver<T> = (data: T) => string;

/** Sets the `message` field of the success envelope for a route. */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';
export const ResponseMessage = <T = unknown>(
  message: string | ResponseMessageResolver<T>,
) => SetMetadata(RESPONSE_MESSAGE_KEY, message);
