import type { Response } from 'supertest';

/**
 * Collect a response body as BYTES, for the routes that answer with a file.
 *
 * supertest's default parser decodes the body to a string, which corrupts a
 * workbook or a PDF at the first byte that is not valid UTF-8 — the assertions
 * would then fail on a file the product actually served correctly.
 *
 * Used as `.buffer(true).parse(binary)`, after which `res.body` is a Buffer.
 */
export function binary(
  res: Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
}
