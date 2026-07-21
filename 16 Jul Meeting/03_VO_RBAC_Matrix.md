# Virtual Office (VO) — RBAC Access Matrix

Role-based tab / feature access control · 5 roles.

**Roles:** SA = Sales Associate · SAM = Sales Assistant Manager · SM = Sales Manager · SD = Sales Director · Business Admin.
✅ = access, ❌ = no access. Enforce server-side, not only in the UI.

| Tab / Feature | SA | SAM | SM | SD | Business Admin |
|---|:--:|:--:|:--:|:--:|:--:|
| **A · Recruitment & Onboarding** | | | | | |
| Invite candidate (recruitment) — SAM and above | ❌ | ✅ | ✅ | ✅ | ✅ |
| Review own invited/pending candidates | ❌ | ✅ | ✅ | ✅ | ✅ |
| Verify & confirm agreement / onboarding | ❌ | ❌ | ❌ | ❌ | ✅ |
| **B · Sales & Transactions** | | | | | |
| Submit product / transaction — everyone incl. admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fill Associate 2 / 3 commission split | ✅ | ✅ | ✅ | ✅ | ✅ |
| Generate / download own invoice | ✅ | ✅ | ✅ | ✅ | ✅ |
| Select one-time / installment plan | ✅ | ✅ | ✅ | ✅ | ✅ |
| **C · Approvals** | | | | | |
| SD approval — associate share-com split | ❌ | ❌ | ❌ | ✅ | ✅ |
| Business Admin approval — commission payout | ❌ | ❌ | ❌ | ❌ | ✅ |
| **D · Dashboards & Reporting** | | | | | |
| Own performance dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Own sales targets & amount | ✅ | ✅ | ✅ | ✅ | ✅ |
| Own team overall (aggregate) data | ✅ | ✅ | ✅ | ✅ | ✅ |
| Team individual breakdown | ❌ | ✅ | ✅ | ✅ | ✅ |
| All managers / division data | ❌ | ❌ | ❌ | ✅ | ✅ |
| Set team member monthly quota — director overrides manager | ❌ | ✅ | ✅ | ✅ | ✅ |
| **E · Personal & Communications** | | | | | |
| Download digital namecard | ✅ | ✅ | ✅ | ✅ | ✅ |
| View notices | ✅ | ✅ | ✅ | ✅ | ✅ |
| View / download documents | ✅ | ✅ | ✅ | ✅ | ✅ |
| View partners (incl. MOQ) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **F · Content Management** | | | | | |
| Publish notices | ❌ | ❌ | ❌ | ❌ | ✅ |
| Upload / manage documents | ❌ | ❌ | ❌ | ❌ | ✅ |
| Partner approve / reject | ❌ | ❌ | ❌ | ❌ | ✅ |
| **G · Product & Finance (management)** | | | | | |
| Product creation / backend master (commission engine) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Payment tracking (mark Paid / Unpaid) — installment + direct | ❌ | ❌ | ❌ | ❌ | ✅ |
| Access invoice for client signing — own + rep's SM / SD | ✅ | ✅ | ✅ | ✅ | ✅ |
| Finance — all invoices | ❌ | ❌ | ❌ | ❌ | ✅ |
| Finance — commission & payout | ❌ | ❌ | ❌ | ❌ | ✅ |
| All transactions (company-wide) | ❌ | ❌ | ❌ | ❌ | ✅ |
| **H · Administration** | | | | | |
| Team creation | ❌ | ❌ | ❌ | ❌ | ✅ |
| Audit log (view) | ❌ | ❌ | ❌ | ❌ | ✅ |
| User / designation management | ❌ | ❌ | ❌ | ❌ | ✅ |

## Notes

- SAM and SM carry employee-level feature access; the differences vs SA are recruitment and team-level reporting. Only SD and Business Admin hold elevated approval/admin rights.
- Recruitment invite is open to SAM and above; the final agreement verification / onboarding confirmation is Business Admin only.
- Monthly quota may be set by SAM / SM / SD for their team; if a Director and a Manager both set a value, the Director's value overrides.
- All approvals, auto-approvals, payouts and configuration changes are written to the audit log (Global Rule 2); audit log view is Business Admin only.
- Own invoice generation is per associate; for client signing, an invoice can also be accessed by the submitting associate's SM and SD (chain oversight). Payment tracking (marking Paid/Unpaid) is Business Admin only.
- All value fields accept percentage or absolute amounts to 2 decimal places (Global Rule 1).
