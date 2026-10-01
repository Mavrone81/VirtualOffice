import { describe, it, expect, vi, beforeEach } from "vitest";

// Lives under server/ so the vitest include picks it up (route handlers
// aren't covered directly) — same pattern as lib/bankfile-route-origin.test.ts
// and lib/post-routes-origin.test.ts. Exercises the real route handlers.

const state = { flagOn: true, session: { user: { id: "admin1", role: "Admin" } } as unknown };

vi.mock("@/lib/env", () => ({ get env() { return { MARKETING_LIBRARY_ENABLED: state.flagOn }; } }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => state.session) }));
vi.mock("@/lib/rbac", () => ({ isAdminRole: (r: string) => r === "Admin" }));
vi.mock("@/server/marketing/upload", () => ({ receiveMarketingUpload: vi.fn(async () => ({ ok: true, id: "asset1", duplicate: false, warnNearCap: false })) }));
const ASSET_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/lib/db", () => ({
  prisma: { marketingAsset: { findUnique: vi.fn(async () => ({ id: ASSET_ID, fileKey: "marketing/x.pdf", fileName: "x.pdf", archivedAt: null, collection: { archivedAt: null } })) } },
}));
function bufferToWebStream(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}
vi.mock("@/lib/storage", () => ({
  openObjectStream: vi.fn(async () => ({ stream: bufferToWebStream(Buffer.from("%PDF-1.4")), size: 8 })),
  objectResponseHeaders: () => ({ "Content-Type": "application/pdf" }),
}));

import { POST as upload } from "@/app/admin/marketing/upload/route";
import { GET as serveFile } from "@/app/marketing/files/[id]/route";
import { receiveMarketingUpload } from "@/server/marketing/upload";
import { auth } from "@/auth";

const SAME = { host: "vo.example.com", origin: "https://vo.example.com" };

function postUpload(headers: Record<string, string>) {
  return upload(new Request("https://vo.example.com/admin/marketing/upload?collectionId=col1", { method: "POST", headers }));
}
function getFile() {
  return serveFile(new Request(`https://vo.example.com/marketing/files/${ASSET_ID}`), { params: Promise.resolve({ id: ASSET_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.flagOn = true;
  state.session = { user: { id: "admin1", role: "Admin" } };
});

describe("build-now-ship-later: MARKETING_LIBRARY_ENABLED gates the routes, not just the nav", () => {
  it("upload route: flag OFF → 404, even for an admin with a valid same-origin request", async () => {
    state.flagOn = false;
    const res = await postUpload(SAME);
    expect(res.status).toBe(404);
    expect(auth).not.toHaveBeenCalled();
    expect(receiveMarketingUpload).not.toHaveBeenCalled();
  });

  it("upload route: flag ON, same-origin, admin → delegates to receiveMarketingUpload", async () => {
    const res = await postUpload(SAME);
    expect(res.status).toBe(200);
    expect(receiveMarketingUpload).toHaveBeenCalledWith(expect.objectContaining({ collectionId: "col1", actorUserId: "admin1" }));
  });

  it("upload route: flag ON but foreign Origin → 403 (U1 still enforced when the feature is live)", async () => {
    const res = await postUpload({ host: "vo.example.com", origin: "https://evil.example.net" });
    expect(res.status).toBe(403);
    expect(receiveMarketingUpload).not.toHaveBeenCalled();
  });

  it("file route: flag OFF → 404, even for a signed-in user", async () => {
    state.flagOn = false;
    const res = await getFile();
    expect(res.status).toBe(404);
    expect(auth).not.toHaveBeenCalled();
  });

  it("file route: flag ON → streams the file with a Content-Length from the real file size", async () => {
    const res = await getFile();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("8");
    expect(await res.text()).toBe("%PDF-1.4");
  });

  it("file route: a missing file on disk → 404 (openObjectStream returned null)", async () => {
    const { openObjectStream } = await import("@/lib/storage");
    (openObjectStream as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await getFile();
    expect(res.status).toBe(404);
  });

  it("file route: a malformed (non-UUID) id 404s cleanly instead of a 500 (K3 precedent)", async () => {
    const { prisma } = await import("@/lib/db");
    const res = await serveFile(new Request("https://vo.example.com/marketing/files/not-a-uuid"), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(404);
    expect(prisma.marketingAsset.findUnique).not.toHaveBeenCalled();
  });
});
