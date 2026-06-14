import { describe, expect, it } from "vitest";
import {
  catalogShardAdminUrls,
  catalogShardAppUrls,
  catalogShardIndex,
  groupRecordsByCatalogShard,
} from "../scripts/lib/catalog-shards.mjs";

describe("catalog shard configuration", () => {
  it("keeps the existing database as the default single shard", () => {
    expect(catalogShardAppUrls({ DATABASE_URL: "postgres://control/db" })).toEqual([
      "postgres://control/db",
    ]);
  });

  it("routes a title deterministically by TMDB id", () => {
    expect(catalogShardIndex(9, 3)).toBe(0);
    expect(catalogShardIndex(10, 3)).toBe(1);
    expect(catalogShardIndex(11, 3)).toBe(2);
    expect(catalogShardIndex("999999999999", 3)).toBe(0);
  });

  it("groups title writes into their target shards", () => {
    expect(groupRecordsByCatalogShard([{ tmdb_id: 4 }, { tmdb_id: 5 }, { tmdb_id: 8 }], 2)).toEqual(
      [[{ tmdb_id: 4 }, { tmdb_id: 8 }], [{ tmdb_id: 5 }]],
    );
  });

  it("requires admin shard URLs before migrating configured shards", () => {
    expect(() =>
      catalogShardAdminUrls({
        DATABASE_ADMIN_URL: "postgres://control-admin/db",
        CATALOG_DATABASE_SHARD_URLS: "postgres://shard-a/db,postgres://shard-b/db",
      }),
    ).toThrow(/CATALOG_DATABASE_SHARD_ADMIN_URLS/);
  });
});
