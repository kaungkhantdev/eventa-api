import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { DomainException } from '../errors/domain.exception';
import { type AuthContext, Persona } from '../../modules/auth/auth.types';

/**
 * Organizer-console gate: only the `admin` persona may reach event-management
 * endpoints. Attendee tokens are refused (US-ACC-11 — the two audiences never
 * cross). Fine-grained per-key RBAC (evCreate/evPublish) is layered on next.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();
    if (req.user?.persona !== Persona.Admin) {
      throw DomainException.forbidden(
        'Organizer console access requires an admin account.',
      );
    }
    return true;
  }
}
