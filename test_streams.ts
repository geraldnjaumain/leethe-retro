import { resolveStreams } from "./src/lib/moviebox.server";

async function test() {
  const result = await resolveStreams("Game of Thrones", "tv", "1399", 1, 1);
  if (result.streams && result.streams.length > 0) {
    console.log("extCaptions:", JSON.stringify(result.streams[0].extCaptions, null, 2));
  }
}
test().catch(console.error);
