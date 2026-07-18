import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { formatSGD, D, round2 } from "@/lib/money";

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";
const GOLD = "#b8893d";
const NAVY = "#1f4e79";

// Enshrine group identity (per VO_Invoice_Design.pdf / the associate application).
const UEN = "202328861K";
const ENTITIES = "Enshrine Services Pte Ltd · Enshrine Pets Paradise Pte Ltd · Enshrine Afterlife Planner Pte Ltd";
const ADDRESS = "74 Lorong 6 Geylang, Singapore 399226";
const CONTACT = "Tel: 9009 9234 · contacts@enshrine.sg · www.enshrine.sg";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, color: INK, fontFamily: "Helvetica", lineHeight: 1.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  wordmark: { fontSize: 26, fontFamily: "Helvetica-Bold", color: GOLD, letterSpacing: 3 },
  coMeta: { fontSize: 8, color: MUTED, marginTop: 2 },
  docTitle: { fontSize: 26, fontFamily: "Helvetica-Bold", color: NAVY, letterSpacing: 1, textAlign: "right" },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 2 },
  metaLabel: { fontSize: 8.5, color: MUTED, width: 60, textAlign: "right", paddingRight: 6 },
  metaVal: { fontSize: 8.5, fontFamily: "Helvetica-Bold", width: 90, textAlign: "right" },
  rule: { borderBottomWidth: 2, borderBottomColor: NAVY, marginTop: 12, marginBottom: 16 },
  label: { fontSize: 8, color: NAVY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  strong: { fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", backgroundColor: NAVY, paddingVertical: 6, paddingHorizontal: 6, marginTop: 22 },
  thText: { fontSize: 8, color: "#fff", textTransform: "uppercase", letterSpacing: 0.5 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 8, paddingHorizontal: 6 },
  cNo: { width: 26 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 40, textAlign: "right" },
  cUnit: { width: 80, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right" },
  subDesc: { fontSize: 8, color: MUTED, marginTop: 1 },
  totRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 3 },
  totLabel: { width: 110, textAlign: "right", color: MUTED, paddingRight: 12 },
  totVal: { width: 80, textAlign: "right" },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 12, color: NAVY },
  box: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginTop: 8 },
  paidStamp: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#2e7d5b", borderWidth: 1.5, borderColor: "#2e7d5b", borderRadius: 5, paddingVertical: 4, paddingHorizontal: 10, textTransform: "uppercase", letterSpacing: 2 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, fontSize: 7.5, color: MUTED },
});

type Line = { description: string; sub?: string; qty: number; unitPrice: number; amount: number };
type InvoiceData = {
  companyName: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  status: string;
  paidDate?: Date | null;
  installmentIndex?: number | null;
  clientName: string;
  clientAddress?: string | null;
  clientContact?: string | null;
  associateName: string;
  associateCode: string;
  associateBusiness?: string | null;
  associateTeam?: string | null;
  lines: Line[];
  gstRate: number;
  total: number;
  plan: { kind: "OneTime" } | { kind: "Installment"; months: number; deposit: number; monthly: number };
};

function InvoiceDoc({ d }: { d: InvoiceData }) {
  const gstAmount = d.gstRate > 0 ? d.total - d.total / (1 + d.gstRate / 100) : 0;
  const subtotal = d.total - gstAmount;
  return (
    <Document title={d.invoiceNumber} author="Enshrine">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.row}>
          <View style={{ maxWidth: 320 }}>
            <Text style={s.wordmark}>ENSHRINE</Text>
            <Text style={s.coMeta}>{ENTITIES}</Text>
            <Text style={s.coMeta}>{ADDRESS}</Text>
            <Text style={s.coMeta}>{CONTACT}</Text>
          </View>
          <View>
            <Text style={s.docTitle}>{d.gstRate > 0 ? "TAX INVOICE" : "INVOICE"}</Text>
            <View style={s.metaRow}><Text style={s.metaLabel}>Invoice No.</Text><Text style={s.metaVal}>{d.invoiceNumber}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Issue Date</Text><Text style={s.metaVal}>{format(d.issueDate, "dd MMM yyyy")}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Due Date</Text><Text style={s.metaVal}>{format(d.dueDate, "dd MMM yyyy")}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>UEN</Text><Text style={s.metaVal}>{UEN}</Text></View>
          </View>
        </View>
        <View style={s.rule} />

        {/* Bill to / Sales associate */}
        <View style={s.row}>
          <View style={{ maxWidth: 240 }}>
            <Text style={s.label}>Bill To</Text>
            <Text style={s.strong}>{d.clientName}</Text>
            {d.clientAddress ? <Text style={s.coMeta}>{d.clientAddress}</Text> : null}
            {d.clientContact ? <Text style={s.coMeta}>Contact: {d.clientContact}</Text> : null}
          </View>
          <View style={{ maxWidth: 240 }}>
            <Text style={s.label}>Sales Associate</Text>
            <Text style={s.strong}>{d.associateName}</Text>
            <Text style={s.coMeta}>Associate ID: {d.associateCode}</Text>
            {d.associateBusiness ? <Text style={s.coMeta}>{d.associateBusiness}</Text> : null}
            {d.associateTeam ? <Text style={s.coMeta}>Team: {d.associateTeam}</Text> : null}
          </View>
        </View>

        {/* Line items */}
        <View style={s.th}>
          <Text style={[s.thText, s.cNo]}>No.</Text>
          <Text style={[s.thText, s.cDesc]}>Description</Text>
          <Text style={[s.thText, s.cQty]}>Qty</Text>
          <Text style={[s.thText, s.cUnit]}>Unit Price</Text>
          <Text style={[s.thText, s.cAmt]}>Amount</Text>
        </View>
        {d.lines.map((l, i) => (
          <View style={s.tr} key={i}>
            <Text style={s.cNo}>{i + 1}</Text>
            <View style={s.cDesc}><Text>{l.description}</Text>{l.sub ? <Text style={s.subDesc}>{l.sub}</Text> : null}</View>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cUnit}>{formatSGD(l.unitPrice)}</Text>
            <Text style={s.cAmt}>{formatSGD(l.amount)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={{ marginTop: 12 }}>
          <View style={s.totRow}><Text style={s.totLabel}>Subtotal</Text><Text style={s.totVal}>{formatSGD(subtotal)}</Text></View>
          <View style={s.totRow}><Text style={s.totLabel}>GST{d.gstRate > 0 ? ` (${d.gstRate}%)` : " (if applicable)"}</Text><Text style={s.totVal}>{formatSGD(gstAmount)}</Text></View>
          <View style={[s.totRow, { marginTop: 4 }]}><Text style={[s.totLabel, s.grand]}>Total Payable</Text><Text style={[s.totVal, s.grand]}>{formatSGD(d.total)}</Text></View>
        </View>

        {/* Payment plan */}
        <View style={s.box}>
          <Text style={s.label}>Payment Plan</Text>
          {d.plan.kind === "OneTime" ? (
            <Text>One-time payment — full amount due by {format(d.dueDate, "dd MMM yyyy")}.</Text>
          ) : (
            <>
              <Text>Installment plan: {d.plan.months} months.</Text>
              <Text style={s.coMeta}>1st month: deposit / booking fee {formatSGD(d.plan.deposit)} + first installment {formatSGD(d.plan.monthly)} · thereafter {formatSGD(d.plan.monthly)} / month.</Text>
            </>
          )}
        </View>

        {/* Payment methods + reference */}
        <View style={[s.row, { marginTop: 12 }]}>
          <View style={{ maxWidth: 250 }}>
            <Text style={s.label}>Payment Methods</Text>
            <Text style={s.coMeta}>• PayNow (Company UEN): {UEN}</Text>
            <Text style={s.coMeta}>• Bank Transfer: Bank / Account No.</Text>
            <Text style={s.coMeta}>• Cheque payable to: {d.companyName}</Text>
          </View>
          <View style={{ maxWidth: 240 }}>
            <Text style={s.label}>Important</Text>
            <Text style={s.coMeta}>Please quote the Invoice Number (and your name) as the payment reference so we can match your payment.</Text>
            <Text style={[s.coMeta, { color: GOLD, marginTop: 3, fontFamily: "Helvetica-Bold" }]}>Reference required: {d.invoiceNumber}</Text>
          </View>
        </View>

        {d.status === "Paid" ? (
          <View style={{ alignItems: "flex-end", marginTop: 14 }}>
            <Text style={s.paidStamp}>Paid</Text>
            {d.paidDate ? <Text style={[s.coMeta, { marginTop: 4 }]}>{format(d.paidDate, "dd MMM yyyy")}</Text> : null}
          </View>
        ) : null}

        <Text style={s.footer} fixed>
          Authorised Signature (Company)          Customer Acknowledgement{"\n"}
          This is a system-generated invoice from the Virtual Office platform. Enshrine Holdings Pte Ltd · UEN {UEN}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(invoiceId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      company: true,
      transaction: { include: { lineItems: true, closingAssociate: true, submission: true } },
    },
  });
  if (!inv) return null;

  const tx = inv.transaction;
  const companyLines = tx.lineItems.filter((li) => li.companyId === inv.companyId);
  const lines: Line[] =
    inv.installmentIndex != null || companyLines.length === 0
      ? [{
          description: inv.installmentIndex != null ? `Installment payment #${inv.installmentIndex}` : `Sale — ${tx.transactionCode}`,
          sub: tx.clientName, qty: 1, unitPrice: Number(inv.amount), amount: Number(inv.amount),
        }]
      : companyLines.map((li) => {
          const amt = Number(li.lineSaleAmount);
          const qty = li.quantity > 0 ? li.quantity : 1;
          return { description: li.productName, sub: li.productCode, qty, unitPrice: round2(D(amt).div(qty)).toNumber(), amount: amt };
        });

  const gstRate = inv.company.gstRegistered ? Number(inv.company.gstRate) : 0;
  const total = Number(inv.amount);
  const dueDate = new Date(inv.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);

  const sub = tx.submission;
  const plan: InvoiceData["plan"] =
    sub && sub.paymentPlan === "Installment" && sub.installmentCount
      ? {
          kind: "Installment",
          months: sub.installmentCount,
          deposit: Number(sub.deposit ?? 0),
          monthly: round2(D(total).sub(D(Number(sub.deposit ?? 0))).div(sub.installmentCount)).toNumber(),
        }
      : { kind: "OneTime" };

  const d: InvoiceData = {
    companyName: inv.company.name,
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.createdAt,
    dueDate,
    status: inv.status,
    paidDate: inv.paidDate,
    installmentIndex: inv.installmentIndex,
    clientName: tx.clientName,
    clientContact: tx.clientContact,
    associateName: tx.closingAssociate.fullName,
    associateCode: tx.closingAssociate.associateCode,
    associateBusiness: tx.closingAssociate.businessName,
    associateTeam: tx.closingAssociate.teamName,
    lines,
    gstRate,
    total,
    plan,
  };

  const buffer = await renderToBuffer(<InvoiceDoc d={d} />);
  return { buffer, filename: `${inv.invoiceNumber.replace(/[^\w.-]/g, "_")}.pdf` };
}
