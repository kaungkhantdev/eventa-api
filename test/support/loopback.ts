import type { INestApplication } from '@nestjs/common';

/**
 * Start a suite's app listening on LOOPBACK, before supertest touches it.
 *
 * Left to itself, supertest starts the server with `listen(0)` — every
 * interface — and then calls `127.0.0.1:<port>`. A developer machine has
 * plenty of programs (editors, chat apps, language servers) listening on
 * `127.0.0.1` at ports in that same range, and the OS will hand one of those
 * ports to an every-interface listener. The request then reaches the more
 * specific listener — somebody else's program — and a suite fails with a 404
 * or 401 that Eventa never sent, or "Parse Error: Expected HTTP/" from
 * something that does not speak HTTP. Which suite fails changes run to run.
 *
 * Listening on `127.0.0.1` itself makes the OS pick a port free at that exact
 * address, and supertest uses the address it finds rather than starting its
 * own. `app.close()` stops it as before.
 */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}
