import { useState } from "react";
import { Button } from "@loft/ui";
import { useAdapter } from "../../lib/data";
export function RecoveryCode({ code, onContinue }: { code: string; onContinue: () => void }) {
  const adapter = useAdapter();
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="auth-recovery"><h1>Save your recovery code</h1>
    <p>Keep this in your password manager. It lets you reset your password without email.</p>
    <textarea className="field auth-recovery-code" aria-label="Recovery code" value={code} readOnly rows={3} />
    <label className="auth-check"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />I saved my recovery code</label>
    {error && <p role="alert" className="state-error">{error}</p>}
    <Button block disabled={!saved || busy} onClick={async () => {
      setBusy(true); setError(null);
      try { await adapter.mutate("auth/recovery-confirm", { saved: true, recoveryCode: code }); onContinue(); }
      catch (problem) { setError((problem as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Continue"}</Button></div>;
}
