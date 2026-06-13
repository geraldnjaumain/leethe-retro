export const MAX_REQUEST_BODY_BYTES = 256_000;
export const MAX_REQUEST_BODY_READ_MS = 10_000;

async function readBeforeDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Request body timeout.");

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Request body timeout.")), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function enforceRequestBodyLimit(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES,
  timeoutMs = MAX_REQUEST_BODY_READ_MS,
): Promise<Request | Response> {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) return request;

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return new Response("Request body too large.", { status: 413 });
  }

  const inspectionRequest = request.clone();
  const reader = inspectionRequest.body!.getReader();
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  try {
    while (true) {
      const { done, value } = await readBeforeDeadline(reader, deadline);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return new Response("Request body too large.", { status: 413 });
      }
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof Error && error.message === "Request body timeout.") {
      return new Response("Request body timeout.", { status: 408 });
    }
    throw error;
  }

  return request;
}
