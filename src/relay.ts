/**
 * Outbox relay — a SEPARATE deployable from the HTTP API (same image, different
 * entrypoint). Polls the `outbox` table and publishes events to RabbitMQ with
 * publisher confirms, then marks them dispatched. This is how side effects leave
 * the API without dual-writing (development-guide §8, SAD §6.3/§7.2).
 *
 * Stub — implemented once the `outbox` table and the first producer events land.
 * Run in dev with `pnpm relay`; in prod as `node dist/relay`.
 */
function bootstrap(): void {
  console.log(
    '[relay] outbox relay not yet implemented — awaiting outbox table.',
  );
}

bootstrap();
