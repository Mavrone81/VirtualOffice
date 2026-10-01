import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { listActiveCollections, listAllCollections } from "./list-assets";

const TAG = "B9LA-";

afterAll(async () => {
  const collections = await prisma.marketingCollection.findMany({ where: { name: { startsWith: TAG } } });
  for (const c of collections) await prisma.marketingAsset.deleteMany({ where: { collectionId: c.id } });
  await prisma.marketingCollection.deleteMany({ where: { name: { startsWith: TAG } } });
});

async function makeCollection(name: string, archived = false) {
  return prisma.marketingCollection.create({
    data: { category: "EDMs", name: TAG + name, archivedAt: archived ? new Date() : null },
  });
}

async function makeAsset(collectionId: string, name: string, archived = false) {
  return prisma.marketingAsset.create({
    data: {
      collectionId,
      fileKey: `marketing/${TAG}${name}.pdf`,
      fileName: TAG + name,
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: `${TAG}${name}`.padEnd(64, "0"),
      archivedAt: archived ? new Date() : null,
    },
  });
}

describe("listActiveCollections / listAllCollections (ADR-0002: no expiry means hidden, not deleted)", () => {
  it("an archived collection is excluded from the active list but present in the all-list", async () => {
    const c = await makeCollection("archived-col", true);
    const active = await listActiveCollections("EDMs" as never);
    const all = await listAllCollections("EDMs" as never);
    expect(active.some((x) => x.id === c.id)).toBe(false);
    expect(all.some((x) => x.id === c.id)).toBe(true);
  });

  it("an archived asset inside an active collection is excluded from the active list's assets but present in the all-list's", async () => {
    const c = await makeCollection("active-col");
    const asset = await makeAsset(c.id, "archived-asset", true);
    const active = await listActiveCollections("EDMs" as never);
    const all = await listAllCollections("EDMs" as never);
    const activeCol = active.find((x) => x.id === c.id);
    const allCol = all.find((x) => x.id === c.id);
    expect(activeCol?.assets.some((a) => a.id === asset.id)).toBe(false);
    expect(allCol?.assets.some((a) => a.id === asset.id)).toBe(true);
  });

  it("an active asset in an active collection is on both lists", async () => {
    const c = await makeCollection("both-col");
    const asset = await makeAsset(c.id, "both-asset");
    const active = await listActiveCollections("EDMs" as never);
    expect(active.find((x) => x.id === c.id)?.assets.some((a) => a.id === asset.id)).toBe(true);
  });
});
