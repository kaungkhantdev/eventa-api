import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException } from '../errors/domain.exception';
import { PermissionsService } from '../../modules/access/permissions.service';
import { PermissionsGuard } from './permissions.guard';

function contextWith(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const auth = { organizationId: 1, userId: 'u1' };

describe('PermissionsGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let permissions: jest.Mocked<PermissionsService>;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    permissions = {
      getFor: jest.fn(),
    } as unknown as jest.Mocked<PermissionsService>;
    guard = new PermissionsGuard(reflector, permissions);
  });

  it('allows when the route requires no permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(contextWith(auth))).resolves.toBe(true);
    expect(permissions.getFor).not.toHaveBeenCalled();
  });

  it('allows when the caller holds every required key', async () => {
    reflector.getAllAndOverride.mockReturnValue(['evCreate']);
    permissions.getFor.mockResolvedValue(['evCreate', 'evPublish']);

    await expect(guard.canActivate(contextWith(auth))).resolves.toBe(true);
    expect(permissions.getFor).toHaveBeenCalledWith(1, 'u1');
  });

  it('forbids (403) when a required key is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue(['evCreate']);
    permissions.getFor.mockResolvedValue(['regView']);

    const err = await guard
      .canActivate(contextWith(auth))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).getStatus()).toBe(403);
  });
});
