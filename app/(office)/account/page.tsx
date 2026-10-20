import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordForm } from "./password-form";

export default async function AccountPage() {
  const me = await requireUser();
  return (
    <div className="max-w-lg">
      <PageHeader title="Change password" description={`Signed in as ${me.email ?? me.fullName}`} />
      <PasswordForm />
    </div>
  );
}
