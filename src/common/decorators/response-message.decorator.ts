import { SetMetadata } from '@nestjs/common';

/** Sets the `message` field of the success envelope for a route. */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
