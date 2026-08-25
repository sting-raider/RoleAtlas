//! Bounded reads for route-handler request bodies.
//!
//! Next.js caps Server Action bodies but leaves route handlers uncapped, so a
//! route that buffers before checking a length lets one request allocate
//! memory without limit. readBoundedBody enforces the ceiling on the wire: a
//! truthful oversized Content-Length is rejected before a byte is read, and
//! the stream itself is counted as it arrives so a lying or missing header
//! cannot balloon memory either.

/**
 * Reads at most `limitBytes` of a request body, or returns null when the
 * transfer exceeds the ceiling — by declaration or in fact.
 */
export async function readBoundedBody(
  request: Request,
  limitBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limitBytes) return null;

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > limitBytes) {
      // Crossed the ceiling mid-chunk: cancel the source and discard
      // everything from here on instead of buffering the remainder.
      await reader.cancel().catch(() => undefined);
      return null;
    }
    received += value.byteLength;
    chunks.push(value);
  }

  return concat(chunks, received);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
