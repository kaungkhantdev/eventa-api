import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '../../common/decorators/require-permissions.decorator';
import { DomainException } from '../../common/errors/domain.exception';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { PermissionsService } from '../access/permissions.service';
import { DEFAULT_ROLES } from '../access/workspace-defaults';
import { MessageDeliveriesController } from './message-deliveries.controller';

/**
 * Who may open and export the delivery log (US-MSG-03/06/07), proved against
 * the controller's own decorators through the real guard, so a gate moved or
 * dropped on either the class or a route fails here.
 */

type Route = 'list' | 'kinds' | 'exportCsv';

const grantsOf = (name: string): PermissionKey[] => {
  const role = DEFAULT_ROLES.find((r) => r.name === name);
  if (!role) throw new Error(`No default role ${name}`);
  return role.grants;
};

function contextFor(route: Route): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { organizationId: 1, userId: 'u1' } }),
    }),
    getHandler: () => MessageDeliveriesController.prototype[route],
    getClass: () => MessageDeliveriesController,
  } as unknown as ExecutionContext;
}

async function attempt(
  grants: PermissionKey[],
  route: Route,
): Promise<number | true> {
  const permissions = {
    getFor: jest.fn().mockResolvedValue(grants),
  } as unknown as PermissionsService;
  const guard = new PermissionsGuard(new Reflector(), permissions);
  try {
    return await guard.canActivate(contextFor(route));
  } catch (err) {
    if (err instanceof DomainException) return err.getStatus();
    throw err;
  }
}

describe('MessageDeliveriesController permissions (US-MSG-03/06/07)', () => {
  it.each<Route>(['list', 'kinds', 'exportCsv'])(
    'denies Staff the %s route, though Staff can view registrations',
    async (route) => {
      // US-MSG-03: a Staff member cannot view the delivery log. Staff hold
      // `regView`, so that key alone cannot be the gate.
      expect(grantsOf('Staff')).toContain('regView');
      await expect(attempt(grantsOf('Staff'), route)).resolves.toBe(403);
    },
  );

  it.each<Route>(['list', 'kinds', 'exportCsv'])(
    'lets an Organizer use the %s route',
    async (route) => {
      await expect(attempt(grantsOf('Organizer'), route)).resolves.toBe(true);
    },
  );

  it('lets a role without the export permission read the log', async () => {
    const reader: PermissionKey[] = ['regView', 'regManage'];
    await expect(attempt(reader, 'list')).resolves.toBe(true);
    await expect(attempt(reader, 'kinds')).resolves.toBe(true);
  });

  it('refuses that role the export (US-MSG-07)', async () => {
    // The file carries attendee contact data in bulk, so it needs the
    // attendee-export permission, not just access to the log.
    await expect(attempt(['regView', 'regManage'], 'exportCsv')).resolves.toBe(
      403,
    );
  });
});
