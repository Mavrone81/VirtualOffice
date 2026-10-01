import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import type { Locale } from "@/i18n/config";
import type { getOrCreateVoucher, VoucherLine } from "@/server/vouchers/get-or-create";

// Plain dictionary, not next-intl: getTranslations needs a real Next.js
// request context, which @react-pdf/renderer's own JSX runtime doesn't
// provide when it renders this outside one (including under vitest) — the
// same reason lib/pdf/statement.tsx never adopted it. The route resolves
// the viewer's locale from the same NEXT_LOCALE cookie next-intl itself
// reads (i18n/config.ts) and passes it in directly.
const LABELS: Record<Locale, Record<string, string>> = {
  en: {
    docTitle: "PAYMENT VOUCHER", companyMeta: "Virtual Office · Commission", associate: "Associate", transaction: "Transaction",
    client: "Client", payoutMonths: "Payout month(s)", paidDate: "Paid date", colDescription: "Description", colType: "Type",
    colPayoutMonth: "Payout month", colAmount: "Amount", totalPaid: "Total paid", issued: "Issued",
    footer: "This voucher reflects amounts settled to the associate as of the date issued below and does not change on later payments. Queries: contact your administrator.",
  },
  "zh-CN": {
    docTitle: "付款凭证", companyMeta: "虚拟办公室 · 佣金", associate: "伙伴", transaction: "交易",
    client: "客户", payoutMonths: "支付月份", paidDate: "付款日期", colDescription: "说明", colType: "类型",
    colPayoutMonth: "支付月份", colAmount: "金额", totalPaid: "已付总额", issued: "签发日期",
    footer: "本凭证反映截至下方签发日期已支付给该伙伴的金额，日后的付款不会更改本凭证内容。如有疑问，请联系管理员。",
  },
};

const INK = "#1a1f2b";
const MUTED = "#6b675e";
const LINE = "#e6e2d9";

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
  tile: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 10 },
  tileTotal: { backgroundColor: INK },
  tileLabel: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  tileVal: { fontSize: 13, fontFamily: "Helvetica-Bold", color: INK, marginTop: 4 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 6, marginBottom: 2 },
  thText: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 6 },
  cDesc: { flex: 1, paddingRight: 8 },
  cType: { width: 90 },
  cMonth: { width: 80, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right" },
  footer: { position: "absolute", bottom: 36, left: 44, right: 44, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10, fontSize: 8, color: MUTED },
});

type Voucher = NonNullable<Awaited<ReturnType<typeof getOrCreateVoucher>>>;
type Labels = Record<string, string>;

function VoucherDoc({ v, t }: { v: Voucher; t: Labels }) {
  const lines = v.lines as unknown as VoucherLine[];
  return (
    <Document title={`${t.docTitle} ${v.reference}`} author="Enshrine">
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View style={{ flexDirection: "row" }}>
            <Text style={s.brandMark}>E</Text>
            <View style={{ marginLeft: 10 }}>
              <Text style={s.coName}>Enshrine</Text>
              <Text style={s.coMeta}>{t.companyMeta}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.docTitle}>{t.docTitle}</Text>
            <Text style={[s.coMeta, { marginTop: 4 }]}>{v.reference}</Text>
          </View>
        </View>

        <View style={[s.row, s.block]}>
          <View>
            <Text style={s.label}>{t.associate}</Text>
            <Text style={[s.value, { fontFamily: "Helvetica-Bold" }]}>{v.associateName}</Text>
            <Text style={s.coMeta}>{v.associateCode}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.label}>{t.transaction}</Text>
            <Text style={[s.value, { fontFamily: "Helvetica-Bold" }]}>{v.transactionCode}</Text>
            <Text style={s.coMeta}>{t.client}: {v.clientInitials}</Text>
          </View>
        </View>

        <View style={[s.row, s.block]}>
          <View>
            <Text style={s.label}>{t.payoutMonths}</Text>
            <Text style={s.value}>{v.payoutMonths.join(", ")}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.label}>{t.paidDate}</Text>
            <Text style={s.value}>{format(v.paidDate, "dd MMM yyyy")}</Text>
          </View>
        </View>

        <View style={s.block}>
          <View style={s.th}>
            <Text style={[s.thText, s.cDesc]}>{t.colDescription}</Text>
            <Text style={[s.thText, s.cType]}>{t.colType}</Text>
            <Text style={[s.thText, s.cMonth]}>{t.colPayoutMonth}</Text>
            <Text style={[s.thText, s.cAmt]}>{t.colAmount}</Text>
          </View>
          {lines.map((l, i) => (
            <View style={s.tr} key={i}>
              <Text style={[s.cDesc, { color: INK }]}>{[l.lineType, l.comCode].filter(Boolean).map((x) => humanize(x)).join(" · ")}</Text>
              <Text style={[s.cType, { color: MUTED }]}>{humanize(l.lineType)}</Text>
              <Text style={s.cMonth}>{l.payoutMonth}</Text>
              <Text style={[s.cAmt, { fontFamily: "Helvetica-Bold" }]}>{formatSGD(l.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: "row", marginTop: 16 }}>
          <View style={{ flex: 1 }} />
          <View style={[s.tile, s.tileTotal, { flex: 0, minWidth: 160 }]}>
            <Text style={[s.tileLabel, { color: "#cfcabf" }]}>{t.totalPaid}</Text>
            <Text style={[s.tileVal, { color: "#fff" }]}>{formatSGD(v.totalPaid)}</Text>
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.label}>{t.issued}</Text>
          <Text style={s.value}>{format(v.issuedAt, "dd MMM yyyy")}</Text>
        </View>

        <Text style={s.footer} fixed>{t.footer}</Text>
      </Page>
    </Document>
  );
}

export async function renderVoucherPdf(v: Voucher, locale: Locale): Promise<{ buffer: Buffer; filename: string }> {
  const t = LABELS[locale];
  const buffer = await renderToBuffer(<VoucherDoc v={v} t={t} />);
  return { buffer, filename: `${v.reference}.pdf` };
}
