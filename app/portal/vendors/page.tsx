import { redirect } from "next/navigation";

// Superseded by the Referral Partner List (consolidated menu, Sep 2026).
export default function VendorRegistryRedirect() {
  redirect("/portal/referrals");
}
