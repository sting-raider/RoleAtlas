import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedBody } from "../lib/boundedBody.ts";
import { MAX_RESUME_BYTES } from "../lib/resumeExtract.ts";

/** Builds a Request whose body streams `chunkCount` chunks of `chunkSize`
 * bytes, recording every pull and cancel so tests can observe consumption. */
function streamingRequest(options: {
  chunkCount: number;
  chunkSize: number;
  declaredLength?: string;
  onPull?: () => void;
  onCancel?: () => void;
}): Request {
  const { chunkCount, chunkSize, declaredLength, onPull, onCancel } = options;
  const chunk = new Uint8Array(chunkSize).fill(0x41);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.();
      if (sent < chunkCount) {
        controller.enqueue(chunk);
        sent += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      onCancel?.();
    },
  });
  const headers: Record<string, string> =
    declaredLength === undefined ? {} : { "content-length": declaredLength };
  return new Request("http://roleatlas.local/upload", {
    method: "POST",
    headers,
    body: stream,
    // The DOM RequestInit type omits duplex although undici requires it for
    // streaming request bodies.
    duplex: "half",
  } as RequestInit);
}

test("a truthful oversized content-length is rejected before any byte is pulled", async () => {
  let pulls = 0;
  // Constructing a Request from a stream makes undici pull once on its own;
  // only pulls beyond that baseline would mean the body was consumed.
  const request = streamingRequest({
    chunkCount: 3,
    chunkSize: 16,
    declaredLength: String(MAX_RESUME_BYTES + 1),
    onPull: () => (pulls += 1),
  });
  const baselinePulls = pulls;
  // Give undici's own constructor-triggered pull a turn to land before
  // measuring anything readBoundedBody itself consumes.
  await new Promise((resolve) => setImmediate(resolve));
  const settledBaseline = Math.max(baselinePulls, pulls);
  const result = await readBoundedBody(request, MAX_RESUME_BYTES);
  assert.equal(result, null);
  assert.equal(pulls, settledBaseline, "the stream must stay untouched when the declaration alone exceeds the cap");
});

test("an under-cap body is delivered byte-for-byte", async () => {
  const payload = new Uint8Array(1024).map((_, index) => index % 251);
  const request = new Request("http://roleatlas.local/upload", {
    method: "POST",
    headers: { "content-length": String(payload.byteLength) },
    body: payload,
  });
  const result = await readBoundedBody(request, MAX_RESUME_BYTES);
  assert.ok(result);
  assert.equal(result.byteLength, payload.byteLength);
  assert.deepEqual([...result], [...payload]);
});

test("a body at exactly the cap passes", async () => {
  const result = await readBoundedBody(
    streamingRequest({ chunkCount: 2, chunkSize: 512, declaredLength: "1024" }),
    1024,
  );
  assert.ok(result);
  assert.equal(result.byteLength, 1024);
});

test("a lying content-length cannot smuggle an oversized stream past the counter", async () => {
  let cancelled = false;
  // Declares 32 bytes but streams far more than the 4 KiB cap.
  const result = await readBoundedBody(
    streamingRequest({
      chunkCount: 64,
      chunkSize: 512,
      declaredLength: "32",
      onCancel: () => (cancelled = true),
    }),
    4096,
  );
  assert.equal(result, null);
  assert.equal(cancelled, true, "the source stream must be cancelled once the cap is crossed");
});

test("a missing content-length with an oversized stream is still rejected", async () => {
  const result = await readBoundedBody(
    streamingRequest({ chunkCount: 4, chunkSize: 4096 }),
    8192,
  );
  assert.equal(result, null);
});
