import { describe, expect, it } from "vitest";
import { readBoundedBytes, readBoundedText } from "../src/lib/upstream-response.server";

describe("bounded upstream responses", () => {
  it("reads accepted text and bytes", async () => {
    await expect(readBoundedText(new Response("accepted"), 32)).resolves.toBe("accepted");
    await expect(readBoundedBytes(new Response("accepted"), 32)).resolves.toHaveLength(8);
  });

  it("rejects oversized declared and streamed responses", async () => {
    await expect(
      readBoundedText(new Response("small", { headers: { "content-length": "100" } }), 10),
    ).rejects.toThrow("byte limit");

    await expect(
      readBoundedText(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("too large"));
              controller.close();
            },
          }),
        ),
        4,
      ),
    ).rejects.toThrow("byte limit");
  });
});
