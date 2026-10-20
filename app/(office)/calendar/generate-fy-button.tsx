"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { fyLabel } from "@/lib/jc";
import { Button } from "@/components/ui/button";
import { generateFiscalYear } from "./actions";

export function GenerateFyButton({ startYear }: { startYear: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await generateFiscalYear(startYear);
          if (res.error) alert(res.error);
          else router.push(`/calendar?fy=${startYear}`);
        })
      }
    >
      <Plus className="h-4 w-4" />
      {pending ? "Generating…" : `Generate FY ${fyLabel(startYear)}`}
    </Button>
  );
}
