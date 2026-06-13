import { describe, expect, it } from "vitest";
import { enforceRequestBodyLimit } from "../src/lib/request-body.server";

describe("request body boundary", () => {
  it("rejects an oversized body even without a content-length header", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: new Uint8Array(257),
    });
    request.headers.delete("content-length");

    const result = await enforceRequestBodyLimit(request, 256);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("preserves an accepted request body for downstream handlers", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: "accepted",
    });

    const result = await enforceRequestBodyLimit(request, 256);

    expect(result).toBeInstanceOf(Request);
    expect(result).toBe(request);
    expect(await (result as Request).text()).toBe("accepted");
  });

  it("times out a body that never finishes streaming", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const result = await enforceRequestBodyLimit(request, 256, 10);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(408);
  });
});
