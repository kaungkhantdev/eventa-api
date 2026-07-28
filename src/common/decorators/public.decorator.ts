import { SetMetadata } from '@nestjs/common';

/** Marks a route (or controller) as not requiring an authenticated session. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
