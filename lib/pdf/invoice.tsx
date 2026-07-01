import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";

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
  docTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: 1 },
  label: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 },
  value: { fontSize: 10, color: INK },
  block: { marginTop: 22 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 6, marginBottom: 2 },
  thText: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 7 },
  cDesc: { flex: 1, paddingRight: 8 },
  cAmt: { width: 90, textAlign: "right" },
  totRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 3 },
  totLabel: { width: 110, textAlign: "right", color: MUTED, paddingRight: 12 },
  totVal: { width: 90, textAlign: "right" },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 12, color: INK },
  footer: { position: "absolute", bottom: 36, left: 44, right: 44, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10, fontSize: 8, color: MUTED },
  paidStamp: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#2e7d5b", borderWidth: 1.5, borderColor: "#2e7d5b", borderRadius: 5, paddingVertical: 4, paddingHorizontal: 10, textTransform: "uppercase", letterSpacing: 2 },
});

type InvoiceData = {
  companyName: string;
  companyAddress?: string | null;
  companyLegalName?: string | null;
  invoiceNumber: string;
  issueDate: Date;
  status: string;
  paidDate?: Date | null;
  clientName: string;
  clientContact?: string | null;
  installmentIndex?: number | null;
  lines: { description: string; amount: string }[]; // amount pre-formatted
  subtotal: number;
  gstRate: number; // 0 when not registered
  total: number;
  remarks?: string | null;
};

function InvoiceDoc({ d }: { d: InvoiceData }) {
  const gstAmount = d.gstRate > 0 ? d.total - d.total / (1 + d.gstRate / 100) : 0;
  const netAmount = d.total - gstAmount;
  return (
    <Document title={d.invoiceNumber} author="Enshrine">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.row}>
          <View style={{ flexDirection: "row" }}>
            <Text style={s.brandMark}>E</Text>
            <View style={{ marginLeft: 10 }}>
              <Text style={s.coName}>{d.companyName}</Text>
              {d.companyLegalName ? <Text style={s.coMeta}>{d.companyLegalName}</Text> : null}
              {d.companyAddress ? <Text style={s.coMeta}>{d.companyAddress}</Text> : null}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.docTitle}>{d.gstRate > 0 ? "TAX INVOICE" : "INVOICE"}</Text>
            <Text style={[s.coMeta, { marginTop: 4 }]}>{d.invoiceNumber}</Text>
          </View>
        </View>

        {/* Meta */}
        <View style={[s.row, s.block]}>
          <View>
            <Text style={s.label}>Bill to</Text>
            <Text style={[s.value, { fontFamily: "Helvetica-Bold" }]}>{d.clientName}</Text>
            {d.clientContact ? <Text style={s.coMeta}>{d.clientContact}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.label}>Issue date</Text>
            <Text style={s.value}>{format(d.issueDate, "dd MMM yyyy")}</Text>
            {d.installmentIndex ? <Text style={[s.coMeta, { marginTop: 4 }]}>Installment #{d.installmentIndex}</Text> : null}
          </View>
        </View>

        {/* Line items */}
        <View style={s.block}>
          <View style={s.th}>
            <Text style={[s.thText, s.cDesc]}>Description</Text>
            <Text style={[s.thText, s.cAmt]}>Amount</Text>
          </View>
          {d.lines.map((l, i) => (
            <View style={s.tr} key={i}>
              <Text style={s.cDesc}>{l.description}</Text>
              <Text style={s.cAmt}>{l.amount}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={{ marginTop: 14 }}>
          {d.gstRate > 0 ? (
            <>
              <View style={s.totRow}><Text style={s.totLabel}>Subtotal</Text><Text style={s.totVal}>{formatSGD(netAmount)}</Text></View>
              <View style={s.totRow}><Text style={s.totLabel}>GST ({d.gstRate}%)</Text><Text style={s.totVal}>{formatSGD(gstAmount)}</Text></View>
            </>
          ) : null}
          <View style={[s.totRow, { marginTop: 4 }]}>
            <Text style={[s.totLabel, s.grand]}>Total</Text>
            <Text style={[s.totVal, s.grand]}>{formatSGD(d.total)}</Text>
          </View>
        </View>

        {/* Status / paid stamp */}
        <View style={[s.row, { marginTop: 24, alignItems: "center" }]}>
          <View>
            {d.remarks ? (<><Text style={s.label}>Remarks</Text><Text style={s.coMeta}>{d.remarks}</Text></>) : null}
          </View>
          {d.status === "Paid" ? (
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.paidStamp}>Paid</Text>
              {d.paidDate ? <Text style={[s.coMeta, { marginTop: 4 }]}>{format(d.paidDate, "dd MMM yyyy")}</Text> : null}
            </View>
          ) : (
            <Text style={{ fontSize: 10, color: GOLD, fontFamily: "Helvetica-Bold" }}>OUTSTANDING</Text>
          )}
        </View>

        <Text style={s.footer} fixed>
          This is a computer-generated invoice issued via the Enshrine Virtual Office. No signature is required.
          {"  •  "}Enshrine Services · Enshrine Pets Paradise · Enshrine Afterlife Planner
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(invoiceId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { company: true, transaction: { include: { lineItems: true } } },
  });
  if (!inv) return null;

  // Line items belonging to this invoice's company; fall back to a single
  // summary line for installment invoices (which bill a scheduled portion).
  const companyLines = inv.transaction.lineItems.filter((li) => li.companyId === inv.companyId);
  const lines =
    inv.installmentIndex != null || companyLines.length === 0
      ? [{ description: inv.installmentIndex != null ? `Installment payment #${inv.installmentIndex} — ${inv.transaction.clientName}` : `Sale — ${inv.transaction.transactionCode}`, amount: formatSGD(inv.amount) }]
      : companyLines.map((li) => ({
          description: `${li.productName} (${li.productCode})${li.quantity > 1 ? ` ×${li.quantity}` : ""}`,
          amount: formatSGD(li.lineSaleAmount),
        }));

  const gstRate = inv.company.gstRegistered ? Number(inv.company.gstRate) : 0;
  const total = Number(inv.amount);

  const d: InvoiceData = {
    companyName: inv.company.name,
    companyLegalName: inv.company.legalName,
    companyAddress: inv.company.address,
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.createdAt,
    status: inv.status,
    paidDate: inv.paidDate,
    clientName: inv.transaction.clientName,
    clientContact: inv.transaction.clientContact,
    installmentIndex: inv.installmentIndex,
    lines,
    subtotal: total,
    gstRate,
    total,
    remarks: inv.remarks,
  };

  const buffer = await renderToBuffer(<InvoiceDoc d={d} />);
  return { buffer, filename: `${inv.invoiceNumber.replace(/[^\w.-]/g, "_")}.pdf` };
}
