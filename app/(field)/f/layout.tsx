import type { Metadata, Viewport } from "next";
import { requireUser } from "@/lib/auth";
import { ServiceWorkerRegister } from "./sw-register";

export const metadata: Metadata = {
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "SA ERP", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#15803d" };

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 px-4 py-5">
      <ServiceWorkerRegister />
      {children}
    </div>
  );
}
