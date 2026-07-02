import { PageHeader } from "@/components/ui/page-header";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export const metadata = { title: "Account · Enshrine Admin" };

export default function AdminAccountPage() {
  return (
    <>
      <PageHeader title="Account" subtitle="Change your password." />
      <ChangePasswordForm />
    </>
  );
}
