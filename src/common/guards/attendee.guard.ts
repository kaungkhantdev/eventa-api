import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { DomainException } from '../errors/domain.exception';
import { type AuthContext, Persona } from '../../modules/auth/auth.types';

/**
 * Attendee-realm gate, AdminGuard's counterpart: only the `attendee` persona may
 * reach the attendee's own tickets, payments and saved events. An organizer's
 * token is refused even when it carries the same email (US-ACC-11, NFR-SEC-01 —
 * access across the boundary is impossible, not merely hidden by the web).
 */
@Injectable()
export class AttendeeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();
    if (req.user?.persona !== Persona.Attendee) {
      throw DomainException.forbidden(
        'This page belongs to an attendee account — sign in as an attendee.',
      );
    }
    return true;
  }
}
