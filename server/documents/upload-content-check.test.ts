import { describe, it, expect, vi, beforeEach } from "vitest";

// SEC-11: the admin document/notice uploads and the vendor-agreement upload used
// to store any bytes under any name. They must now reject content that is not an
// allowed type (and, for documents/notices, whose extension disagrees with it).
// Real lib/file-type; storage, DB and auth mocked.

const { prismaMock, putObjectMock, state } = vi.hoisted(() => ({
  prismaMock: {
    document: { create: vi.fn(async () => ({ id: "d1" })) },
    notice: { create: vi.fn(async () => ({ id: "n1" })) },
    vendorReferral: { create: vi.fn(async () => ({ id: "v1" })) },
    associate: { findUnique: vi.fn() },
  },
  putObjectMock: vi.fn(async () => undefined),
  state: { role: "Admin" },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({ putObject: putObjectMock, deleteObject: vi.fn() }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1", role: state.role, associateId: "a1" } }) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pdf/referral-agreement", () => ({ renderReferralAgreementPdfFromData: vi.fn() }));

import { uploadDocument } from "@/server/documents/actions";
import { createNotice } from "@/server/notices/actions";
import { submitVendor } from "@/server/vendors/actions";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DOCX = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00];
const HTML = [...new TextEncoder().encode("<html><script>alert(1)</script></html>")];
const file = (bytes: number[], name: string) => new File([new Uint8Array(bytes)], name);

const doc = (f: File) => uploadDocument({ title: "T", type: "Other" as never, assignment: "All", file: f });
const notice = (f: File) => createNotice({ title: "T", body: "B", audience: "All", attachment: f } as never);

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "Admin";
});

describe("SEC-11 upload content checks", () => {
  it.each([
    ["HTML renamed .pdf", file(HTML, "invoice.pdf")],
    ["HTML as .html", file(HTML, "page.html")],
    ["PNG named .pdf (extension disagrees)", file(PNG, "scan.pdf")],
    ["SVG", file([...new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")], "logo.svg")],
    ["ZIP named .exe", file(DOCX, "setup.exe")],
  ])("document + notice reject %s without storing it", async (_n, f) => {
    expect(await doc(f)).toEqual({ ok: false, error: "invalidFileType" });
    expect(await notice(f)).toEqual({ ok: false, error: "invalidFileType" });
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(prismaMock.document.create).not.toHaveBeenCalled();
    expect(prismaMock.notice.create).not.toHaveBeenCalled();
  });

  it.each([
    ["PDF", file(PDF, "policy.pdf")],
    ["PNG", file(PNG, "chart.png")],
    ["DOCX", file(DOCX, "handbook.docx")],
  ])("document + notice accept a real %s", async (_n, f) => {
    expect(await doc(f)).toEqual({ ok: true });
    expect(await notice(f)).toEqual({ ok: true });
    expect(putObjectMock).toHaveBeenCalledTimes(2);
  });

  it("vendor agreement (any signed-in user) accepts only PDF/PNG/JPEG and names the object by its real type", async () => {
    state.role = "SalesAssociate";
    expect(await submitVendor({ vendorName: "V", agreement: file(HTML, "agreement.pdf") })).toEqual({ ok: false, error: "invalidFileType" });
    expect(await submitVendor({ vendorName: "V", agreement: file(DOCX, "agreement.docx") })).toEqual({ ok: false, error: "invalidFileType" });
    expect(putObjectMock).not.toHaveBeenCalled();

    expect(await submitVendor({ vendorName: "V", agreement: file(PNG, "agreement.pdf") })).toEqual({ ok: true });
    const key = (putObjectMock.mock.calls[0] as unknown as [string])[0];
    expect(key).toMatch(/^vendors\/[0-9a-f-]{36}\/agreement\.png$/);
  });
});
