import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";

const s = StyleSheet.create({
  page: { padding: 46, fontSize: 10, color: INK, fontFamily: "Helvetica", lineHeight: 1.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  brandMark: { width: 26, height: 26, borderRadius: 5, backgroundColor: INK, color: "#fff", textAlign: "center", paddingTop: 6, fontSize: 12, fontFamily: "Helvetica-Bold" },
  coName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: INK },
  coMeta: { fontSize: 9, color: MUTED, marginTop: 2 },
  docTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: 0.5 },
  label: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 },
  value: { fontSize: 10, color: INK },
  block: { marginTop: 20 },
  partyRow: { flexDirection: "row", gap: 16 },
  party: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 10 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 6, marginBottom: 2 },
  thText: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 7 },
  cDesc: { flex: 1, paddingRight: 8 },
  cAmt: { width: 90, textAlign: "right" },
  totRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 2 },
  totLabel: { width: 120, textAlign: "right", color: MUTED, paddingRight: 12 },
  totVal: { width: 90, textAlign: "right" },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  clauseH: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 2 },
  para: { fontSize: 9, color: "#3a3730", marginBottom: 3, textAlign: "justify" },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 34 },
  signBox: { width: 210 },
  sigLine: { borderTopWidth: 1, borderTopColor: INK, marginTop: 30, paddingTop: 4 },
  footer: { position: "absolute", bottom: 34, left: 46, right: 46, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, fontSize: 8, color: MUTED },
});

type Sched = { seq: number; amount: string; due: string };
type Data = {
  transactionCode: string;
  salesDate: Date;
  clientName: string;
  clientContact?: string | null;
  associateName: string;
  associateCode: string;
  paymentPlan: string;
  lines: { desc: string; amount: string }[];
  total: number;
  deposit?: number | null;
  schedule: Sched[];
};

function SalesAgreementDoc({ d }: { d: Data }) {
  return (
    <Document title={`Sales Agreement ${d.transactionCode}`} author="Enshrine">
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View style={{ flexDirection: "row" }}>
            <Text style={s.brandMark}>E</Text>
            <View style={{ marginLeft: 10 }}>
              <Text style={s.coName}>Enshrine</Text>
              <Text style={s.coMeta}>Services · Pets Paradise · Afterlife Planner</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.docTitle}>SALES AGREEMENT</Text>
            <Text style={[s.coMeta, { marginTop: 4 }]}>{d.transactionCode} · {format(d.salesDate, "dd MMM yyyy")}</Text>
          </View>
        </View>

        <View style={[s.partyRow, s.block]}>
          <View style={s.party}>
            <Text style={s.label}>Client</Text>
            <Text style={[s.value, { fontFamily: "Helvetica-Bold" }]}>{d.clientName}</Text>
            {d.clientContact ? <Text style={s.coMeta}>{d.clientContact}</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.label}>Served by</Text>
            <Text style={[s.value, { fontFamily: "Helvetica-Bold" }]}>{d.associateName}</Text>
            <Text style={s.coMeta}>Enshrine Associate · {d.associateCode}</Text>
          </View>
        </View>

        <View style={s.block}>
          <View style={s.th}>
            <Text style={[s.thText, s.cDesc]}>Product / Service</Text>
            <Text style={[s.thText, s.cAmt]}>Amount</Text>
          </View>
          {d.lines.map((l, i) => (
            <View style={s.tr} key={i}>
              <Text style={s.cDesc}>{l.desc}</Text>
              <Text style={s.cAmt}>{l.amount}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 12 }}>
          <View style={s.totRow}><Text style={s.totLabel}>Payment plan</Text><Text style={s.totVal}>{d.paymentPlan}</Text></View>
          {d.deposit ? <View style={s.totRow}><Text style={s.totLabel}>Deposit</Text><Text style={s.totVal}>{formatSGD(d.deposit)}</Text></View> : null}
          <View style={[s.totRow, { marginTop: 3 }]}><Text style={[s.totLabel, s.grand]}>Total</Text><Text style={[s.totVal, s.grand]}>{formatSGD(d.total)}</Text></View>
        </View>

        {d.schedule.length > 0 && (
          <View style={s.block}>
            <Text style={s.clauseH}>Installment schedule</Text>
            {d.schedule.map((sc) => (
              <View style={[s.totRow, { justifyContent: "space-between" }]} key={sc.seq}>
                <Text style={{ color: MUTED }}>#{sc.seq}{sc.due ? ` · due ${sc.due}` : ""}</Text>
                <Text>{sc.amount}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ marginTop: 8 }}>
          <Text style={s.clauseH}>Terms</Text>
          <Text style={s.para}>
            This agreement confirms the client&rsquo;s purchase of the products and services listed above from Enshrine.
            Payment is due per the plan stated. Where an installment plan applies, services are rendered subject to the
            agreed collection schedule. All services are provided in accordance with Enshrine&rsquo;s standard terms and
            applicable Singapore regulations governing funeral, pet-aftercare, and pre-need services.
          </Text>
        </View>

        <View style={s.signRow}>
          <View style={s.signBox}>
            <View style={s.sigLine}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.clientName}</Text>
              <Text style={s.coMeta}>Client signature &amp; date</Text>
            </View>
          </View>
          <View style={s.signBox}>
            <View style={s.sigLine}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.associateName}</Text>
              <Text style={s.coMeta}>For and on behalf of Enshrine</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {d.transactionCode} · Generated by the Enshrine Virtual Office. Please retain a copy for your records.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderSalesAgreementPdf(transactionId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const t = await prisma.salesTransaction.findUnique({
    where: { id: transactionId },
    include: {
      closingAssociate: { select: { fullName: true, associateCode: true } },
      lineItems: true,
      installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" } } } },
    },
  });
  if (!t) return null;

  const d: Data = {
    transactionCode: t.transactionCode,
    salesDate: t.salesDate,
    clientName: t.clientName,
    clientContact: t.clientContact,
    associateName: t.closingAssociate.fullName,
    associateCode: t.closingAssociate.associateCode,
    paymentPlan: humanize(t.paymentPlan),
    lines: t.lineItems.map((li) => ({
      desc: `${li.productName} (${li.productCode})${li.quantity > 1 ? ` ×${li.quantity}` : ""}`,
      amount: formatSGD(li.lineSaleAmount),
    })),
    total: Number(t.saleAmount),
    deposit: t.deposit ? Number(t.deposit) : null,
    schedule: (t.installmentPlan?.schedule ?? []).map((sc) => ({
      seq: sc.sequence,
      amount: formatSGD(sc.dueAmount),
      due: sc.dueDate ? format(sc.dueDate, "dd MMM yyyy") : "",
    })),
  };

  const buffer = await renderToBuffer(<SalesAgreementDoc d={d} />);
  return { buffer, filename: `sales-agreement-${t.transactionCode}.pdf` };
}
