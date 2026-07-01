import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { decryptPII, maskAccount } from "@/lib/crypto";

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";
const GOLD = "#c8a04a";

const s = StyleSheet.create({
  page: { padding: 44, fontSize: 10, color: INK, fontFamily: "Helvetica", lineHeight: 1.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  brandMark: { width: 26, height: 26, borderRadius: 5, backgroundColor: INK, color: "#fff", textAlign: "center", paddingTop: 6, fontSize: 12, fontFamily: "Helvetica-Bold" },
  coName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: INK },
  coMeta: { fontSize: 9, color: MUTED, marginTop: 2 },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: 1 },
  label: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 },
  value: { fontSize: 10, color: INK },
  block: { marginTop: 22 },
  tiles: { flexDirection: "row", gap: 8, marginTop: 20 },
  tile: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 10 },
  tileLabel: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  tileVal: { fontSize: 13, fontFamily: "Helvetica-Bold", color: INK, marginTop: 4 },
  tileTotal: { backgroundColor: INK },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 6, marginBottom: 2 },
  thText: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 6 },
  cDesc: { flex: 1, paddingRight: 8 },
  cType: { width: 70 },
  cBasis: { width: 80, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right" },
  footer: { position: "absolute", bottom: 36, left: 44, right: 44, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10, fontSize: 8, color: MUTED },
});

type Line = { date: string; desc: string; sub?: string; type: string; basis: string; amount: string };
type StatementData = {
  associateName: string;
  associateCode: string;
  designation: string;
  month: string; // e.g. "June 2026"
  personal: number;
  override: number;
  addon: number;
  total: number;
  paymentMethod?: string | null;
  payTo?: string | null;
  status: string;
  paidDate?: Date | null;
  lines: Line[];
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return format(new Date(y, m - 1, 1), "MMMM yyyy");
}

function StatementDoc({ d }: { d: StatementData }) {
  return (
    <Document title={`Statement ${d.associateCode} ${d.month}`} author="Enshrine">
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View style={{ flexDirection: "row" }}>
            <Text style={s.brandMark}>E</Text>
            <View style={{ marginLeft: 10 }}>
              <Text style={s.coName}>Enshrine</Text>
              <Text style={s.coMeta}>Virtual Office · Commission</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.docTitle}>COMMISSION STATEMENT</Text>
            <Text style={[s.coMeta, { marginTop: 4 }]}>{d.month}</Text>
          </View>
        </View>

        <View style={[s.row, s.block]}>
          <View>
            <Text style={s.label}>Associate</Text>
            <Text style={[s.value, { fontFamily: "Helvetica-Bold" }]}>{d.associateName}</Text>
            <Text style={s.coMeta}>{d.associateCode} · {d.designation}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.label}>Payout status</Text>
            <Text style={[s.value, { color: d.status === "Paid" ? "#2e7d5b" : GOLD, fontFamily: "Helvetica-Bold" }]}>{humanize(d.status)}</Text>
            {d.paidDate ? <Text style={[s.coMeta, { marginTop: 2 }]}>{format(d.paidDate, "dd MMM yyyy")}</Text> : null}
          </View>
        </View>

        {/* Summary tiles */}
        <View style={s.tiles}>
          <View style={s.tile}><Text style={s.tileLabel}>Personal</Text><Text style={s.tileVal}>{formatSGD(d.personal)}</Text></View>
          <View style={s.tile}><Text style={s.tileLabel}>Override</Text><Text style={s.tileVal}>{formatSGD(d.override)}</Text></View>
          <View style={s.tile}><Text style={s.tileLabel}>Add-on</Text><Text style={s.tileVal}>{formatSGD(d.addon)}</Text></View>
          <View style={[s.tile, s.tileTotal]}><Text style={[s.tileLabel, { color: "#cfcabf" }]}>Total payable</Text><Text style={[s.tileVal, { color: "#fff" }]}>{formatSGD(d.total)}</Text></View>
        </View>

        {/* Ledger lines */}
        <View style={s.block}>
          <View style={s.th}>
            <Text style={[s.thText, s.cDesc]}>Transaction</Text>
            <Text style={[s.thText, s.cType]}>Type</Text>
            <Text style={[s.thText, s.cBasis]}>Basis</Text>
            <Text style={[s.thText, s.cAmt]}>Commission</Text>
          </View>
          {d.lines.length === 0 ? (
            <Text style={[s.coMeta, { paddingVertical: 10 }]}>No commission lines for this period.</Text>
          ) : (
            d.lines.map((l, i) => (
              <View style={s.tr} key={i}>
                <View style={s.cDesc}>
                  <Text style={{ color: INK }}>{l.desc}</Text>
                  {l.sub ? <Text style={s.coMeta}>{l.sub} · {l.date}</Text> : <Text style={s.coMeta}>{l.date}</Text>}
                </View>
                <Text style={[s.cType, { color: MUTED }]}>{l.type}</Text>
                <Text style={s.cBasis}>{l.basis}</Text>
                <Text style={[s.cAmt, { fontFamily: "Helvetica-Bold" }]}>{l.amount}</Text>
              </View>
            ))
          )}
        </View>

        {/* Payment */}
        <View style={[s.block]}>
          <Text style={s.label}>Payment</Text>
          <Text style={s.value}>{d.paymentMethod ? `${humanize(d.paymentMethod)}${d.payTo ? ` · ${d.payTo}` : ""}` : "Not set"}</Text>
        </View>

        <Text style={s.footer} fixed>
          Commission is earned on verified, collected sales per the Enshrine commission plan. This statement is
          computer-generated by the Enshrine Virtual Office. Queries: contact your administrator.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(payoutId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const payout = await prisma.monthlyPayout.findUnique({
    where: { id: payoutId },
    include: { associate: { select: { associateCode: true } } },
  });
  if (!payout) return null;

  const ledger = await prisma.commissionLedger.findMany({
    where: { associateId: payout.associateId, payoutMonth: payout.payoutMonth },
    include: { transaction: { select: { transactionCode: true, clientName: true } }, lineItem: { select: { productName: true } } },
    orderBy: [{ lineType: "asc" }, { createdAt: "asc" }],
  });

  const lines: Line[] = ledger.map((l) => ({
    date: format(l.createdAt, "dd MMM yyyy"),
    desc: l.transaction?.clientName ?? l.transaction?.transactionCode ?? "—",
    sub: [l.lineItem?.productName, l.comCode].filter(Boolean).join(" · ") || undefined,
    type: humanize(l.lineType),
    basis: formatSGD(l.basisAmount),
    amount: formatSGD(l.amount),
  }));

  let payTo: string | null = null;
  if (payout.paymentMethod === "PayNow") payTo = payout.paynowNumber;
  else if (payout.bankName) {
    const acct = payout.bankAccountNumber ? safeDecrypt(payout.bankAccountNumber) : null;
    payTo = `${payout.bankName}${acct ? ` · ${maskAccount(acct)}` : ""}`;
  }

  const d: StatementData = {
    associateName: payout.associateName,
    associateCode: payout.associate.associateCode,
    designation: humanize(payout.designation),
    month: monthLabel(payout.payoutMonth),
    personal: Number(payout.personalCommission),
    override: Number(payout.overrideCommission),
    addon: Number(payout.addonCommission),
    total: Number(payout.totalPayable),
    paymentMethod: payout.paymentMethod,
    payTo,
    status: payout.payoutStatus,
    paidDate: payout.paidDate,
    lines,
  };

  const buffer = await renderToBuffer(<StatementDoc d={d} />);
  return { buffer, filename: `statement-${payout.associate.associateCode}-${payout.payoutMonth}.pdf` };
}

function safeDecrypt(blob: string): string | null {
  try { return decryptPII(blob); } catch { return null; }
}
