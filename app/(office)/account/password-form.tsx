"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password.length < 8) return setMsg({ kind: "error", text: "Use at least 8 characters." });
    if (password !== confirm) return setMsg({ kind: "error", text: "The two passwords do not match." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: error.message });
    setPassword("");
    setConfirm("");
    setMsg({ kind: "success", text: "Password changed. Use it next time you sign in." });
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Repeat new password">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <Button disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
