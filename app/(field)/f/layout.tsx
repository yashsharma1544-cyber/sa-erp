import { requireUser } from "@/lib/auth";

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <div className="mx-auto min-h-screen max-w-md bg-slate-50 px-4 py-5">{children}</div>;
}
