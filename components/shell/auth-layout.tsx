export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-700/40" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-800/60" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-base font-bold text-brand-800">SA</span>
          <span className="text-lg font-semibold">SA ERP</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Receivables, orders, dispatch and stock in one place.</h2>
          <p className="mt-4 text-brand-100">Sushil Agencies · Anjali Agency · Jalna</p>
        </div>
        <p className="relative text-sm text-brand-200">Tally stays your books. This is where the day runs.</p>
      </section>
      <section className="flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
