import { PageHeader } from "@/components/ui/page-header";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export const metadata = { title: "Account · Enshrine Portal" };

export default function PortalAccountPage() {
  return (
    <>
      <PageHeader title="Account" subtitle="Change your password." />
      <ChangePasswordForm />
    </>
  );
}
