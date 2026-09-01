import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Referral & Marketing Partnership Agreement (consolidated menu, Sep 2026).
// Faithful e-form rendering of docs/agreement-templates/
// referral-marketing-partnership-agreement.pdf — clause text and numbering
// (1-13, 15, 16: the source skips 14) reproduced verbatim; blanks filled from
// the VendorReferral row. Vendor signs in person at submission; the Company
// countersigns at approval.
// ---------------------------------------------------------------------------

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: INK, fontFamily: "Helvetica", lineHeight: 1.55 },
  head: { borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 18 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  coName: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 2 },
  coEntity: { fontSize: 8, color: MUTED, textAlign: "right", fontFamily: "Helvetica-Oblique" },
  coMeta: { fontSize: 8, color: MUTED, marginTop: 4 },
  title: { fontSize: 12.5, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 14, letterSpacing: 0.4 },
  para: { fontSize: 9.5, marginBottom: 6, textAlign: "justify" },
  clauseH: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 3 },
  bullet: { flexDirection: "row", marginBottom: 2, paddingLeft: 10 },
  bulletDot: { width: 12, fontSize: 9.5 },
  bulletText: { flex: 1, fontSize: 9.5, textAlign: "justify" },
  fill: { fontFamily: "Helvetica-Bold" },
  signBlock: { marginTop: 22 },
  signTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  signRow: { flexDirection: "row", marginBottom: 4 },
  signLabel: { width: 90, fontSize: 9.5 },
  signValue: { flex: 1, fontSize: 9.5, borderBottomWidth: 0.8, borderBottomColor: INK, paddingBottom: 1 },
  sigImg: { width: 130, height: 44, objectFit: "contain" },
  footer: {
    position: "absolute", bottom: 30, left: 48, right: 48,
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 5,
    flexDirection: "row", justifyContent: "space-between",
  },
  footerText: { fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Oblique" },
});

function Head() {
  return (
    <View style={s.head} fixed>
      <View style={s.headRow}>
        <View>
          <Text style={s.coName}>ENSHRINE</Text>
        </View>
        <View>
          <Text style={s.coEntity}>Enshrine Pets Paradise Pte Ltd</Text>
          <Text style={s.coEntity}>UEN 202328981K</Text>
        </View>
      </View>
      <Text style={s.coMeta}>
        Address: 74 Lorong 6 Geylang Singapore 399226   Contact: 9009 9234   Email: contacts@enshrine.sg   Website: www.enshrine.sg
      </Text>
    </View>
  );
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>Enshrine Holdings Ptd Ltd</Text>
      <Text style={s.footerText}>Enshrine Services Pte Ltd</Text>
      <Text style={s.footerText}>Enshrine Pets Paradise Pte Ltd</Text>
      <Text style={s.footerText}>Enshrine Afterlife Planner Pte Ltd</Text>
    </View>
  );
}

function Clause({ n, title }: { n: string; title: string }) {
  return <Text style={s.clauseH}>{n}. {title}</Text>;
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={s.para}>{children}</Text>;
}

function B({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.bullet}>
      <Text style={s.bulletDot}>•</Text>
      <Text style={s.bulletText}>{children}</Text>
    </View>
  );
}

export type ReferralAgreementData = {
  agreementDate: Date | null;
  vendorName: string;
  vendorUen: string | null;
  vendorAddress: string | null;
  vendorSignerName: string | null;
  vendorSignerNric: string | null;
  vendorSignerDesignation: string | null;
  vendorSignatureDataUrl: string | null;
  vendorSignedDate: Date | null;
  companySignName: string | null;
  companySignDesignation: string | null;
  companySignatureDataUrl: string | null;
  companySignedAt: Date | null;
};

const dash = "________________";
const d = (v: string | null | undefined) => (v && v.trim() ? v : dash);
const dt = (v: Date | null | undefined) => (v ? format(v, "dd MMMM yyyy") : dash);

function AgreementDoc({ a }: { a: ReferralAgreementData }) {
  return (
    <Document title="Referral & Marketing Partnership Agreement">
      <Page size="A4" style={s.page}>
        <Head />
        <Text style={s.title}>REFERRAL & MARKETING PARTNERSHIP AGREEMENT</Text>

        <P>
          This Referral & Marketing Partnership Agreement (“Agreement”) is made on this{" "}
          <Text style={s.fill}>{a.agreementDate ? format(a.agreementDate, "do") : dash}</Text> day of{" "}
          <Text style={s.fill}>{a.agreementDate ? format(a.agreementDate, "MMMM") : dash}</Text>{" "}
          <Text style={s.fill}>{a.agreementDate ? format(a.agreementDate, "yyyy") : "20____"}</Text>.
        </P>

        <Text style={s.clauseH}>BETWEEN</Text>
        <P>
          <Text style={s.fill}>ENSHRINE PETS PARADISE PTE. LTD.  (UEN: 202328981K)</Text> a company incorporated in
          Singapore with its registered office at <Text style={s.fill}>74 Lorong 6 Geylang Singapore 399226.</Text>{" "}
          (hereinafter referred to as the “Company”)
        </P>
        <Text style={s.clauseH}>AND</Text>
        <P>
          <Text style={s.fill}>{d(a.vendorName)}</Text> (UEN/NRIC: <Text style={s.fill}>{d(a.vendorUen)}</Text>) of
          address <Text style={s.fill}>{d(a.vendorAddress)}</Text> (hereinafter referred to as the “Vendor”)
        </P>
        <P>
          The Company and the Vendor shall collectively be referred to as the “Parties” and individually as a “Party”.
        </P>

        <Clause n="1" title="PURPOSE" />
        <P>1.1 The Company is engaged in the business of providing pet afterlife services, including but not limited to pet columbarium niches, ash storage, memorial services, cremation arrangements, and related services.</P>
        <P>1.2 The Vendor wishes to refer potential customers to the Company and assist in the marketing and promotion of the Company’s services, subject to the terms and conditions of this Agreement.</P>
        <P>1.3 This Agreement shall constitute a non-exclusive referral and marketing arrangement between the Parties.</P>

        <Clause n="2" title="APPOINTMENT" />
        <P>2.1 The Company hereby appoints the Vendor as a non-exclusive Referral & Marketing Partner for the promotion and referral of the Company’s services.</P>
        <P>2.2 The Vendor shall be entitled to introduce and refer potential customers to the Company for the Company’s services.</P>
        <P>2.3 Nothing in this Agreement shall be construed as creating any partnership, joint venture, employment, agency, or fiduciary relationship between the Parties.</P>
        <Footer />
      </Page>

      <Page size="A4" style={s.page}>
        <Head />
        <Clause n="3" title="SCOPE OF SERVICES" />
        <P>3.1 The Vendor may:</P>
        <B>introduce prospective customers to the Company;</B>
        <B>distribute marketing materials approved by the Company;</B>
        <B>promote the Company’s services through lawful means; and</B>
        <B>facilitate communication between customers and the Company.</B>
        <P>3.2 The Vendor shall not:</P>
        <B>make any representation, warranty, or promise on behalf of the Company unless authorised in writing;</B>
        <B>alter the pricing, terms, or conditions of the Company’s services;</B>
        <B>enter into any contract on behalf of the Company; or</B>
        <B>collect any payment on behalf of the Company unless expressly authorised in writing.</B>

        <Clause n="4" title="MARKETING MATERIALS & BRANDING" />
        <P>4.1 The Company may provide brochures, logos, marketing materials, and promotional content to the Vendor for the purposes of this Agreement.</P>
        <P>4.2 All intellectual property rights relating to the Company’s name, logo, branding, materials, and services shall remain the sole property of the Company.</P>
        <P>4.3 The Vendor shall not modify, reproduce, or use the Company’s branding or materials in any manner not approved by the Company.</P>

        <Clause n="5" title="VENDOR OBLIGATIONS" />
        <P>5.1 The Vendor shall:</P>
        <B>conduct itself professionally and ethically at all times;</B>
        <B>refrain from making misleading or inaccurate statements;</B>
        <B>comply with all applicable laws and regulations; and</B>
        <B>avoid any conduct that may damage the reputation or goodwill of the Company.</B>
        <P>5.2 The Vendor shall immediately notify the Company of any customer complaints or disputes relating to the Company’s services.</P>

        <Clause n="6" title="CUSTOMER RELATIONSHIP" />
        <P>6.1 All customers referred to the Company shall remain customers of the Company.</P>
        <P>6.2 The Company shall have sole discretion over:</P>
        <B>acceptance of customers;</B>
        <B>pricing;</B>
        <B>service arrangements; and</B>
        <B>contractual terms with customers.</B>
        <Footer />
      </Page>

      <Page size="A4" style={s.page}>
        <Head />
        <Clause n="7" title="CONFIDENTIALITY" />
        <P>7.1 The Vendor shall keep confidential all non-public information relating to the Company, including but not limited to:</P>
        <B>pricing structures;</B>
        <B>customer information;</B>
        <B>business operations;</B>
        <B>commission arrangements; and</B>
        <B>marketing strategies.</B>
        <P>7.2 The Vendor shall not disclose such information to any third party without the prior written consent of the Company.</P>
        <P>7.3 This Clause shall survive the termination of this Agreement.</P>

        <Clause n="8" title="INDEPENDENT CONTRACTOR" />
        <P>8.1 The Vendor is engaged as an independent contractor.</P>
        <P>8.2 Nothing in this Agreement shall render the Vendor:</P>
        <B>an employee of the Company;</B>
        <B>a partner of the Company;</B>
        <B>an agent authorised to bind the Company; or</B>
        <B>entitled to employee benefits, CPF contributions, or compensation of any nature unless otherwise agreed in writing.</B>

        <Clause n="9" title="LIMITATION OF AUTHORITY" />
        <P>9.1 The Vendor shall have no authority to bind the Company to any agreement, obligation, representation, warranty, or liability whatsoever.</P>
        <P>9.2 Any unauthorised undertaking made by the Vendor shall be the sole responsibility of the Vendor.</P>

        <Clause n="10" title="TERM & TERMINATION" />
        <P>10.1 This Agreement shall commence on the date first written above and shall continue unless terminated in accordance with this Clause.</P>
        <P>10.2 Either Party may terminate this Agreement by giving fourteen (14) days’ written notice to the other Party.</P>
        <P>10.3 The Company may terminate this Agreement immediately without prior notice if the Vendor:</P>
        <B>commits misconduct;</B>
        <B>breaches any provision of this Agreement;</B>
        <B>engages in conduct detrimental to the Company’s reputation;</B>
        <B>makes unauthorised representations; or</B>
        <B>violates any applicable law or regulation.</B>
        <P>10.4 Upon termination:</P>
        <B>the Vendor shall immediately cease using the Company’s marketing materials and branding;</B>
        <B>no further commission shall accrue after the termination date unless otherwise approved by the Company in writing; and</B>
        <B>all confidential information shall remain protected.</B>
        <Footer />
      </Page>

      <Page size="A4" style={s.page}>
        <Head />
        <Clause n="11" title="LIABILITY & INDEMNITY" />
        <P>11.1 The Company shall not be liable for any loss, damage, claim, or expense arising from the Vendor’s acts, omissions, representations, or conduct.</P>
        <P>11.2 The Vendor shall indemnify and hold harmless the Company against any claims, liabilities, damages, costs, or expenses arising from:</P>
        <B>the Vendor’s breach of this Agreement;</B>
        <B>negligence or misconduct of the Vendor; or</B>
        <B>unauthorised representations made by the Vendor.</B>

        <Clause n="12" title="NON-EXCLUSIVITY" />
        <P>12.1 This Agreement is non-exclusive.</P>
        <P>12.2 The Company shall be entitled to appoint other vendors, referral partners, distributors, or representatives at its sole discretion.</P>

        <Clause n="13" title="AMENDMENTS" />
        <P>13.1 The Company reserves the right to amend the terms of this Agreement from time to time.</P>
        <P>13.2 Any amendments shall take effect upon written notice to the Vendor.</P>

        <Clause n="15" title="GOVERNING LAW" />
        <P>15.1 This Agreement shall be governed by and construed in accordance with the laws of Singapore.</P>
        <P>15.2 The Parties submit to the exclusive jurisdiction of the Courts of Singapore.</P>

        <Clause n="16" title="ENTIRE AGREEMENT" />
        <P>16.1 This Agreement constitutes the entire agreement between the Parties and supersedes all prior discussions, representations, or understandings relating to its subject matter.</P>

        <Text style={s.clauseH}>IN WITNESS WHEREOF</Text>
        <P>The Parties hereto have executed this Agreement on the date first above written.</P>

        <View style={s.signBlock}>
          <Text style={s.signTitle}>SIGNED by Enshrine Pets Paradise Pte Ltd</Text>
          <View style={s.signRow}><Text style={s.signLabel}>Name</Text><Text style={s.signValue}>: {d(a.companySignName)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>Designation</Text><Text style={s.signValue}>: {d(a.companySignDesignation)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>Date</Text><Text style={s.signValue}>: {dt(a.companySignedAt)}</Text></View>
          {a.companySignatureDataUrl ? (
            /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */
            <Image src={a.companySignatureDataUrl} style={s.sigImg} />
          ) : null}
        </View>

        <View style={s.signBlock}>
          <Text style={s.signTitle}>SIGNED by Vendor  {d(a.vendorName)}</Text>
          <View style={s.signRow}><Text style={s.signLabel}>Name</Text><Text style={s.signValue}>: {d(a.vendorSignerName)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>NRIC No. / UEN</Text><Text style={s.signValue}>: {d(a.vendorSignerNric)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>Designation</Text><Text style={s.signValue}>: {d(a.vendorSignerDesignation)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>Date</Text><Text style={s.signValue}>: {dt(a.vendorSignedDate)}</Text></View>
          {a.vendorSignatureDataUrl ? (
            /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */
            <Image src={a.vendorSignatureDataUrl} style={s.sigImg} />
          ) : null}
        </View>
        <Footer />
      </Page>
    </Document>
  );
}

/** Render straight from form data (submission time — vendor just signed). */
export async function renderReferralAgreementPdfFromData(a: ReferralAgreementData): Promise<Buffer> {
  return await renderToBuffer(<AgreementDoc a={a} />);
}

/** Re-render from a stored VendorReferral row (approval time — adds the
 *  Company countersignature; signature PNGs are read back from storage). */
export async function renderReferralAgreementPdf(vendorReferralId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const v = await prisma.vendorReferral.findUnique({ where: { id: vendorReferralId } });
  if (!v) return null;

  const toDataUrl = async (key: string | null) => {
    if (!key) return null;
    const buf = await getObject(key);
    return buf ? `data:image/png;base64,${buf.toString("base64")}` : null;
  };

  const buffer = await renderToBuffer(
    <AgreementDoc
      a={{
        agreementDate: v.agreementDate,
        vendorName: v.vendorName,
        vendorUen: v.vendorUen,
        vendorAddress: v.vendorAddress,
        vendorSignerName: v.vendorSignerName,
        vendorSignerNric: v.vendorSignerNric,
        vendorSignerDesignation: v.vendorSignerDesignation,
        vendorSignatureDataUrl: await toDataUrl(v.vendorSignatureKey),
        vendorSignedDate: v.submittedAt,
        companySignName: v.companySignName,
        companySignDesignation: v.companySignDesignation,
        companySignatureDataUrl: await toDataUrl(v.companySignatureKey),
        companySignedAt: v.companySignedAt,
      }}
    />,
  );
  const safe = v.vendorName.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  return { buffer, filename: `Referral-Partnership-Agreement-${safe}.pdf` };
}
