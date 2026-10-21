"use client";

/** "Save as PDF" uses the phone's own print dialog, which renders Marathi correctly. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="mt-5 h-12 w-full rounded-xl bg-brand-700 text-base font-semibold text-white print:hidden"
    >
      PDF डाउनलोड करा · Save as PDF
    </button>
  );
}
