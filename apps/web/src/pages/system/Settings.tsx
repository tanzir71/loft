import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Button } from "@loft/ui";
import type { User } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { ADAPTER, IS_PREVIEW } from "../../lib/env";
import { PageHeader } from "../../shell/PageHeader";
import { Loading } from "../../components/bits";

/** Settings: your name, title, time zone, an optional password, sign out. */
export function SettingsPage() {
  const { data: me } = useQuery<User & { title?: string; tz?: string }>("me");
  if (!me) return <Loading label="Loading settings" />;
  return <SettingsForm key={me.id} me={me} />;
}

function SettingsForm({ me }: { me: User & { title?: string; tz?: string } }) {
  const adapter = useAdapter();
  const nav = useNavigate();
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title ?? "");
  const [tz, setTz] = useState(me.tz ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  const [pw, setPw] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [tz];
  const http = ADAPTER === "http";
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setNote(null);
    try {
      await fn();
      setNote(ok);
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <div className="page">
      <PageHeader title="Settings" />
      <div className="money-col" style={{ maxWidth: 560 }}>
        {note && <p className="banner-box banner-box--info" role="status">{note}</p>}
        <section className="card-box">
          <h2>You</h2>
          <label className="form-col">Name<input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="form-col">Title<input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tutor · Physics" /></label>
          <label className="form-col">Time zone<select className="field" value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select></label>
          <Button onClick={() => void run(() => adapter.mutate("profile", { name, title, tz }), "Saved.")}>Save</Button>
        </section>
        <section className="card-box">
          <h2>Sign-in</h2>
          <p className="muted-note" style={{ padding: 0 }}>You sign in with an email link. A password is optional, for when email is slow.</p>
          {http ? (
            <>
              <label className="form-col">New password<input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 10 characters" /></label>
              <div className="part-row">
                <Button variant="secondary" disabled={pw.length < 10} onClick={() => void run(async () => { await adapter.mutate("auth/password/set", { password: pw }); setPw(""); }, "Password set.")}>Set password</Button>
                <Button variant="ghost" icon={<LogOut aria-hidden="true" />} onClick={async () => { await adapter.auth.signOut(); nav("/signin"); }}>Sign out</Button>
              </div>
            </>
          ) : IS_PREVIEW && <p className="banner-box banner-box--muted">Preview: sign-in and passwords work on your server. Here you're always the demo host.</p>}
        </section>
      </div>
    </div>
  );
}
