"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { fyLabel } from "@/lib/jc";
import { generateFiscalYear } from "./actions";

export function GenerateFyButton({ startYear }: { startYear: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await generateFiscalYear(startYear);
          if (res.error) alert(res.error);
          else router.push(`/calendar?fy=${startYear}`);
        })
      }
      className="rounded-md border border-dashed border-slate-400 px-3 py-1 text-sm disabled:opacity-50"
    >
      {pending ? "Generating…" : `+ Generate FY ${fyLabel(startYear)}`}
    </button>
  );
}
