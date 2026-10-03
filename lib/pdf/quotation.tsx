import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { sharedIdentity, orMarker, contactLine, LEGACY_DOCUMENT_DEFAULTS } from "@/lib/company-identity";

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";
const GOLD = "#b8893d";
const NAVY = "#1f4e79";

// A quotation is not tied to one Company, so its letterhead comes from the
// active companies (lib/company-identity.ts sharedIdentity): a value prints
// only when they agree on it. Chain: agreed field -> LEGACY_DOCUMENT_DEFAULTS
// (what this printed before) -> marker. Companies that DISAGREE on the UEN
// (e.g. one per subsidiary) print the legacy constant: a customer-facing
// document never prints a marker for a value that has a legacy default.
type Letterhead = { entities: string; address: string; contact: string; uen: string; uenHolder: string };

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, color: INK, fontFamily: "Helvetica", lineHeight: 1.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  wordmark: { fontSize: 26, fontFamily: "Helvetica-Bold", color: GOLD, letterSpacing: 3 },
  coMeta: { fontSize: 8, color: MUTED, marginTop: 2 },
  docTitle: { fontSize: 26, fontFamily: "Helvetica-Bold", color: NAVY, letterSpacing: 1, textAlign: "right" },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 2 },
  metaLabel: { fontSize: 8.5, color: MUTED, width: 70, textAlign: "right", paddingRight: 6 },
  metaVal: { fontSize: 8.5, fontFamily: "Helvetica-Bold", width: 90, textAlign: "right" },
  rule: { borderBottomWidth: 2, borderBottomColor: NAVY, marginTop: 12, marginBottom: 16 },
  label: { fontSize: 8, color: NAVY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  strong: { fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", backgroundColor: NAVY, paddingVertical: 6, paddingHorizontal: 6, marginTop: 22 },
  thText: { fontSize: 8, color: "#fff", textTransform: "uppercase", letterSpacing: 0.5 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 8, paddingHorizontal: 6 },
  cNo: { width: 26 },
  cDesc: { flex: 1, paddingRight: 8 },
  cAmt: { width: 90, textAlign: "right" },
  totRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 3 },
  totLabel: { width: 110, textAlign: "right", color: MUTED, paddingRight: 12 },
  totVal: { width: 90, textAlign: "right" },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 12, color: NAVY },
  box: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginTop: 12 },
  sigRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  sigCell: { width: 220 },
  sigLine: { borderBottomWidth: 1, borderBottomColor: INK, marginBottom: 4, height: 26 },
  sigImg: { height: 40, marginBottom: 2, objectFit: "contain", alignSelf: "flex-start" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, fontSize: 7.5, color: MUTED },
});

type Line = { description: string; amount: number };
type QuotationData = {
  letter: Letterhead;
  ref: string;
  issueDate: Date;
  validUntil: Date;
  clientName: string;
  clientContact?: string | null;
  associateName: string;
  associateCode: string;
  associateBusiness?: string | null;
  associateTeam?: string | null;
  lines: Line[];
  total: number;
  planLabel: string;
  signatureDataUrl?: string | null; // PNG data URL — client's on-system signature
  signerName?: string | null;
  signedDate?: Date | null;
};

function QuotationDoc({ d }: { d: QuotationData }) {
  return (
    <Document title={`Quotation ${d.ref}`} author="Enshrine">
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View style={{ maxWidth: 320 }}>
            <Text style={s.wordmark}>ENSHRINE</Text>
            <Text style={s.coMeta}>{d.letter.entities}</Text>
            <Text style={s.coMeta}>{d.letter.address}</Text>
            <Text style={s.coMeta}>{d.letter.contact}</Text>
          </View>
          <View>
            <Text style={s.docTitle}>QUOTATION</Text>
            <View style={s.metaRow}><Text style={s.metaLabel}>Quotation No.</Text><Text style={s.metaVal}>{d.ref}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Date</Text><Text style={s.metaVal}>{format(d.issueDate, "dd MMM yyyy")}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Valid Until</Text><Text style={s.metaVal}>{format(d.validUntil, "dd MMM yyyy")}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>UEN</Text><Text style={s.metaVal}>{d.letter.uen}</Text></View>
          </View>
        </View>
        <View style={s.rule} />

        <View style={s.row}>
          <View style={{ maxWidth: 240 }}>
            <Text style={s.label}>Prepared For</Text>
            <Text style={s.strong}>{d.clientName}</Text>
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

        <View style={s.th}>
          <Text style={[s.thText, s.cNo]}>No.</Text>
          <Text style={[s.thText, s.cDesc]}>Description</Text>
          <Text style={[s.thText, s.cAmt]}>Amount</Text>
        </View>
        {d.lines.map((l, i) => (
          <View style={s.tr} key={i}>
            <Text style={s.cNo}>{i + 1}</Text>
            <View style={s.cDesc}><Text>{l.description}</Text></View>
            <Text style={s.cAmt}>{formatSGD(l.amount)}</Text>
          </View>
        ))}

        <View style={{ marginTop: 12 }}>
          <View style={[s.totRow, { marginTop: 4 }]}><Text style={[s.totLabel, s.grand]}>Total</Text><Text style={[s.totVal, s.grand]}>{formatSGD(d.total)}</Text></View>
        </View>

        <View style={s.box}>
          <Text style={s.label}>Payment Plan</Text>
          <Text>{d.planLabel}</Text>
          <Text style={[s.coMeta, { marginTop: 4 }]}>This quotation is an estimate and is not a demand for payment. An invoice will be issued upon confirmation.</Text>
        </View>

        <View style={s.sigRow}>
          <View style={s.sigCell}>
            {d.signatureDataUrl ? (
              /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */
              <Image src={d.signatureDataUrl} style={s.sigImg} />
            ) : null}
            <View style={s.sigLine}>{d.signerName ? <Text style={s.strong}>{d.signerName}</Text> : null}</View>
            <Text style={s.coMeta}>Client acceptance (name & signature)</Text>
          </View>
          <View style={s.sigCell}>
            <View style={s.sigLine}>{d.signedDate ? <Text style={s.strong}>{format(d.signedDate, "dd MMM yyyy")}</Text> : null}</View>
            <Text style={s.coMeta}>Date</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {`System-generated quotation from the Virtual Office platform. ${d.letter.uenHolder} · UEN `}{d.letter.uen} · Valid until {format(d.validUntil, "dd MMM yyyy")}
        </Text>
      </Page>
    </Document>
  );
}

const VALID_DAYS = 30;

/** Render the rep-facing quotation for a submission (16-Jul quotation workflow).
 * Only meaningful once the submission is QuotationApproved; the route gates that.
 * Pass `signature` to embed the client's on-system acceptance (23-Jul, issue 4). */
export async function renderQuotationPdf(
  submissionId: string,
  signature?: { dataUrl: string; signerName: string; signedDate: Date },
): Promise<{ buffer: Buffer; filename: string } | null> {
  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    include: { lineItems: true, closingAssociate: true, transaction: { select: { transactionCode: true } } },
  });
  if (!sub) return null;

  const ref = sub.transaction?.transactionCode ?? `Q-${submissionId.slice(0, 8).toUpperCase()}`;
  const issueDate = sub.salesDate ?? sub.createdAt;
  const validUntil = new Date(issueDate.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000);
  const planLabel =
    sub.paymentPlan === "Installment"
      ? `Installment plan${sub.installmentCount ? `: ${sub.installmentCount} months` : ""}${sub.deposit ? ` · deposit ${formatSGD(sub.deposit)}` : ""}.`
      : "One-time full payment.";

  const shared = sharedIdentity(await prisma.company.findMany({ where: { active: true }, orderBy: { name: "asc" } }));
  const L = LEGACY_DOCUMENT_DEFAULTS;
  const letter: Letterhead = {
    entities: L.entities,
    address: orMarker(shared.address, "address", L.address),
    contact: contactLine(shared),
    // Number and name are used together or not at all: when the companies
    // disagree (or have no UEN) the legacy pair prints, never a marker.
    uen: shared.uen && shared.holder ? shared.uen : L.uen,
    uenHolder: shared.uen && shared.holder ? shared.holder : L.quotationFooterName,
  };

  const d: QuotationData = {
    letter,
    ref,
    issueDate,
    validUntil,
    clientName: sub.clientName,
    clientContact: sub.clientContact,
    associateName: sub.closingAssociate.fullName,
    associateCode: sub.closingAssociate.associateCode,
    associateBusiness: sub.closingAssociate.businessName,
    associateTeam: sub.closingAssociate.teamName,
    lines: sub.lineItems.map((li) => ({ description: li.productName, amount: Number(li.lineSaleAmount) })),
    total: Number(sub.saleAmount),
    planLabel,
    signatureDataUrl: signature?.dataUrl ?? null,
    signerName: signature?.signerName ?? null,
    signedDate: signature?.signedDate ?? null,
  };

  const buffer = await renderToBuffer(<QuotationDoc d={d} />);
  return { buffer, filename: `Quotation-${ref}.pdf` };
}
