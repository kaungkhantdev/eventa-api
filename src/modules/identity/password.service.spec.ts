import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes then verifies a password, and rejects the wrong one', async () => {
    const secret = 'correct horse battery staple';
    const hash = await service.hash(secret);

    expect(hash).not.toContain(secret);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hash, secret)).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong password')).resolves.toBe(false);
  });
});
