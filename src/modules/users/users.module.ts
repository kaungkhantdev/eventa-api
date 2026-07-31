import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository';

/**
 * User records: the `users` table reads other contexts need (profile lookups,
 * sign-in lookup, last-active). Exposes its repository as the typed interface —
 * no other module touches the table directly.
 */
@Module({
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
