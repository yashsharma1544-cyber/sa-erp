import "server-only";

// WATi template messages. Needs WATI_API_ENDPOINT (e.g. https://live-mt-server.wati.io/123456)
// and WATI_API_TOKEN (the bearer token from WATi → API Docs) in Vercel.

export function watiConfigured(): boolean {
  return !!process.env.WATI_API_ENDPOINT && !!process.env.WATI_API_TOKEN;
}

export type WatiResult = { ok: true; id?: string } | { ok: false; error: string; retry: boolean };

export async function sendTemplate(to: string, templateName: string, values: string[], broadcastName: string): Promise<WatiResult> {
  const endpoint = process.env.WATI_API_ENDPOINT?.replace(/\/$/, "");
  const token = process.env.WATI_API_TOKEN?.replace(/^Bearer\s+/i, "");
  if (!endpoint || !token) return { ok: false, error: "WATi is not set up", retry: true };

  const url = `${endpoint}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(to)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        template_name: templateName,
        broadcast_name: broadcastName,
        // Numbered placeholders {{1}}, {{2}}… are passed by position.
        parameters: values.map((value, i) => ({ name: String(i + 1), value })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { result?: boolean; info?: string; message?: string; id?: string } | null;
    if (!res.ok) return { ok: false, error: `WATi ${res.status}: ${body?.info ?? body?.message ?? res.statusText}`, retry: res.status >= 500 || res.status === 429 };
    if (body && body.result === false) return { ok: false, error: body.info ?? "WATi refused the message", retry: false };
    return { ok: true, id: body?.id };
  } catch (e) {
    return { ok: false, error: `WATi unreachable: ${(e as Error).message}`, retry: true };
  }
}
