# zh-CN translations to verify with a native reviewer

JSON can't hold inline comments, so ambiguous domain terms are tracked here.

- `nav.associates` → 伙伴 — "associates" are commission-based sales agents. Alternatives: 顾问 / 业务伙伴. VERIFY preferred term (used app-wide).
- `nav.payouts` / `nav.myPayouts` → 佣金发放 / 我的发放 — payout of monthly commissions. VERIFY.
- `nav.myPFile` → 我的人事档案 — "P-File" = personnel file. VERIFY.
- `common.active` → 活跃 — generic "active"; associate employment status uses its own term (see status namespace when added: 在职 for Active associate). VERIFY per context.

- `recruitment.form.impliedTeam` / `recruitment.form.pickOwnTeam` → 该候选人将加入您的团队：{team} / 候选人加入您的哪个团队？ — MACHINE TRANSLATION (invite team rule, Oct 2026). VERIFY with a native reviewer.
- MACHINE TRANSLATION (products edit, commission structure): `products.rateChangeNote`, `products.rateChangeScheduled`, `products.rateChangeDateInPast`, `products.commissionIncompleteNote`, `errors.effectiveDateInPast`, `errors.effectiveDateBeforeLatestVersion` → zh-CN written without a native reviewer. They explain that a commission change starts a new rate version on the effective date and that already-verified sales keep their rates. VERIFY wording, especially 费率版本 (rate version) and 核实 (verify, as in "verify a sale").
- `recruitment.form.teamPlaceholder` / `teams.namePlaceholder` / `portal.clientNamePlaceholder` → 例如：团队名称 / 例如：事业部或团队名称 / 例如：客户全名 — MACHINE TRANSLATION (input placeholders that replaced person-shaped example names, Oct 2026). Written by the release assembler without a native reviewer, to the same standard asked of the builders. VERIFY.
- `company.*` (Company details form, 3 Oct 2026) and `errors.companyDetails.*` — **machine-translated**, not native-reviewed. VERIFY: 注册名称 for "registered name", PayNow UEN（公司） wording.
- `teams.monthlyTarget` / `teams.yearlyTarget` / `teams.targetNotSet` / `teams.saveTarget` / `teams.clearTarget` / `teams.targetNote`, `team.overview.teamTargetTag` (team-level targets) — zh-CN is MACHINE-TRANSLATED (月度目标 / 年度目标 / 团队). VERIFY with a native reviewer.
- `company.gstRegNoLabel` / `company.gstRegNoMissingWarning` and `errors.companyDetailsGstRegNoInvalid` (GST registration number field, Oct 2026) — **machine-translated**, not native-reviewed. VERIFY: 消费税（GST）注册号 as the label for "GST registration number", and 税务发票 for "tax invoice".
- `onboarding.agreement.intro` / `onboarding.agreement.checkbox` (version marker, Oct 2026) -> 版本 V.2026-04 instead of 第 2607 版 — MACHINE TRANSLATION edit: only the version wording changed ("version V.2026-04" -> 版本 V.2026-04). Not native-reviewed. VERIFY.
