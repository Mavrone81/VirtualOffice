import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Associate Agreement — faithful rendering of the official template
// "Associate Agreement V.2026-04" (docs/agreement-templates/…). Clauses 1-23
// reproduced verbatim; the particulars table and the miscellaneous/signature
// page mirror the paper form. Fields the onboarding captures are filled; the
// rest render as blank rules exactly like the printed form.
// ---------------------------------------------------------------------------

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#c9c4b8";
const GOLD = "#8a6d1f";

const s = StyleSheet.create({
  page: { paddingTop: 104, paddingBottom: 60, paddingHorizontal: 50, fontSize: 8.5, color: INK, fontFamily: "Times-Roman", lineHeight: 1.4 },
  head: { position: "absolute", top: 30, left: 50, right: 50 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 17, fontFamily: "Times-Bold", letterSpacing: 3, color: GOLD },
  entity: { fontSize: 8, color: INK, textAlign: "right", fontFamily: "Times-Italic" },
  headRule: { borderBottomWidth: 1.5, borderBottomColor: GOLD, marginTop: 4 },
  addr: { fontSize: 7.5, color: INK, marginTop: 3 },
  footer: { position: "absolute", bottom: 26, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7.5, color: MUTED },
  title: { fontSize: 12, fontFamily: "Times-Bold", textAlign: "center", marginBottom: 10 },
  intro: { fontSize: 9, marginBottom: 10, textAlign: "justify" },
  table: { borderWidth: 1, borderColor: INK, marginBottom: 12 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK },
  tRowLast: { flexDirection: "row" },
  tCell: { padding: 5, flex: 1 },
  tCellDiv: { borderRightWidth: 1, borderRightColor: INK },
  tLabel: { fontSize: 8.5, fontFamily: "Times-Bold" },
  tHint: { fontSize: 7.5, fontFamily: "Times-Italic", color: MUTED },
  tVal: { fontSize: 9, marginTop: 2 },
  partiesHead: { fontSize: 9, fontFamily: "Times-Bold", marginTop: 4, marginBottom: 6 },
  secH: { fontSize: 9.5, fontFamily: "Times-Bold", marginTop: 9, marginBottom: 3 },
  clauseRow: { flexDirection: "row", marginBottom: 3 },
  clauseNum: { width: 26, fontSize: 8.5 },
  clauseBody: { flex: 1, fontSize: 8.5, textAlign: "justify" },
  subRow: { flexDirection: "row", marginBottom: 2, paddingLeft: 26 },
  subNum: { width: 20, fontSize: 8.5 },
  subBody: { flex: 1, fontSize: 8.5, textAlign: "justify" },
  plain: { fontSize: 8.5, marginBottom: 3, textAlign: "justify" },
  bold: { fontFamily: "Times-Bold" },
  declare: { fontSize: 8.5, fontFamily: "Times-Bold", marginTop: 12, marginBottom: 8, textAlign: "justify" },
  witness: { fontSize: 9, marginBottom: 14 },
  signGrid: { marginTop: 6 },
  signRow: { flexDirection: "row", marginBottom: 3 },
  signLabel: { width: 220, fontSize: 9 },
  sigImg: { width: 150, height: 46, objectFit: "contain", marginVertical: 4 },
  officialH: { fontSize: 8.5, fontFamily: "Times-Bold", marginTop: 22, marginBottom: 4 },
});

const dash = "____________________";
const d = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : dash);
function fmtDate(v: string | null | undefined): string {
  if (!v) return dash;
  const parsed = /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : null;
  return parsed && !isNaN(parsed.getTime()) ? format(parsed, "dd/MM/yyyy") : v;
}

function Head() {
  return (
    <View style={s.head} fixed>
      <View style={s.headRow}>
        <Text style={s.brand}>ENSHRINE</Text>
        <View>
          <Text style={s.entity}>Enshrine Services Pte Ltd</Text>
          <Text style={s.entity}>Enshrine Pets Paradise Pte Ltd</Text>
          <Text style={s.entity}>Enshrine Afterlife Planner Pte Ltd</Text>
        </View>
      </View>
      <View style={s.headRule} />
      <Text style={s.addr}>Address: 74 Lorong 6 Geylang Singapore 399226   Contact: 9009 9234   Email: contacts@enshrine.sg   Website: www.enshrine.sg</Text>
    </View>
  );
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}> </Text>
      <Text style={s.footerText}>V.2026-04</Text>
    </View>
  );
}

function C({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <View style={s.clauseRow} wrap={false}>
      <Text style={s.clauseNum}>{n}</Text>
      <Text style={s.clauseBody}>{children}</Text>
    </View>
  );
}
function Sub({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <View style={s.subRow} wrap={false}>
      <Text style={s.subNum}>{n}</Text>
      <Text style={s.subBody}>{children}</Text>
    </View>
  );
}

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
  // Official V.2026-04 particulars (filled where captured, else blank rules).
  businessName?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  homeAddress?: string | null;
  religion?: string | null;
  commencementDate?: string | null;
  spouseConflict?: boolean | null;
  spouseName?: string | null;
  spouseCompany?: string | null;
  spouseDesignation?: string | null;
  emergencyName?: string | null;
  emergencyRelationship?: string | null;
  emergencyAddress?: string | null;
  emergencyContact?: string | null;
  associateId?: string | null;
  tier1Manager?: string | null;
  tier2Manager?: string | null;
};

function ParticularsTable({ a }: { a: AgreementData }) {
  return (
    <View style={s.table}>
      <View style={s.tRow}>
        <View style={s.tCell}>
          <Text style={s.tLabel}>Name of Applicant as in NRIC/Passport:</Text>
          <Text style={s.tVal}>{d(a.fullName)}</Text>
          <Text style={s.tHint}>(hereinafter known as “the Associate”)</Text>
        </View>
      </View>
      <View style={s.tRow}>
        <View style={s.tCell}>
          <Text style={s.tLabel}>Business Name: <Text style={s.tHint}>(allowed to be reflected on name card and marketing materials)</Text></Text>
          <Text style={s.tVal}>{d(a.businessName)}</Text>
        </View>
      </View>
      <View style={s.tRow}>
        <View style={[s.tCell, s.tCellDiv]}><Text style={s.tLabel}>NRIC No:</Text><Text style={s.tVal}>{d(a.nricMasked)}</Text></View>
        <View style={s.tCell}><Text style={s.tLabel}>Nationality:</Text><Text style={s.tVal}>{d(a.nationality)}</Text></View>
      </View>
      <View style={s.tRow}>
        <View style={[s.tCell, s.tCellDiv]}><Text style={s.tLabel}>Date of Birth (dd/mm/yyyy)</Text><Text style={s.tVal}>{fmtDate(a.dateOfBirth)}</Text></View>
        <View style={[s.tCell, s.tCellDiv]}><Text style={s.tLabel}>Gender:</Text><Text style={s.tVal}>{d(a.gender)}</Text></View>
        <View style={s.tCell}><Text style={s.tLabel}>Marital Status:</Text><Text style={s.tVal}>{d(a.maritalStatus)}</Text></View>
      </View>
      <View style={s.tRowLast}>
        <View style={[s.tCell, s.tCellDiv, { flex: 2 }]}><Text style={s.tLabel}>Home Address:</Text><Text style={s.tVal}>{d(a.homeAddress)}</Text></View>
        <View style={[s.tCell, s.tCellDiv]}><Text style={s.tLabel}>Mobile No:</Text><Text style={s.tVal}>{d(a.mobile)}</Text></View>
        <View style={s.tCell}><Text style={s.tLabel}>Religion:</Text><Text style={s.tVal}>{d(a.religion)}</Text></View>
      </View>
    </View>
  );
}

function AgreementDoc({ a }: { a: AgreementData }) {
  return (
    <Document title={`Associate Agreement — ${a.fullName}`} author="Enshrine">
      <Page size="A4" style={s.page}>
        <Head />
        <Footer />

        <Text style={s.title}>ASSOCIATE AGREEMENT</Text>
        <Text style={s.intro}>
          THIS AGREEMENT is made on the {dash} day of {dash} 20{dash} between{" "}
          <Text style={s.bold}>M/S ENSHRINE HOLDINGS PTE LTD - UEN Number 202328861K</Text> (hereinafter known as “the Company”) of the one part and
        </Text>

        <ParticularsTable a={a} />

        <Text style={s.partiesHead}>The parties hereby agrees as follows:-</Text>

        <Text style={s.secH}>1. APPOINTMENT</Text>
        <C n="1.1">The company appoints the Associate, who is an independent contractor and is not and shall not be deemed to be a servant, agent or employee of the Company. The Associate shall undertake to be solely responsible for all taxes or charges imposed by any authority against him and shall personally indemnify and hold the Company harmless against the same. Nothing in this Agreement shall constitute a partnership or employment between the Company and the Associate. The Associate shall not represent and/or hold himself/herself out as a director, shareholder and/or employee of the Company and shall not make any representation which may incur the Company any liabilities.</C>
        <C n="1.2">The Associate is aware and agrees that to be registered as an Associate, he must be considered a “fit and proper person” which means he has not:-</C>
        <Sub n="a.">Been convicted of an offence involving fund fraud or dishonesty.</Sub>
        <Sub n="b.">Had a judgement entered against him/her in civil proceedings that involve a finding of fraud, dishonesty or breach of fiduciary duties on his part.</Sub>
        <C n="1.3">Have attained the age 18 years old;</C>
        <C n="1.4">Be or will be employed by the Company as an Associate and must not hold any position and/or is not an employee, a director or a partner of a person who holds another funeral related, supplier and/or afterlife related company.</C>
        <C n="1.5">The Associate agrees and undertake that he is associated solely with the Company and shall not to be registered and/or act as an Associate for more than one funeral related, supplier and/or afterlife related company at any one time. Neither shall the Associate be engage in any form of afterlife related services, nor accept commissions for the supply of any afterlife related services from any other person, firm or corporation. If the Associate has breached this covenant, then it is mutually agreed, without prejudice to the Company’s other remedies herein or at law or equity, that as agreed liquidated damages for this breach, the Company shall retain for itself any commission due to the Associate in respect of any or all transactions closed by him.</C>
        <C n="1.6">The Associate agrees to not proceed to make or receive any secret profits either directly or through any other parties.</C>
        <C n="1.7">The Associate agrees that any sums owing by the Associate to the Company at the termination of this Agreement shall be come immediately due and payable to the Company.</C>
        <C n="1.8">The Company will be at liberty to deduct all sums that is payable to the Company from any funds due and payable to the Associate. In event wherein there remains an outstanding amount, such amount shall be immediately due and payable by the Associate to the Company. The Company reserves all of its rights to commence legal proceedings without prior notice to the Associate to enforce the Company’s rights.</C>
        <C n="1.9">The Associate agrees and understand that where a legal offence has been committed by him and/or breach of any of the appointment agreement, no fee, commission or reward in relation to anything done shall be recoverable in any action, suit or matter by him.</C>
        <C n="1.10">The Associate undertakes that he shall at all times comply with and observe any codes of practice, ethics and conduct that is prescribed or issued and published by the Company (both expressed or implied), which may be amended from time to time at the Company’s sole discretion with or without advance written notice or otherwise to the Associate. Failing which he shall be liable to disciplinary action by the Company.</C>

        <Text style={s.secH}>2. FACILITIES</Text>
        <Text style={s.plain}>The Company shall provide to the Associate with trainings, supports and facilities at its sole discretion as it deems necessary/appropriate to conduct any sale and/or provide any afterlife related services.</Text>

        <Text style={s.secH}>3. CODE OR PRACTICE, ETHICS AND CONDUCTS</Text>
        <C n="3.1">The Associate agrees to work diligently and to use his best endeavours to sell and/or provide any afterlife related services listed with the Company, to solicit additional cases and customers and in all ways to promote the business of serving clients of the company as well as the public in afterlife related transactions to the end that the parties hereto may derive the greatest profit possible.</C>
        <C n="3.2">The Associate agrees to meet the minimum performance standards set by the Company.</C>
        <C n="3.3">The Associate also undertakes that he shall not engage and/or participate in any illegal arrangements or transactions whatsoever in all his dealings under the terms of his appointment strictly to the following protocol. In addition, the Associate is obliged to:</C>
        <Sub n="(a)">Respond to office or client’s paging and calls within 3 working days’</Sub>
        <Sub n="(b)">Inform the Company any changes to the contact numbers and/or correspondence address within 72 hours</Sub>
        <C n="3.4">In the event that any authorities including but not limited to the Police, IRAS, CPIB, PDPC commences any investigations against the Associate for whatsoever reasons and/or purposes, it is the duty of the Associate to disclose to the Company the details of such investigations immediately within twenty-four (24) hours of obtaining knowledge of such investigations. If the Company suffers any damages and/or losses including but not limited to the loss of reputation as a result of defending any such claims brought against the Company by any third parties as a result of the Associate’s failure to disclose such information or otherwise, the Associate irrevocably and unconditionally agrees to be personally liable and fully indemnify the Company for all the legal costs, expenses and/or disbursements incurred by the Company as a result thereof.</C>
        <C n="3.5">The Associate shall be personally liable for any unauthorised acts, tortious acts, misrepresentations, fraud or wilful misconduct committed by the Associate in the course of the afterlife related transaction and accordingly, the Associate hereby agrees to be personally liable and fully indemnifies the Company including all legal costs and/or disbursements incurred in the event of any claims or actions brought against the Company by any third parties arising out of the Associate’s unauthorised acts, tortious acts, misrepresentation or wilful conduct.</C>
        <C n="3.6">The Associate shall perform his work in a professional and ethical manner and the Associate shall not be involved in any act or make any statement which may tarnish or damage the image, reputation or goodwill of the Company, failing which the Associate shall be personally liable and fully indemnify the Company for any damages suffered including all any legal costs, expenses and/or disbursements suffered by the Company as a result thereof.</C>
        <C n="3.7">The Associate shall not indulge in monetary and/or other transactions other than those expressly permitted by the Company and which in the opinion of the Company is prejudicial or detrimental to the Company’s interest.</C>
        <C n="3.8">In the event any complaint is received against the Associate, he/she shall co-operate fully with the Company to resolve the same. If the Associate fails to render assistance when called to do so, the Company reserve the right to take such action, including replying to the complaint unilaterally or settling the dispute, in it’s sole and absolute discretion.</C>
        <C n="3.9">The Associate agrees to conform to and abide by all the requirements of the Personal Data Protection Act at all times.</C>
        <C n="3.10">The Associate will strictly abide by all policies and practices prescribed by the Company in relation to the Personal Data Protection Act at all times. The Associate further agrees to provide written acceptance of any further agreements relating to the Personal Data Protection Act immediately upon the request of the Company.</C>
        <C n="3.12">The Associate will not introduce, refer or recommend any party in the discharge of the Associate’s obligations pursuant to this Agreement to a moneylender nor would the Associate suggest the use of the services of a moneylender.</C>
        <C n="3.13">The Associate will not receive any commission, reward, fee, payment or other benefit whatsoever from any moneylender of any moneylending transaction.</C>

        <Text style={s.secH}>4. LEGAL EXPENSE</Text>
        <C n="4.1.">In the event that any transaction involving the Associate gives rise to any dispute, arbitration or legal proceedings, the Associate shall provide reasonable cooperation to the Company and shall be liable only for any losses, damages, legal costs or expenses directly arising from the Associate’s proven fraud, misconduct, gross negligence or unauthorised representations.</C>
        <C n="4.2.">In the event of any legal proceedings instituted by the Company against the Associate under any of the provision of this agreement for damages, the Associate hereby expressly undertakes and agrees to fully indemnify and be personally liable for the legal cost, expenses and disbursements incurred by the Company. Alternatively, the Associate agrees to give the Company sole right and discretion to deduct and/or set-off the full legal costs, including but not limited to expenses and disbursements from any new in-coming commission, Manager Overriding, and/or referral fees received by the Company with or without giving advance written notice to the Associates.</C>

        <Text style={s.secH}>5. EXPENSES</Text>
        <Text style={s.plain}>The Company shall not be liable to the Associate for any expenses incurred by the Associate or for any of the Associate’s acts. Without prejudice to the generality of the foregoing, the Associate undertakes that he shall be liable for his personal expenses on advertising and supplies including advertisements in all media, transport, name cards, flyers, mailing, postage photocopying, signages, oversea telephone calls, oversea faxes and stationery etc.</Text>

        <Text style={s.secH}>6. TRANSACTION PAYMENTS / COMMISION</Text>
        <C n="6.1">The Associate shall ensure that all transaction fees are paid to the respective Company by clients by way of</C>
        <Sub n="i.">Paynow via Company UEN</Sub>
        <Sub n="ii.">Bank transfer to Company Bank account number</Sub>
        <Sub n="iii.">Cheque made payable to respective company</Sub>
        <C n="6.2">The Associate will not at any point in time hold or handle any money for or on behalf of any party in relation to any transactions.</C>
        <C n="6.3">All monies, cheques, properties or securities received by the Associate for and on behalf of the Company shall be made in favour of the Company and not otherwise without the prior written consent of the Company. The Company shall, upon the receipt of the transaction fee, make payment of the commission between the Company and the Associate in the manner as agreed upon in this Agreement.</C>
        <C n="6.4">All transaction payments received by the Associate either in the form of cheques shall be held by the Associate in trust for the Company and submit to the Company (without any set-off, deduction or withholding whatsoever) within seven (7) days after they are received. In the event that the Associate should for whatever reason keep the transaction payments received without paying to the Company (hereinafter referred to as “the Undeclared Payments”), the Associate shall be deemed to have committed a breach of trust against the Company.</C>
        <C n="6.5">All property transactions undertaken by the Associate shall be declared and submitted by the Associate to the Company within two (2) weeks upon execution of ay relevant contracts and/or agreement pertaining to the sales and/or any afterlife related services rendered, failing which the Associate shall be deemed to have committed breach of trust against the Company.</C>
        <C n="6.6">Further and in addition to Clause 6.4 and 6.5 above, the Associate acknowledges that the Company has suffered losses as a result of his aforesaid action and hereby irrevocably and unconditionally agrees to forfeit to the Company all the referral fees and/or commission from any new transactions, Manager Overriding, including and/or referral fees received by the Company with or without giving advance written notice to the Associate. The Associate further agrees that the Company shall not be liable for any losses and/or damages suffered by the Associate as a result thereof.</C>
        <C n="6.7">In the event any transaction payment remains due and outstanding for whatever reason, whether in part or in full, the Associate shall institute recovery action without undue delay and in any case not more than one (1) month after such commission becomes due or shall satisfy the Company why such recovery action should not be taken. If the Associate fails to institute recovery action where appropriate, the Company is deemed to have suffered loss and the Associate shall be liable to the Company for such losses in accordance with the commission scheme. Furthermore, the Company shall have the absolute right in any case to pursue the claim for transaction payment on its own accord or write-off the same. For avoidance of doubt, this clause shall survive the resignation/termination of the Associate from the Company.</C>
        <C n="6.8">Notwithstanding anything herein contained, the Company reserves the right to make special arrangements regarding the division/split/distribution of commission. In the event of controversy, dispute and/or disagreement over the division of commission between two or more Associates, the Company shall have the sole discretion to divide the share of commission as it deems fit. Such discretion shall be deemed final and binding on the Associate and the Associate further agrees that the Company shall not be liable to any Associate for his commission in any manner whatsoever.</C>
        <C n="6.9">The Associate agrees that the Company shall at any time be entitled to:</C>
        <Sub n="i.">Withhold commission distribution for such period as the Company shall in its sole discretion deem fit, to the Associate of the whole or part of any monies however due to the Associate (whether by way of commission, Manager Overriding, and/or referral fee, and whether or not pursuant to the same transaction) in connection with any complaint, dispute or litigation involving the Associate;</Sub>
        <Sub n="ii.">set-off or deduct the whole or part of any monies howsoever owing by the Associate to the Company (whether or not pursuant to this Agreement, and whether or not pursuant to the same transaction) from the whole or any part of monies howsoever due to the Associate (whether by way of commission, Manager Overriding, and/or referral fee) and the shortfall, if any shall become immediately due and payable by the Associate to the Company;</Sub>
        <Sub n="iii.">The Company reserves its rights to amend the commission scheme payable to the Associate by giving prior notice in writing.</Sub>
        <Sub n="iv.">Where the Associate so requests and/or the Company subsequently appoints the Associate as a Pre-Leader / Team Leader the following additional terms shall apply;-</Sub>
        <Sub n="a.">In the event that any Down Line Associate working under him wishes to terminate his working relationship with him or his service contract with the Company, he must conduct an exit interview with such Down Line Associate. In the event of an dispute between him and his Down Line Associate, the Company reserves the right to resolve the dispute in such manner as it thinks fit and any decision made by the Company shall be final. Upon the termination of the association between him and his Down Line Associate, no further Overriding Commission shall be paid to him in respect of any Commission earned by such Down Line Associate.</Sub>
        <Sub n="b.">In the event that he wishes to terminate his service contract with the Company, he must give the Company a notice period of at least 30 days (applicable for Team Leader and higher position only). Upon termination of this Agreement, he shall be prohibited for a period of thirty-six (36) months to solicit / endeavour to entice away any employee / Associates and/or business of the Company or any employee / Associate of any of the other franchisees under Enshrine Holdings Pte Ltd. In addition to the aforesaid, the entitlement of overriding commission shall be ceased immediately from the date of termination or date of tendering of notice to resign. The parties agree and acknowledge that damages may not be sufficient and the Company is entitled to seek specific performance or injunctive relief as a remedy for such breach, in addition to any other remedies available in law or in equity.</Sub>
        <Sub n="v.">The Associate shall be entitled to the share of commission as set out in the respective commission scheme in the various different sales category. However, this entitlement is subject to the Associate achieving the commission required as well as the pre-requisite criteria;</Sub>
        <Sub n="vi.">Associate’s share of commissions are all inclusive and the Company shall not be liable to pay GST on commissions paid to Associates who are/ subsequently become GST registered entities. For the avoidance of doubt, where Associates are become liable for GST payments such payments will be from the Associate’s share of commission stipulated above.</Sub>

        <Text style={s.secH}>7. SALES & CONTRACT OF SERVICES</Text>
        <Text style={s.plain}>All sales and contracts of services in connection with the afterlife services and/or services available in Enshrine category and all transactions performed (including the Associate’s own family members) by the Associate in connection with this Agreement must be handled, transacted and dealt with in the name of the Company and the Associate undertakes that he shall at all times disclose to the Company all cases that he may procure within three (3) working days after receipt of the same by the Associate. Such afterlife services and all connected matters shall be the sole and exclusive transaction of the Company; including all prospects, leads and probable transactions developed by the Associate during his term with the Company. In the event of termination of the Agreement, all unclose cases shall remain the exclusive property of the Company.</Text>

        <Text style={s.secH}>8. REPRESENTATION</Text>
        <C n="8.1">Unless with prior written authorisation by the Director, the Associate shall not have the authority to bind the Company by any act, promise or representations made.</C>
        <C n="8.2">The Associate undertakes that he shall expressly represent himself to be generating all afterlife sales and services under the license of the Company in all the advertisements and promotions arranged by him.</C>
        <C n="8.3">The Associate is not authorised to and shall not issue any official receipts on behalf of the Company to the Associate’s customers or clients. The Company shall have the sole right to issue official receipts to the said customers or clients as soon as payments are received.</C>
        <C n="8.4">In the event that the Associate is found to have represented another funeral and/or afterlife related company during the continuance of this agreement, the Associate shall be personally liable to pay for all legal costs including but not limited to disbursements and any ancillary costs incurred by the Company as a result thereof on an indemnity basis for any recovery actions undertaken by the Company against the Associate. Further, the Associate acknowledges that the Company has suffered losses as a result of such aforesaid acts and hereby irrevocably and unconditionally agrees to forfeit to the Company all the referral fees and/or commissions recovered by the Company as a result thereof. Alternatively, the Associate agrees to give the Company sole right and discretion to deduct and/or set-off the said undeclared commission payable and/or received by him from any new in-coming commission, Manager Overriding, and/or referral fees received and/or recovered by the Company with or without giving advance notice to the Associate.</C>

        <Text style={s.secH}>9. COMPANY’S PROPERTY</Text>
        <Text style={s.plain}>All prospects, clients, records, contracts, identification tag, information, video tapes, audio tapes, books files, forms, papers pertaining to methods to client’s information and methods of doing business, or copies thereof, are strictly confidential and shall remain the sole property of the Company and the Associate undertakes that he shall not remove the property from the Company’s premises without the written consent of the Company or transfer in its original form or in duplicated or copied form, verbally or in the form of writing or electronically or otherwise howsoever, to any competing person, corporation or Company during or after the termination of this Agreement. Upon termination of this Agreement, the Associate undertakes that he shall surrender all property belonging to the Company. Client’s information herein shall include details of customers and prospective customers of the Company and the same shall comprise both current and previous customers of the Company within the last three (3) years from the date of termination of this Agreement.</Text>

        <Text style={s.secH}>10. SPH ADVERTISEMENTS</Text>
        <Text style={s.plain}>The Associate is to include the Company Name and Logo in all advertisements whether or not placed with Singapore Publishing House regardless of the size of the advertisement.</Text>

        <Text style={s.secH}>11. PRINTING AND PUBLICATIONS</Text>
        <Text style={s.plain}>The Associate agrees to allow the Company to publish his name and/or photography in any of the Company’s publication, brochure or advertisement. The Associate further agrees not to print and distribute any printed materials, brochures and promotional items bearing the Company’s Name and Logo without prior written consent of the Company.</Text>

        <Text style={s.secH}>12. DISPLAY OF BANNER AND SIGNBOARD</Text>
        <C n="12.1">The Associate undertakes that he shall obtain the requisite licence from the Commissioner of Building Control before displaying any signboard/banner/flyer in public places, i.e. road side railing, lamp post or pedestrian path etc. The Associate is aware that failure to do so would be an offence punishable by law.</C>
        <C n="12.2">The Associate irrevocably and unconditionally agrees to pay for all the fines within three (3) days imposed by any relevant authorities in the event that he failed to abide by the Clause 12.1 above. Further and in addition, the Associate also agrees to give the Company sole right and discretion to deduct and/or set-off the said fine unpaid by him (including any additional interests incurred by the Company as a result of his non-payment) from any new in-coming commission, Manager Overriding, and/or referral fees received by the Company with or without giving advance notice to the Associate.</C>
        <C n="12.3">The Associate irrevocably and unconditionally agrees to indemnify the Company against any legal proceedings including but not limited to paying for all the legal costs and disbursements incurred by the Company as a result of his failure to abide by Clause 12.1 and 12.2 above.</C>

        <Text style={s.secH}>13. INCOME TAX & CPF CONTRIBUTIONS</Text>
        <C n="13.1">The Associate shall bear exclusive responsibility for the discharge of any income tac arising out of the commission payable to him for the services rendered by him under this Agreement.</C>
        <C n="13.2">The Associate shall make his own CPF contributions as a self-employed person if he chooses to do so. The Associate confirms that the Company is not liable to make any CPF contributions for and on behalf of the Associate.</C>

        <Text style={s.secH}>14. TERMINATION</Text>
        <C n="14.1">Associate who are not Team Leaders and above may terminate this Agreement by giving twenty-four (24) hours written notice to the Company without giving any reasons.</C>
        <C n="14.2">Associate who occupy the position of Team Leaders and above are required to give thirty (30) days written notice to the Company to terminate this Agreement without giving any reasons.</C>
        <C n="14.3">The Company is only required to give twenty-four (24) hours written notice to terminate this agreement without giving any reasons to any Associates including Team Leaders.</C>
        <C n="14.4">Effective upon the date of termination or resignation, the Associate undertakes that he shall not make any representation whatsoever that the Associate is in any way affiliated to the Company and/or their respective affiliates and shall also discontinue all use of the trademarks, service marks, designs, logos, colours, colour patterns and business methods used by the Company, Enshrine Holdings Pte Ltd and any of its franchisee companies, subsidiaries and/or associate companies.</C>
        <C n="14.5">In the event of inconsistency, this Agreement shall prevail over any earlier associate agreement that may have been entered into between the Company and the Associate.</C>
        <C n="14.6">The termination of this Agreement shall be without prejudice to any rights of the parties hereto in respect of any antecedent breach and shall not operate to affect other provisions hereof as in accordance with their terms are expressed to operate or have effect thereafter.</C>
        <C n="14.7">Effective immediately upon the date of termination of this Agreement, the Associate undertakes that he shall not make any representation whatsoever in the marketing advertisement or promotion by any means of the supply of any services or products, that or to the effect that he was formerly affiliated with the Company, Enshrine Holdings Pte Ltd and any of its franchisee companies, subsidiaries and/or associate companies. Without prejudice to the aforesaid statement to the effect that the Associate is an “ex-Enshrine Associate” or “former Enshrine Associate” are strictly prohibited.</C>
        <C n="14.8">Upon termination of this agreement, the Associate undertakes that he shall personally return to the Company all equipment, supplies, reference materials, records, contracts, identification tag, video tapes, audio tapes, books, files forms and all written information belonging to the Company complied or made by the Associate during the term of this Agreement. For the avoidance of doubt, all written information shall at all times remain the property of the Company.</C>
        <C n="14.9">Upon termination, the Associate undertakes that he shall not publish or publicly display or announce all awards, certificates, plaques and other forms of recognition given to the Associate whilst with the Company.</C>
        <C n="14.10">The Associate shall declare, reported return all outstanding payments due to the Company within seven (7) days after the transaction payments are received. In the event that the Associate fails to oblige with the aforesaid within the stipulated period herein, the Associate shall be liable to pay for all legal costs on an indemnity basis for any recovery actions undertaken by the Company against the Associate to recover the outstanding commission. Further, the Associate acknowledges that the Company has suffered losses as a result of such aforesaid acts and hereby irrevocably and unconditionally agrees to forfeit to the Company all the referral fees and/or commissions recovered by the Company as a result thereof.</C>
        <C n="14.11">Upon the termination of this Agreement, the Associate shall be prohibited for a period of thirty-six (36) months to solicit/endeavour to entice away any employee/Associates and/or business of the Company or any employee/Associate of any of the other franchisees under Enshrine Holdings Pte Ltd. In the event the Associate is found to have solicited and/or enticed any associate(s) (“the departing associate(s)”) away from the Company, whether directly or indirectly and in any manner whatsoever, the Company is deemed to have suffered loss and the Associate shall be liable to the Company for loss of income which the departing associate(s) would have otherwise brought to the Company. The parties agree and acknowledge that damages may not be sufficient and the Company is entitled to seek specific performance or injunctive relief as a remedy for such breach, in addition to any other remedies available in law or in equity.</C>
        <C n="14.12">Notwithstanding Clause 14.3, the Company reserve all rights to terminate this Agreement without prior notice to the Associate in the event the Associate:-</C>
        <Sub n="i.">is in breach of any term of this Agreement;</Sub>
        <Sub n="ii.">is convicted of any offence involving dishonesty;</Sub>
        <Sub n="iii.">is guilty of inappropriate behaviour and/or gross misconduct which in the sole opinion of the Company is detrimental to the Company’s image, integrity and reputation.</Sub>
        <Sub n="iv.">is in breach of any circular or directive issued by the Company pursuant to any Government directive, regulations, rule or statute;</Sub>
        <Sub n="v.">does not perform and bring in any business to the Company for a continuous period of twelve (12) months without any valid reasons.</Sub>
        <C n="14.13">Where the Sales Associate fails to generate any sales activity for a continuous period of twenty-four (24) months, the Company shall be entitled, at its sole discretion, to terminate this Agreement with immediate effect and without prior notice, and without any liability or obligation to the Sales Associate. Such termination shall not constitute a breach of this Agreement.</C>

        <Text style={s.secH}>15. INDEMNITY</Text>
        <C n="15.1">The Associate undertakes that he shall fully indemnify the Company against all costs (including but not limited to damages, liabilities, charges, losses, claims and or counter-claims) incurred by the Company as a result of the Associate’s acts or omissions which are contrary to/contravene this agreement and/or the Company’s rules.</C>
        <C n="15.2">In the event of breach of any of the provisions herein contained by the Associate, the Associate undertakes that he shall be liable to the Company for any loss and damages suffered by the Company and shall indemnify the Company for costs including all legal fees incurred by the Company in seeking to enforce the Company’s rights against the Associate at law and in equity.</C>

        <Text style={s.secH}>16. WAIVER</Text>
        <Text style={s.plain}>The failure by the Company to insist upon strict performance of any of the terms or provisions of this Agreement or to exercise any option right or remedy here contained shall not be construed as a waiver or as a relinquishment for the future of such term, provision, option, right or remedy, but the same shall continue and remain in full force and effect throughout the term of this Agreement. No waiver by the Company of any term or provision hereof shall be deemed to have been made unless expressed in writing and signed by a Director of the Company.</Text>

        <Text style={s.secH}>17. NOTICE</Text>
        <Text style={s.plain}>Any notice required to be served upon the Associate by the Company shall be sufficiently served if forwarded to the Associate personally or by post or by electronic mail or by SMS to the address/mobile phone number given by the Associate. The Associate shall update the Company on any change to the Associate’s residential address or electronic mail address or telephone /mobile phone numbers within three (3) days after the change.</Text>

        <Text style={s.secH}>18. ALL REFERRALS</Text>
        <Text style={s.plain}>The Associate undertakes that he shall declare to the Company all referral fees received by him, including but without limiting the generality of the foregoing, all bank referrals fees.</Text>

        <Text style={s.secH}>19. AMENDMENT</Text>
        <Text style={s.plain}>The Company shall have the absolute right and discretion to make any changes and/or amendments to any terms herein contained as it deem fits. At such changes and/or amendments shall be binding on the Associate upon the Associate being notified of the changes and/or amendments in the manner prescribed herein.</Text>

        <Text style={s.secH}>20. INTERRETATION</Text>
        <Text style={s.plain}>In this Agreement, where the context so admits;</Text>
        <Sub n="i.">words importing the masculine gender include the feminine and neuter genders.</Sub>
        <Sub n="ii.">the expressions “the Company” and “the Associate” include their respective executors, administrators and assigns.</Sub>
        <Sub n="iii.">words importing the singular number include the plural number and vice versa.</Sub>

        <Text style={s.secH}>21. SEVERABILITY</Text>
        <Text style={s.plain}>In the event that any of the provision herein is declared by the Court to be illegal, invalid, unenforceable or null and void it is hereby agreed that the legality, validity and enforceability of the remaining provisions shall not in any way be affected or impaired thereby.</Text>

        <Text style={s.secH}>22. CONTRACTS (RIGHTS OF THIRD PARTIES) ACT 2001</Text>
        <Text style={s.plain}>Save for the parties specially mentioned herein in this Agreement any person or party who is not a party to this Agreement whether or not any benefit is conferred or purported to be conferred on it directly or indirectly has no right under the Contracts (Rights of Third Parties) Act 2001 to enforce any term of this Agreement.</Text>

        <Text style={s.secH}>23. AGREEMENT</Text>
        <Text style={s.plain}>The Associate agrees to conform to and abide by all the terms and conditions as set out in this Agreement.</Text>

        {/* -------- Miscellaneous information + signatures (kept together) -------- */}
        <View wrap={false}>
          <Text style={[s.secH, { marginTop: 16 }]}>MISCELLANEOUS INFORMATION</Text>
          <View style={s.table}>
            <View style={s.tRow}>
              <View style={s.tCell}><Text style={s.tLabel}>(a) Commencement Date:</Text><Text style={s.tVal}>{d(a.commencementDate)}</Text></View>
            </View>
            <View style={s.tRow}>
              <View style={s.tCell}>
                <Text style={s.tLabel}>(b) Is your spouse working and/or supplier for a funeral and/or afterlife related company?  {a.spouseConflict == null ? "Yes / No" : a.spouseConflict ? "Yes" : "No"}</Text>
                <Text style={s.tVal}>Name of Spouse: {d(a.spouseName)}</Text>
                <Text style={s.tVal}>Name of Company: {d(a.spouseCompany)}</Text>
                <Text style={s.tVal}>Designation: {d(a.spouseDesignation)}</Text>
              </View>
            </View>
            <View style={s.tRowLast}>
              <View style={s.tCell}>
                <Text style={s.tLabel}>(c) In case of emergency, please contact:-</Text>
                <Text style={s.tVal}>Name: {d(a.emergencyName)}    Relationship: {d(a.emergencyRelationship)}</Text>
                <Text style={s.tVal}>Address: {d(a.emergencyAddress)}    Contact Number: {d(a.emergencyContact)}</Text>
              </View>
            </View>
          </View>

          <Text style={s.declare}>
            I, THE ABOVENAMED APPLICANT, DO HEREBY CERTIFY AND DECLARE THAT THE ABOVE INFORMATION AS STATED IN THIS AGREEMENT AND ALL ATTACHMENTS ARE COMPLETE, TRUE AND CORRECT AND NO MISLEADING INFORMATION HAS BEEN SUBMITTED.
          </Text>
          <Text style={s.witness}>IN WITNESS WHEREOF the parties hereto have hereunder set their hands the day and yer first above written.</Text>

          <View style={s.signGrid}>
            <View style={s.signRow}><Text style={s.signLabel}>SIGNED by the</Text><Text>)</Text></View>
            <View style={s.signRow}><Text style={s.signLabel}>Abovementioned Company</Text><Text>)</Text></View>

            <View style={[s.signRow, { marginTop: 16 }]}><Text style={s.signLabel}>SIGNED By the</Text><Text>)</Text></View>
            <View style={s.signRow}><Text style={s.signLabel}>Abovementioned Associate</Text><Text>)</Text></View>
            {a.signatureDataUrl ? (
              /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not an HTML img */
              <Image src={a.signatureDataUrl} style={s.sigImg} />
            ) : null}
            <View style={s.signRow}><Text style={s.signLabel}>Name: {d(a.fullName)}</Text><Text>)</Text></View>
            <View style={s.signRow}><Text style={s.signLabel}>NRIC No.: {d(a.nricMasked)}</Text><Text>)</Text></View>
            <Text style={[s.tHint, { marginTop: 4 }]}>Signed {format(a.signedDate, "dd MMM yyyy, HH:mm")} via the Enshrine Virtual Office onboarding portal.</Text>
          </View>

          <Text style={s.officialH}>For Official Use</Text>
          <View style={s.table}>
            <View style={s.tRow}>
              <View style={[s.tCell, s.tCellDiv, { flex: 0.6 }]}><Text style={s.tLabel}>Associate ID</Text></View>
              <View style={s.tCell}><Text style={s.tVal}>{d(a.associateId)}</Text></View>
            </View>
            <View style={s.tRow}>
              <View style={[s.tCell, s.tCellDiv, { flex: 0.6 }]}><Text style={s.tLabel}>Tier 1 Manager</Text></View>
              <View style={s.tCell}><Text style={s.tVal}>{d(a.tier1Manager)}</Text></View>
            </View>
            <View style={s.tRowLast}>
              <View style={[s.tCell, s.tCellDiv, { flex: 0.6 }]}><Text style={s.tLabel}>Tier 2 Manager</Text></View>
              <View style={s.tCell}><Text style={s.tVal}>{d(a.tier2Manager)}</Text></View>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderAgreementPdf(a: AgreementData): Promise<Buffer> {
  return renderToBuffer(<AgreementDoc a={a} />);
}
