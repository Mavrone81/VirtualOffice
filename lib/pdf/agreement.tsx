import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: INK, fontFamily: "Helvetica", lineHeight: 1.55 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brandMark: { width: 26, height: 26, borderRadius: 5, backgroundColor: INK, color: "#fff", textAlign: "center", paddingTop: 6, fontSize: 12, fontFamily: "Helvetica-Bold" },
  coName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: INK },
  coMeta: { fontSize: 9, color: MUTED, marginTop: 2 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: INK, marginTop: 26, marginBottom: 2 },
  ref: { fontSize: 9, color: MUTED, marginBottom: 14 },
  partyRow: { flexDirection: "row", gap: 18, marginBottom: 16 },
  party: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 10 },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  val: { fontSize: 10, color: INK, marginTop: 2 },
  clauseH: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK, marginTop: 12, marginBottom: 3 },
  para: { fontSize: 9.5, color: "#3a3730", marginBottom: 4, textAlign: "justify" },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 30 },
  signBox: { width: 220 },
  sigImg: { height: 56, width: 200, objectFit: "contain" },
  sigLine: { borderTopWidth: 1, borderTopColor: INK, marginTop: 4, paddingTop: 4 },
  footer: { position: "absolute", bottom: 34, left: 48, right: 48, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, fontSize: 8, color: MUTED },
});

export type AgreementData = {
  fullName: string;
  designation: string;
  email: string;
  mobile: string;
  nricMasked?: string | null;
  teamName?: string | null;
  uplineName?: string | null;
  signedDate: Date;
  signatureDataUrl?: string | null; // PNG data URL
};

const CLAUSES: { h: string; p: string }[] = [
  { h: "1. Appointment", p: "Enshrine appoints the Associate as an independent, commission-based sales associate. This Agreement does not create an employment, partnership, or agency relationship beyond the limited authority to market and sell Enshrine's products and services." },
  { h: "2. Commission & Payout", p: "The Associate earns commission on verified and collected sales in accordance with the prevailing Enshrine commission plan, including personal commission, upline overrides, and applicable add-on codes. Commission becomes payable only upon collection milestones defined in the plan. Enshrine may update rates prospectively." },
  { h: "3. Conduct & Compliance", p: "The Associate shall represent Enshrine with integrity, make no misrepresentations to clients, and comply with all applicable laws and regulations, including those governing funeral, pet-aftercare, and pre-need services in Singapore." },
  { h: "4. Confidentiality & Data", p: "The Associate shall keep client and company information confidential and use it solely for legitimate business purposes. Personal data provided by the Associate is processed for HR, payout, and compliance purposes and stored securely in accordance with the PDPA." },
  { h: "5. Term & Termination", p: "This Agreement takes effect on approval by Enshrine and continues until terminated by either party. Enshrine may suspend or terminate the appointment for breach, misconduct, or regulatory reasons. Commission accrued on collected sales prior to termination remains payable per the plan." },
];

function AgreementDoc({ d }: { d: AgreementData }) {
  return (
    <Document title={`Associate Agreement — ${d.fullName}`} author="Enshrine">
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View style={{ flexDirection: "row" }}>
            <Text style={s.brandMark}>E</Text>
            <View style={{ marginLeft: 10 }}>
              <Text style={s.coName}>Enshrine</Text>
              <Text style={s.coMeta}>Associate Management</Text>
            </View>
          </View>
          <Text style={s.coMeta}>Signed {format(d.signedDate, "dd MMM yyyy, HH:mm")}</Text>
        </View>

        <Text style={s.title}>Associate Agreement</Text>
        <Text style={s.ref}>Between Enshrine (Enshrine Services · Enshrine Pets Paradise · Enshrine Afterlife Planner) and the Associate named below.</Text>

        <View style={s.partyRow}>
          <View style={s.party}>
            <Text style={s.label}>Associate</Text>
            <Text style={[s.val, { fontFamily: "Helvetica-Bold" }]}>{d.fullName}</Text>
            <Text style={s.coMeta}>{d.designation}</Text>
            <Text style={s.coMeta}>{d.email} · {d.mobile}</Text>
            {d.nricMasked ? <Text style={s.coMeta}>NRIC/FIN {d.nricMasked}</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.label}>Placement</Text>
            <Text style={s.val}>{d.teamName || "—"}</Text>
            <Text style={s.coMeta}>Reporting upline: {d.uplineName || "—"}</Text>
          </View>
        </View>

        {CLAUSES.map((c) => (
          <View key={c.h} wrap={false}>
            <Text style={s.clauseH}>{c.h}</Text>
            <Text style={s.para}>{c.p}</Text>
          </View>
        ))}

        <Text style={[s.para, { marginTop: 10 }]}>
          By signing below, the Associate acknowledges having read, understood, and agreed to this Agreement and the
          Enshrine commission plan, and confirms that the personal particulars submitted during onboarding are true and
          accurate.
        </Text>

        <View style={s.signRow}>
          <View style={s.signBox}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */}
            {d.signatureDataUrl ? <Image src={d.signatureDataUrl} style={s.sigImg} /> : <View style={{ height: 56 }} />}
            <View style={s.sigLine}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.fullName}</Text>
              <Text style={s.coMeta}>Associate signature</Text>
            </View>
          </View>
          <View style={s.signBox}>
            <View style={{ height: 56 }} />
            <View style={s.sigLine}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>For and on behalf of Enshrine</Text>
              <Text style={s.coMeta}>Countersigned on approval</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>
          Electronically signed via the Enshrine Virtual Office onboarding portal. A copy is retained in the Associate’s
          personnel file.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderAgreementPdf(d: AgreementData): Promise<Buffer> {
  return renderToBuffer(<AgreementDoc d={d} />);
}
