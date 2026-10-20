export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-sm space-y-3 rounded-xl bg-white p-6 text-center shadow">
        <h1 className="text-lg font-semibold">No access</h1>
        <p className="text-sm text-slate-600">
          You are signed in, but this account has no ERP access or no role for this page. Ask the owner to add you.
        </p>
        <form action="/auth/signout" method="post">
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm">Sign out</button>
        </form>
      </div>
    </main>
  );
}
