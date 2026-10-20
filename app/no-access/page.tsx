import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">No access</h1>
        <p className="mt-2 text-sm text-slate-600">
          You are signed in, but this account has no ERP access or no role for this page. Ask the owner to add you.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <Button variant="secondary" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
