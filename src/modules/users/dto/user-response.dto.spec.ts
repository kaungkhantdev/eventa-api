import type { OrganizationRow, UserRow } from '../../auth/auth.types';
import { toMeResponse } from './user-response.dto';

const user = {
  id: 'u1',
  name: 'Acme Admin',
  email: 'admin@acme.test',
  persona: 'admin',
  status: 'Active',
  twoFactorEnabled: false,
} as UserRow;

const org = (logoUrl: string | null) =>
  ({
    id: 1,
    name: 'Testing One',
    slug: 'testing-one',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    locale: 'en',
    logoUrl,
  }) as OrganizationRow;

/*
 * The console's rail shows the signed-in workspace's own logo, and the
 * workspace this summary describes is the only one the session can see.
 */
describe('toMeResponse', () => {
  it("carries the workspace's logo", () => {
    const logo = 'http://localhost:9000/eventa-uploads/org/1/logos/a.png';
    expect(toMeResponse(user, org(logo), []).organization.logoUrl).toBe(logo);
  });

  it('says null when the workspace has no logo', () => {
    expect(toMeResponse(user, org(null), []).organization.logoUrl).toBeNull();
  });
});
