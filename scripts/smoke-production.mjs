import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT || 4199);
const origin = `http://127.0.0.1:${port}`;
const output = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init) {
  return fetch(`${origin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/healthz");
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Production server did not become healthy within 30 seconds.");
}

const child = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output.push(chunk.toString());
    if (output.length > 100) output.shift();
  });
}

try {
  await waitForHealth();

  const health = await request("/healthz");
  assert(health.status === 200, `/healthz returned ${health.status}.`);
  assert(health.headers.get("cache-control") === "no-store", "/healthz must not be cached.");
  assert(health.headers.has("x-request-id"), "/healthz is missing a request ID.");

  const ready = await request("/readyz?strict=1");
  assert(ready.status === 200, `/readyz?strict=1 returned ${ready.status}.`);

  const home = await request("/");
  const homeHtml = await home.text();
  assert(home.status === 200, `/ returned ${home.status}.`);
  assert(home.headers.has("content-security-policy"), "/ is missing its CSP.");
  assert(homeHtml.includes("Leethe"), "/ did not render the application shell.");

  const legal = await request("/legal");
  assert(legal.status === 200, `/legal returned ${legal.status}.`);

  const robots = await request("/robots.txt");
  assert(robots.status === 200, `/robots.txt returned ${robots.status}.`);
  assert((await robots.text()).includes("Sitemap:"), "/robots.txt is missing its sitemap.");

  const sitemap = await request("/sitemap.xml");
  assert(sitemap.status === 200, `/sitemap.xml returned ${sitemap.status}.`);

  const assetPath = homeHtml.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  assert(assetPath, "Could not find a built asset in the rendered HTML.");
  const asset = await request(assetPath);
  assert(asset.status === 200, `${assetPath} returned ${asset.status}.`);
  assert(
    asset.headers.get("cache-control")?.includes("immutable"),
    "Built assets must use immutable caching.",
  );

  const oversized = await request("/", {
    method: "POST",
    body: "x".repeat(256_001),
    headers: { "content-type": "text/plain" },
  });
  assert(oversized.status === 413, `Oversized request returned ${oversized.status}.`);

  const chunkedOversized = await request("/", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(256_001)));
        controller.close();
      },
    }),
    duplex: "half",
    headers: { "content-type": "text/plain" },
  });
  assert(
    chunkedOversized.status === 413,
    `Chunked oversized request returned ${chunkedOversized.status}.`,
  );

  console.log(
    JSON.stringify({
      level: "info",
      event: "production_smoke_passed",
      origin,
      checks: 10,
    }),
  );
} catch (error) {
  process.stderr.write(output.join("").slice(-10_000));
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
