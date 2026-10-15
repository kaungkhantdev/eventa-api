import type { Request } from 'express';
import type { AuthContext } from '../auth/auth.types';
import type { Actor } from './access.types';

/** The signed-in caller and the address the request came from. */
export function actorOf(auth: AuthContext, req: Request): Actor {
  return { userId: auth.userId, ip: req.ip ?? null };
}
