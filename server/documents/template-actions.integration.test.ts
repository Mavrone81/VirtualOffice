import { describe, it, expect, afterAll, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "11111111-1111-1111-1111-111111111111", role: "Admin" } }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import * as storage from "@/lib/storage";
import { getObject } from "@/lib/storage";
import { uploadDocTemplate, type DocTemplateUploadResult } from "./template-actions";
import type { TemplateCategory } from "@prisma/client";

const TAG = "B5TPL-";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...new Array(20).fill(0x41)]);
const file = (name: string) => new File([PDF], name);

afterAll(async () => {
  await prisma.document.deleteMany({ where: { title: { startsWith: TAG } } });
});

/**
 * Fires two uploads at the SAME category "simultaneously", synchronized on a
 * two-party barrier at `putObject` (the step just before each call starts its
 * own transaction) so neither resolves it until both have called it. That
 * closes most of the scheduling gap, but on a fast loopback Postgres the two
 * transactions still sometimes complete fully sequentially (one commits
 * before the other's query is even dispatched) — not a bug, just not the
 * race this helper exists to exercise. So this retries, checking the
 * invariant unconditionally on every attempt, until it has actually observed
 * genuine contention (one winner, one conflict), rather than hoping a single
 * Promise.all happens to land in the window. Same lesson as the
 * streaming-upload fix: force the exact interleaving, don't hope for it; the
 * difference here is the window can't be forced any tighter than this from
 * outside Postgres's own scheduler, so the test proves reachability across
 * attempts instead of on attempt one.
 */
async function raceTwiceUntilContended(
  category: TemplateCategory,
  label: string,
): Promise<{ results: [DocTemplateUploadResult, DocTemplateUploadResult]; writtenKeys: string[]; deletedKeys: string[] }> {
  for (let attempt = 1; attempt <= 15; attempt++) {
    let waiters: Array<() => void> = [];
    const barrier = () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
        if (waiters.length === 2) {
          const toRelease = waiters;
          waiters = [];
          toRelease.forEach((r) => r());
        }
      });
    const realPutObject = storage.putObject;
    const putSpy = vi.spyOn(storage, "putObject").mockImplementation(async (key: string, data: Buffer) => {
      await barrier();
      return realPutObject(key, data);
    });
    const deleteSpy = vi.spyOn(storage, "deleteObject");

    const results = await Promise.all([
      uploadDocTemplate({ category, title: `${TAG}${label}-${attempt}-a`, file: file("a.pdf") }),
      uploadDocTemplate({ category, title: `${TAG}${label}-${attempt}-b`, file: file("b.pdf") }),
    ]);

    // Unconditional on EVERY attempt, racing or not: exactly one live row for
    // this category, never two, never zero.
    const live = await prisma.document.findMany({ where: { category, retiredAt: null } });
    expect(live).toHaveLength(1);

    const writtenKeys = putSpy.mock.calls.map((c) => c[0] as string);
    const deletedKeys = deleteSpy.mock.calls.map((c) => c[0] as string);
    putSpy.mockRestore();
    deleteSpy.mockRestore();

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    if (winners.length === 1 && losers.length === 1) {
      return { results: results as [DocTemplateUploadResult, DocTemplateUploadResult], writtenKeys, deletedKeys };
    }
    // No real contention this attempt (both succeeded sequentially) — the
    // category now has a new "current" row either way, so the next attempt
    // just races again against it.
  }
  throw new Error(`raceTwiceUntilContended: never observed genuine contention on category ${category} after 15 attempts`);
}

describe("uploadDocTemplate (real DB — the retire/supersede guarantee)", () => {
  it("a single, non-racing replace: the old row gets BOTH retiredAt and supersededById set, and the category query returns exactly one row — the new one", async () => {
    const first = await uploadDocTemplate({ category: "PetsAfterlife", title: TAG + "seq-1", file: file("a.pdf") });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await uploadDocTemplate({ category: "PetsAfterlife", title: TAG + "seq-2", file: file("b.pdf") });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const oldRow = await prisma.document.findUnique({ where: { id: first.id } });
    expect(oldRow?.retiredAt).not.toBeNull();
    expect(oldRow?.supersededById).toBe(second.id);

    const live = await prisma.document.findMany({ where: { category: "PetsAfterlife", retiredAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(second.id); // by id, not just "a row exists"

    // The chain target isn't just a stored value — it resolves to a real,
    // currently-live row (belt-and-braces alongside the FK).
    const target = await prisma.document.findUnique({ where: { id: oldRow!.supersededById! } });
    expect(target?.id).toBe(second.id);
    expect(target?.retiredAt).toBeNull();
  });

  it("two concurrent replaces for the SAME category (one already has a current row): exactly one live row survives, by id — not 'at most one' — and the loser's file is deleted, not leaked", async () => {
    const { results, writtenKeys, deletedKeys } = await raceTwiceUntilContended("PetsAfterlife", "replace-race");

    const winner = results.find((r) => r.ok)!;
    const loser = results.find((r) => !r.ok)! as { ok: false; error: string };
    expect(loser.error).toBe("form.errorConflict"); // friendly message, never an unhandled throw / 500

    const live = await prisma.document.findMany({ where: { category: "PetsAfterlife", retiredAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe((winner as { ok: true; id: string }).id);

    // Both calls wrote a file before touching the DB — set membership, not
    // call-order (Promise.all doesn't guarantee which call's putObject lands
    // first in the mock's call list).
    expect(writtenKeys).toHaveLength(2);
    expect(new Set(writtenKeys).size).toBe(2);

    // The loser's write must not survive the lost race — a friendly message
    // plus a leaked file is a half-fix.
    expect(deletedKeys).toHaveLength(1);
    const deletedKey = deletedKeys[0];
    expect(writtenKeys).toContain(deletedKey);
    expect(deletedKey).not.toBe(live[0].fileKey);

    expect(await getObject(live[0].fileKey)).not.toBeNull(); // winner's file survives
    expect(await getObject(deletedKey)).toBeNull(); // loser's file is gone
  });

  it("two concurrent replaces for a category with NO current row yet: exactly one live row survives (the partial index alone must catch this, with no existing row to serialize a lock on)", async () => {
    const { results } = await raceTwiceUntilContended("HumanAfterlife", "first-race");
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const live = await prisma.document.findMany({ where: { category: "HumanAfterlife", retiredAt: null } });
    expect(live).toHaveLength(1);
  });
});
