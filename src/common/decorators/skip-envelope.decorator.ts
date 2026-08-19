import { SetMetadata } from '@nestjs/common';

/** Opt a route (or controller) out of the `{ data }` response envelope (e.g. health probes). */
export const SKIP_ENVELOPE_KEY = 'skipResponseEnvelope';
export const SkipResponseEnvelope = () => SetMetadata(SKIP_ENVELOPE_KEY, true);
