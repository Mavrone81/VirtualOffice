import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Storage of Pets Ashes Agreement (consolidated menu, Sep 2026). Faithful
// e-form rendering of docs/agreement-templates/
// storage-of-pets-ashes-agreement-v2607.pdf — clauses 1-20 verbatim; blanks
// filled from the PetsAshesAgreement row. The applicant signs in person on the
// associate's device after the application-details form auto-fills this.
// ---------------------------------------------------------------------------

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";

const s = StyleSheet.create({
  page: { padding: 44, paddingBottom: 58, fontSize: 9, color: INK, fontFamily: "Helvetica", lineHeight: 1.45 },
  head: { borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 14 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  coName: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 2 },
  coEntity: { fontSize: 8, color: MUTED, textAlign: "right", fontFamily: "Helvetica-Oblique" },
  coMeta: { fontSize: 8, color: MUTED, marginTop: 4 },
  title: { fontSize: 11.5, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 12 },
  kvRow: { flexDirection: "row", marginBottom: 5 },
  kvLabel: { width: 170, fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  kvColon: { width: 14, fontSize: 9.5 },
  kvValue: { flex: 1, fontSize: 9.5, borderBottomWidth: 0.8, borderBottomColor: INK, paddingBottom: 1 },
  sectionH: { fontSize: 9.5, fontFamily: "Helvetica-Bold", textDecoration: "underline", marginTop: 8, marginBottom: 5 },
  table: { borderWidth: 1, borderColor: INK, marginBottom: 10 },
  thRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, backgroundColor: "#f4f1ea" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: INK, minHeight: 18 },
  trLast: { flexDirection: "row", minHeight: 18 },
  th: { fontSize: 8.5, fontFamily: "Helvetica-Bold", padding: 4, textAlign: "center" },
  td: { fontSize: 8.5, padding: 4, textAlign: "center" },
  cName: { flex: 2, borderRightWidth: 0.5, borderRightColor: INK },
  cBreed: { flex: 2, borderRightWidth: 0.5, borderRightColor: INK },
  cGender: { flex: 1, borderRightWidth: 0.5, borderRightColor: INK },
  cDob: { flex: 1.4, borderRightWidth: 0.5, borderRightColor: INK },
  cDismiss: { flex: 1.4 },
  para: { fontSize: 9, marginBottom: 5, textAlign: "justify" },
  numRow: { flexDirection: "row", marginBottom: 5 },
  numCol: { width: 22, fontSize: 9 },
  numBody: { flex: 1, fontSize: 9, textAlign: "justify" },
  subRow: { flexDirection: "row", marginBottom: 4, paddingLeft: 22 },
  subCol: { width: 24, fontSize: 9 },
  subBody: { flex: 1, fontSize: 9, textAlign: "justify" },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 4, paddingLeft: 22 },
  box: { width: 11, height: 11, borderWidth: 1, borderColor: INK, marginRight: 8, marginTop: 1, textAlign: "center", fontSize: 9, lineHeight: 1 },
  fill: { fontFamily: "Helvetica-Bold" },
  signBlock: { marginTop: 14 },
  signTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  signRow: { flexDirection: "row", marginTop: 3 },
  signLabel: { width: 110, fontSize: 9 },
  signValue: { flex: 1, fontSize: 9, borderBottomWidth: 0.8, borderBottomColor: INK, paddingBottom: 1 },
  sigImg: { width: 120, height: 40, objectFit: "contain" },
  footer: {
    position: "absolute", bottom: 26, left: 44, right: 44,
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 5,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Oblique" },
  pageNum: { fontSize: 7.5, color: MUTED, marginTop: 2 },
});

const dash = "________________";
const d = (v: string | null | undefined) => (v && v.trim() ? v : dash);

function Head() {
  return (
    <View style={s.head} fixed>
      <View style={s.headRow}>
        <Text style={s.coName}>ENSHRINE</Text>
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

function Footer({ page }: { page: number }) {
  return (
    <View style={s.footer} fixed>
      <View style={s.footerRow}>
        <Text style={s.footerText}>Enshrine Holdings Pte Ltd</Text>
        <Text style={s.footerText}>Enshrine Services Pte Ltd</Text>
        <Text style={s.footerText}>Enshrine Pets Paradise Pte Ltd</Text>
        <Text style={s.footerText}>Enshrine Afterlife Planner Pte Ltd</Text>
      </View>
      <View style={s.footerRow}>
        <Text style={s.pageNum}>Page {page} of 3</Text>
        <Text style={s.pageNum}>V2607</Text>
      </View>
    </View>
  );
}

function N({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <View style={s.numRow}>
      <Text style={s.numCol}>{n}.</Text>
      <Text style={s.numBody}>{children}</Text>
    </View>
  );
}

function Sub({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <View style={s.subRow}>
      <Text style={s.subCol}>({n})</Text>
      <Text style={s.subBody}>{children}</Text>
    </View>
  );
}

export type AshesPet = {
  name?: string;
  breed?: string;
  gender?: string;
  dob?: string;
  dateDismissed?: string;
};

export type AshesAgreementData = {
  storageSpaceLocation: string | null;
  nicheUnit: string | null;
  pets: AshesPet[];
  applicant1Name: string;
  applicant1Nric: string | null;
  applicant1Address: string | null;
  applicant1Contact: string | null;
  applicant1Email: string | null;
  applicant2Name: string | null;
  applicant2Nric: string | null;
  applicant2Address: string | null;
  applicant2Contact: string | null;
  applicant2Email: string | null;
  amountNumeric: string; // decimal string
  amountWords: string;
  paymentPlan: "FullPayment" | "Installment";
  bookingFee: string | null;
  monthlyInstalment: string | null;
  instalmentDayOfMonth: number | null;
  maintenanceStartYear: number | null;
  additionalTerms: string | null;
  signedAt: Date | null;
  applicantSignatureDataUrl: string | null;
  applicantWitnessName: string | null;
  applicantWitnessNric: string | null;
  companyWitnessName: string | null;
  companyWitnessNric: string | null;
};

function PetTable({ pets }: { pets: AshesPet[] }) {
  const rows: (AshesPet | null)[] = [...pets];
  while (rows.length < 5) rows.push(null); // visual blanks like the paper form
  return (
    <View style={s.table}>
      <View style={s.thRow}>
        <Text style={[s.th, s.cName]}>Pet Name</Text>
        <Text style={[s.th, s.cBreed]}>Breed</Text>
        <Text style={[s.th, s.cGender]}>Gender</Text>
        <Text style={[s.th, s.cDob]}>Date of Birth</Text>
        <Text style={[s.th, s.cDismiss]}>Date of Dismissed</Text>
      </View>
      {rows.map((p, i) => (
        <View key={i} style={i === rows.length - 1 ? s.trLast : s.tr}>
          <Text style={[s.td, s.cName]}>{p?.name ?? " "}</Text>
          <Text style={[s.td, s.cBreed]}>{p?.breed ?? " "}</Text>
          <Text style={[s.td, s.cGender]}>{p?.gender ?? " "}</Text>
          <Text style={[s.td, s.cDob]}>{p?.dob ?? " "}</Text>
          <Text style={[s.td, s.cDismiss]}>{p?.dateDismissed ?? " "}</Text>
        </View>
      ))}
    </View>
  );
}

function Applicant({ n, name, nric, address, contact, email }: {
  n: number; name: string | null; nric: string | null; address: string | null; contact: string | null; email: string | null;
}) {
  return (
    <View>
      <Text style={s.sectionH}>Applicant’s Particulars ({n})</Text>
      {n === 1 && <Text style={{ fontSize: 8, fontFamily: "Helvetica-Oblique", marginBottom: 3 }}>(hereinafter known as “the Applicant”)</Text>}
      <View style={s.kvRow}>
        <Text style={{ width: 46, fontSize: 9.5 }}>Name :</Text>
        <Text style={[s.kvValue, { marginRight: 14 }]}>{d(name)}</Text>
        <Text style={{ width: 60, fontSize: 9.5 }}>NRIC No. :</Text>
        <Text style={s.kvValue}>{d(nric)}</Text>
      </View>
      <View style={s.kvRow}>
        <Text style={{ width: 52, fontSize: 9.5 }}>Address :</Text>
        <Text style={s.kvValue}>{d(address)}</Text>
      </View>
      <View style={s.kvRow}>
        <Text style={{ width: 52, fontSize: 9.5 }}>Contact :</Text>
        <Text style={[s.kvValue, { marginRight: 14 }]}>{d(contact)}</Text>
        <Text style={{ width: 40, fontSize: 9.5 }}>Email:</Text>
        <Text style={s.kvValue}>{d(email)}</Text>
      </View>
    </View>
  );
}

function AgreementDoc({ a }: { a: AshesAgreementData }) {
  const isFull = a.paymentPlan === "FullPayment";
  return (
    <Document title="Storage of Pets Ashes Agreement">
      {/* ------------------------------------------------ Page 1 */}
      <Page size="A4" style={s.page}>
        <Head />
        <Text style={s.title}>Storage of Pets Ashes Agreement</Text>

        <View style={s.kvRow}>
          <Text style={s.kvLabel}>Location of Columbarium</Text>
          <Text style={s.kvColon}>:</Text>
          <Text style={{ flex: 1, fontSize: 9.5 }}>47 Lorong 16 Geylang Singapore 398880</Text>
        </View>
        <View style={s.kvRow}>
          <Text style={s.kvLabel}>Location of Storage Space</Text>
          <Text style={s.kvColon}>:</Text>
          <Text style={s.kvValue}>{d(a.storageSpaceLocation)}</Text>
        </View>

        <Text style={s.sectionH}>Pet’s Particulars</Text>
        <PetTable pets={a.pets} />

        <Applicant n={1} name={a.applicant1Name} nric={a.applicant1Nric} address={a.applicant1Address} contact={a.applicant1Contact} email={a.applicant1Email} />
        <Applicant n={2} name={a.applicant2Name} nric={a.applicant2Nric} address={a.applicant2Address} contact={a.applicant2Contact} email={a.applicant2Email} />

        <Text style={[s.para, { marginTop: 6 }]}>
          <Text style={s.fill}>WHEREBY IT IS AGREED</Text> as follows:-
        </Text>
        <N n="1">
          Enshrine Pets Paradise Pte Ltd (hereinafter known as “the Company”) agrees to let and the Applicant agrees to take Pet
          Ash Storage unit known as <Text style={s.fill}>{d(a.nicheUnit)}</Text> (hereinafter known as “the said niche”) at the amount
          of <Text style={s.fill}>SINGAPORE DOLLARS {a.amountWords}</Text> (S$<Text style={s.fill}>{a.amountNumeric}</Text>) payable:-
        </N>
        <View style={s.checkboxRow}>
          <Text style={s.box}>{isFull ? "X" : " "}</Text>
          <Text style={{ flex: 1, fontSize: 9 }}>
            <Text style={s.fill}>Full Payment</Text> upon signing of Storage of Pets Ashes Agreement.
          </Text>
        </View>
        <View style={s.checkboxRow}>
          <Text style={s.box}>{isFull ? " " : "X"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9 }}><Text style={s.fill}>Instalment Payment</Text></Text>
            <Text style={{ fontSize: 9 }}>-   12 Months Interest Free Instalment.</Text>
            <Text style={{ fontSize: 9 }}>
              -   Booking Fee for the amount of (S$<Text style={s.fill}>{isFull ? dash : d(a.bookingFee)}</Text>) payable upon signing of Storage of Pets Ashes Agreement.
            </Text>
            <Text style={{ fontSize: 9 }}>
              -   Subsequent monthly instalment for the amount of (S$<Text style={s.fill}>{isFull ? dash : d(a.monthlyInstalment)}</Text>) payable monthly in advance without
              deduction whatsoever on the <Text style={s.fill}>{isFull || !a.instalmentDayOfMonth ? "____" : String(a.instalmentDayOfMonth)}</Text> day of each calendar month for a period of 12 calendar months.
            </Text>
          </View>
        </View>
        <Footer page={1} />
      </Page>

      {/* ------------------------------------------------ Page 2 */}
      <Page size="A4" style={s.page}>
        <Head />
        <N n="2">
          The Applicant agrees to pay the maintenance fee for the Storage of Pet Ashes:-{"\n"}
          <Text style={s.fill}>Annual Maintenance Fee</Text> for the amount of <Text style={s.fill}>S$10.00</Text> starting from{" "}
          <Text style={s.fill}>1st day January {a.maintenanceStartYear ?? "20____"}</Text>.{"\n"}
          - Annual Maintenance Fee shall be payable annually in advance without deduction whatsoever on the <Text style={s.fill}>1st day of January</Text> of each calendar year.
        </N>
        <N n="3">The Applicant agrees the said maintenance fee and/or instalment payment at the times and in manner aforesaid.</N>
        <Sub n="i">
          In the event that the annual maintenance fee payable hereunder remains unpaid for a period of three (3) months after
          the due date, the Company shall be entitled, at its sole discretion and without further notice, to suspend and/or
          terminate the Applicant’s access to the premises.
        </Sub>
        <N n="4">The fee is for the storage of ashes in the storage space includes the urn, standard size photo and standard memorial wording.</N>
        <N n="5">The Applicant’s NRIC or Passport and this Agreement must be produced for verification at the time of storage of ashes in a storage space.</N>
        <N n="6">The said storage space that is selected by the applicant shall be used to store only the cremated ashes of the dismissed pet specified in this agreement and shall not be used to store the ashes of any other dismissed pet.</N>
        <N n="7">All storage space shall be used for the storage of cremated pet ashes only.</N>
        <N n="8">The Company shall not be responsible for any damage to any niche or for any spillage, damage or loss of ashes stored in a storage space being destroyed or damaged by fire, lightning, Riot, explosion, or any other cause beyond the control of the parties.</N>
        <N n="9">The Applicant may apply to upgrade or downgrade from the storage space previously selected and re-select another storage space and the Applicant shall pay any additional fees payable together with his application for upgrading.  There shall be no refund of the difference in fee for downgrading.</N>
        <N n="10">The Company may by giving the Applicant a notice in writing, repossess the niche if at any time:</N>
        <Sub n="i">the applicant breaches any term and condition relating to the storage of ashes and/or rule and regulation herein as well as any rule and regulation pertaining to the premise that may be imposed from time to time; or</Sub>
        <Sub n="ii">the premise is affected by the Government’s redevelopment or clearance plans.</Sub>
        <N n="11">
          The Applicant acknowledges and agrees that the intended location of the pet columbarium at 47 Lorong 16 Geylang,
          Singapore 398880 (the “Premises”) is currently under construction and may be subject to change or relocation at the sole
          discretion of the Company in accordance with the terms of this Agreement.
        </N>
        <Sub n="i">During the construction period, the Company shall be entitled, at its sole discretion, to relocate the Premises to such other location as it deems more suitable or appropriate.</Sub>
        <Sub n="ii">In the event of such relocation, the Applicant shall have the option to terminate this Agreement by written notice to the Company, whereupon the Company shall refund all sums paid by the Applicant, less an administrative fee of S$120.</Sub>
        <Sub n="iii">The Applicant acknowledges and agrees that any change or relocation of the Premises pursuant to this Clause shall not constitute a breach of this Agreement or give rise to any claim against the Company.</Sub>
        <N n="12">All notices shall be deemed to be given if they are:-</N>
        <Sub n="i">placed on advertisement(s) in any public media; or</Sub>
        <Sub n="ii">posted and addressed to the applicant(s) his registered address in this agreement.</Sub>
        <N n="13">In the event that a niche is repossessed under Clause 10:-</N>
        <Sub n="i">the applicant shall collect the ashes of the dismissed pet from the premise within the period as specified in the notice of repossession. Should he/she fail to do so, the Company may dispose off the ashes without further notice;</Sub>
        <Footer page={2} />
      </Page>

      {/* ------------------------------------------------ Page 3 */}
      <Page size="A4" style={s.page}>
        <Head />
        <Sub n="ii">an applicant shall not be entitled to any refund of any fees or compensation from the Government or the Company; and</Sub>
        <Sub n="iii">The Company may in its absolute discretion offer an applicant a replacement niche for the storage of ashes in another premise, subject to any new terms and conditions, if applicable.</Sub>
        <N n="14">
          The applicant shall adhere to all rules and regulations pertaining to the columbarium that may from time to time be
          imposed by the Company.{"\n"}
          15.  Without prejudice to Clause 10(i), where the applicant breaches any term and condition and/or rules and regulations
          herein and/or any rules and regulations pertaining to the premise that may be imposed from time to time, the applicant
          shall be liable to the Company for any costs, expenses or charges that may be incurred by the Company as a result of
          the breach.
        </N>
        <N n="16">Rules and Regulations</N>
        <Sub n="i">All visitors to the premise are requested to observe proper respect for all dismissed pet and act accordingly with care and consideration for all.</Sub>
        <Sub n="ii">No person shall erect any structure, platform or other extension at or around the storage space or in any other area within the premise.</Sub>
        <Sub n="iii">Any food or other perishable items placed in the niche rooms are to be cleared before leaving the premises.</Sub>
        <Sub n="iv">No person shall burn any joss paper, joss stick, candle or large paper offerings within the premise.</Sub>
        <Sub n="v">The Company may also, if it deems necessary for maintaining the tidiness and orderliness of the premise, remove any hazardous, unsightly or otherwise inappropriate items deposited by any person on any part of the premise.</Sub>
        <N n="17">The terms and conditions contained herein supersede any information given by the parties or the parties’ agent(s) and this contract shall solely govern the rights of the parties save and except those mutually agreed in writing between the parties.</N>
        <N n="18">No representation, promise, inducement, or statement of intention has been made by the parties or any of the parties’ agent(s) which is not embodied in this contract. Neither the parties nor their agent(s) shall be bound by or liable for any alleged representation, promise, inducement, or statement of intention not so set forth.</N>
        <N n="19">This contract shall be subject to the laws of the Republic of Singapore and the parties herein submit themselves to the jurisdiction of the Singapore Courts.</N>
        <N n="20">Additional Terms:  <Text style={s.fill}>{a.additionalTerms?.trim() || dash}</Text></N>

        <Text style={[s.para, { marginTop: 10 }]}>
          <Text style={s.fill}>IN WITNESS WHEREOF</Text> the parties have hereunto set their hands this{" "}
          <Text style={s.fill}>{a.signedAt ? format(a.signedAt, "do") : "____"}</Text> day of{" "}
          <Text style={s.fill}>{a.signedAt ? format(a.signedAt, "MMMM") : dash}</Text> year{" "}
          <Text style={s.fill}>{a.signedAt ? format(a.signedAt, "yyyy") : dash}</Text>.
        </Text>

        <View style={s.signBlock}>
          <Text style={s.signTitle}>SIGNED by the Company</Text>
          <Text style={{ fontSize: 8, fontFamily: "Helvetica-Oblique" }}>(With Company stamp affixed where applicable)</Text>
          <View style={s.signRow}><Text style={s.signLabel}>Name</Text><Text style={s.signValue}>:  Enshrine Pets Paradise Pte Ltd</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>UEN No.</Text><Text style={s.signValue}>:  202328981K</Text></View>
          <View style={[s.signRow, { marginTop: 8 }]}><Text style={s.signLabel}>In the presence of</Text><Text style={{ flex: 1 }}> </Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>Name</Text><Text style={s.signValue}>: {d(a.companyWitnessName)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>NRIC No.</Text><Text style={s.signValue}>: {d(a.companyWitnessNric)}</Text></View>
        </View>

        <View style={s.signBlock}>
          <Text style={s.signTitle}>SIGNED by the Applicant</Text>
          <View style={s.signRow}><Text style={s.signLabel}>Name</Text><Text style={s.signValue}>: {d(a.applicant1Name)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>NRIC No.</Text><Text style={s.signValue}>: {d(a.applicant1Nric)}</Text></View>
          {a.applicantSignatureDataUrl ? (
            /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */
            <Image src={a.applicantSignatureDataUrl} style={s.sigImg} />
          ) : null}
          <View style={[s.signRow, { marginTop: 8 }]}><Text style={s.signLabel}>In the presence of</Text><Text style={{ flex: 1 }}> </Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>Name</Text><Text style={s.signValue}>: {d(a.applicantWitnessName)}</Text></View>
          <View style={s.signRow}><Text style={s.signLabel}>NRIC No.</Text><Text style={s.signValue}>: {d(a.applicantWitnessNric)}</Text></View>
        </View>
        <Footer page={3} />
      </Page>
    </Document>
  );
}

/** Render from a stored PetsAshesAgreement row; the applicant's signature PNG
 *  is read back from storage when present. */
export async function renderAshesAgreementPdf(agreementId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const a = await prisma.petsAshesAgreement.findUnique({
    where: { id: agreementId },
    include: { submission: { select: { clientName: true } } },
  });
  if (!a) return null;

  let applicantSignatureDataUrl: string | null = null;
  if (a.applicantSignatureKey) {
    const buf = await getObject(a.applicantSignatureKey);
    if (buf) applicantSignatureDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  }

  const buffer = await renderToBuffer(
    <AgreementDoc
      a={{
        storageSpaceLocation: a.storageSpaceLocation,
        nicheUnit: a.nicheUnit,
        pets: (a.pets as AshesPet[]) ?? [],
        applicant1Name: a.applicant1Name,
        applicant1Nric: a.applicant1Nric,
        applicant1Address: a.applicant1Address,
        applicant1Contact: a.applicant1Contact,
        applicant1Email: a.applicant1Email,
        applicant2Name: a.applicant2Name,
        applicant2Nric: a.applicant2Nric,
        applicant2Address: a.applicant2Address,
        applicant2Contact: a.applicant2Contact,
        applicant2Email: a.applicant2Email,
        amountNumeric: a.amountNumeric.toFixed(2),
        amountWords: a.amountWords,
        paymentPlan: a.paymentPlan === "FullPayment" ? "FullPayment" : "Installment",
        bookingFee: a.bookingFee ? a.bookingFee.toFixed(2) : null,
        monthlyInstalment: a.monthlyInstalment ? a.monthlyInstalment.toFixed(2) : null,
        instalmentDayOfMonth: a.instalmentDayOfMonth,
        maintenanceStartYear: a.maintenanceStartYear,
        additionalTerms: a.additionalTerms,
        signedAt: a.signedAt,
        applicantSignatureDataUrl,
        applicantWitnessName: a.applicantWitnessName,
        applicantWitnessNric: a.applicantWitnessNric,
        companyWitnessName: a.companyWitnessName,
        companyWitnessNric: a.companyWitnessNric,
      }}
    />,
  );
  const safe = a.submission.clientName.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  return { buffer, filename: `Storage-of-Pets-Ashes-Agreement-${safe}.pdf` };
}
