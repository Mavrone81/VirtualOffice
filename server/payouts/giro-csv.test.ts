import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// W4-GIRO: associate-supplied text in the GIRO bank file must not be evaluated as a
// spreadsheet formula when Accounts opens the CSV, and a re-download must be
// labelled REPRINT. Real buildBankFileCsv / route; DB, PII decrypt and actions mocked.

const { dbMock, prismaMock, genMock } = vi.hoisted(() => {
  const dbMock = {
    monthlyPayout: { findMany: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    bankFileBatch: { create: vi.fn(async () => ({ id: "b1b2c3d4-0000-4000-8000-000000000001" })) },
  };
  const prismaMock = {
    $transaction: vi.fn(async (fn: (db: typeof dbMock) => unknown) => fn(dbMock)),
    monthlyPayout: { findMany: vi.fn() },
  };
  return { dbMock, prismaMock, genMock: vi.fn() };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/pii", () => ({ decryptPiiAudited: vi.fn(async () => "=1+2") }));

import { buildBankFileCsv, csvCell } from "./bankfile";

const payout = (over: Record<string, unknown>) => ({
  id: "p1", seq: 0, associateName: "Fake", paymentMethod: "PayNow", paynowNumber: "+65 9123 4567",
  bankAccountNumber: null, bankName: null, totalPayable: new Prisma.Decimal("100.00"),
  associate: { id: "a1", associateCode: "FAKE01" }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.monthlyPayout.findMany.mockResolvedValue([{ id: "p1" }]);
});

describe("csvCell", () => {
  it.each([
    ["=HYPERLINK(\"http://x\",\"y\")", "\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\""],
    ["+1+cmd|' /C calc'!A0", "\"'+1+cmd|' /C calc'!A0\""],
    ["-2+3", "\"'-2+3\""],
    ["@SUM(A1)", "\"'@SUM(A1)\""],
    ["\t=1", "\"'\t=1\""],
  ])("neutralises %j", (input, out) => {
    expect(csvCell(input)).toBe(out);
  });

  it.each([["+65 9123 4567"], ["+6591234567"], ["Fake Name"], ["DBS"], ["100.00"], [""]])("leaves %j unchanged", (v) => {
    expect(csvCell(v)).toBe(`"${v}"`);
  });
});

describe("buildBankFileCsv (W4-GIRO)", () => {
  it("neutralises formula payloads in associate-supplied columns but keeps a real PayNow number", async () => {
    prismaMock.monthlyPayout.findMany.mockResolvedValue([
      payout({ associateName: "=HYPERLINK(\"http://evil\",\"x\")", bankName: "@SUM(1)" }),
      payout({ id: "p2", associateName: "Plain", paynowNumber: "+1+cmd|' /C calc'!A0" }),
      payout({ id: "p3", associateName: "Bank", paymentMethod: "BankTransfer", bankAccountNumber: "v1:enc", bankName: "DBS" }),
    ]);
    const { csv } = await buildBankFileCsv("2099-01", "u1");
    const cells = csv.split("\r\n").slice(1).map((l) => l);
    expect(cells[0]).toContain("\"'=HYPERLINK(");
    expect(cells[0]).toContain("\"'@SUM(1)\"");
    expect(cells[0]).toContain("\"+65 9123 4567\"");
    expect(cells[1]).toContain("\"'+1+cmd|");
    expect(cells[2]).toContain("\"'=1+2\""); // decrypted account text is neutralised too
    for (const line of cells) expect(line).not.toMatch(/(^|,)"[=+\-@](?!\d[\d ]*")/);
  });
});

describe("bank-file route filename (W4-GIRO)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/server/payouts/actions", () => ({ generateBankFile: genMock }));
  });
  const post = async (fields: Record<string, string>) => {
    const { POST } = await import("@/app/admin/payouts/bank-file/route");
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const res = await POST(new Request("http://local/admin/payouts/bank-file", { method: "POST", body }) as never);
    return res.headers.get("content-disposition");
  };

  it("names a new batch by its id", async () => {
    genMock.mockResolvedValue({ ok: true, csv: "x", batchId: "b1b2c3d4-0000-4000-8000-000000000001", reprint: false });
    expect(await post({ month: "2099-01", password: "p" })).toBe('attachment; filename="giro-payout-2099-01-batch-b1b2c3d4.csv"');
  });

  it("marks a batch re-download as REPRINT", async () => {
    genMock.mockResolvedValue({ ok: true, csv: "x", batchId: "b1b2c3d4-0000-4000-8000-000000000001", reprint: true });
    expect(await post({ month: "2099-01", password: "p", batchId: "b1b2c3d4-0000-4000-8000-000000000001" }))
      .toBe('attachment; filename="giro-payout-2099-01-batch-b1b2c3d4-REPRINT.csv"');
  });

  it("an empty month (no batch) keeps the plain name", async () => {
    genMock.mockResolvedValue({ ok: true, csv: "hdr", batchId: null, reprint: false });
    expect(await post({ month: "2099-01", password: "p" })).toBe('attachment; filename="giro-payout-2099-01.csv"');
  });
});
