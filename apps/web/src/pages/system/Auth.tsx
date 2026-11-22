import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, CircleCheck, DoorOpen, Mail, Send, X } from "lucide-react";
import { Button } from "@loft/ui";
import { useAdapter, useQuery } from "../../lib/data";
import { ADAPTER, IS_PREVIEW } from "../../lib/env";

/** Figma 07 · "Sign in (desktop)" and "Check email (phone)". */
export function SignInPage() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePw, setUsePw] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(params.get("error") === "expired" ? "That sign-in link has expired or was already used. Ask for a new one." : null);
  const submit = async () => {
    setErr(null);
    try {
      if (usePw) {
        await adapter.mutate("auth/password", { email, password });
        nav("/");
      } else {
        await adapter.auth.requestLink(email);
        setSent(true);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-card">
        {sent ? (
          <>
            <span className="auth-ic" aria-hidden="true"><Mail /></span>
            <h1>Check your email</h1>
            <p className="muted-note">We sent a sign-in link to <b>{email}</b>. It works once, for 15 minutes.</p>
            <Button variant="secondary" onClick={() => setSent(false)}>Use a different email</Button>
          </>
        ) : (
          <>
            <span className="lf-mark auth-mark" aria-hidden="true">L</span>
            <h1>Sign in to loft</h1>
            <p className="muted-note" style={{ padding: 0 }}>{usePw ? "Use the password you set in Settings." : "We'll email you a link. No password to remember."}</p>
            {IS_PREVIEW && <p className="banner-box banner-box--info">Preview: you're already signed in as the demo host. <Link className="link" to="/">Go to Home</Link></p>}
            {err && <p className="state-error" role="alert"><b>{err}</b></p>}
            <form className="pay-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <label className="form-col">Email<span className="money-input"><Send aria-hidden="true" style={{ width: 16, height: 16, color: "var(--color-muted-fg)" }} /><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></span></label>
              {usePw && <label className="form-col">Password<input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>}
              <Button type="submit" block icon={<Send aria-hidden="true" />} disabled={!email.includes("@") || (usePw && !password)}>{usePw ? "Sign in" : "Email me a sign-in link"}</Button>
            </form>
            <button type="button" className="link" onClick={() => setUsePw(!usePw)}>{usePw ? "Email me a link instead" : "Use a password instead"}</button>
            <div className="auth-or"><span>or</span></div>
            <Link className="lf-btn lf-btn--secondary lf-btn--block" to="/join"><DoorOpen aria-hidden="true" />Join a room with a code</Link>
            <p className="muted-note" style={{ padding: 0 }}>New here? Start a room from the Loft home page. No account needed until you want to keep it.</p>
          </>
        )}
      </section>
      <p className="auth-foot">built for small teams · up to 12 people per room</p>
    </main>
  );
}

interface InstallInfo { installed: boolean; checks: { name: string; ok: boolean; detail: string }[]; timezone: string }

/** Figma 07 · "Install · first run (desktop)": server check → owner account → done. */
export function InstallPage() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const http = ADAPTER === "http";
  const { data } = useQuery<InstallInfo>(http ? "install" : null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [site, setSite] = useState(() => `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`);
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (data?.installed && !done) nav("/signin", { replace: true });
  }, [data, done, nav]);
  const checks = http ? data?.checks ?? [] : [
    { name: "PHP 8.2 · PDO SQLite · cURL · OpenSSL · Sodium", ok: true, detail: "" },
    { name: "data/ is writable and outside the web root (.htaccess deny)", ok: true, detail: "" },
    { name: "mail() works · test email sent to you", ok: true, detail: "" }
  ];
  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  const install = async () => {
    setErr(null);
    try {
      await adapter.mutate("install", { name, email, appUrl: site, timezone: tz });
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-card auth-card--wide">
        <ol className="steps-line" aria-label="Install steps">
          <li className={allOk ? "is-done" : "is-on"}><span>{allOk ? <Check aria-hidden="true" /> : "1"}</span>Server check</li>
          <li className={done ? "is-done" : allOk ? "is-on" : ""}><span>{done ? <Check aria-hidden="true" /> : "2"}</span>Owner account</li>
          <li className={done ? "is-on" : ""}><span>3</span>Done</li>
        </ol>
        {done ? (
          <>
            <h1 className="auth-h2">Loft is ready</h1>
            <p className="muted-note" style={{ padding: 0 }}>You're the owner. Open <code>/spaces/owner</code> any time to switch branding on for organisations. Back up the data/ folder.</p>
            <Button onClick={() => nav("/")}>Open Loft</Button>
          </>
        ) : (
          <>
            <h1 className="auth-h2">Create the owner account</h1>
            <p className="muted-note" style={{ padding: 0 }}>This is you. Only the owner can open /spaces/owner to switch branding on for organisations.</p>
            {!http && <p className="banner-box banner-box--info">Preview: the install wizard runs on your server the first time you open Loft there. See docs/deploy-namecheap.md.</p>}
            <ul className="install-checks" role="list">{checks.map((c) => <li key={c.name} className={c.ok ? "" : "is-bad"}>{c.ok ? <CircleCheck aria-hidden="true" /> : <X aria-hidden="true" />}{c.name}{c.detail && !c.ok ? ` · ${c.detail}` : ""}</li>)}</ul>
            {err && <p className="state-error" role="alert"><b>{err}</b></p>}
            <label className="form-col">Your name<input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label className="form-col">Email<input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            <label className="form-col">Site address<input className="field field--mono" value={site} onChange={(e) => setSite(e.target.value)} /></label>
            <Button block icon={<Check aria-hidden="true" />} disabled={!http || !allOk || !name.trim() || !email.includes("@")} onClick={() => void install()}>Create owner and finish</Button>
            <p className="money-foot">An encryption key for stored API keys is generated now and saved in data/config.php. Back up the data/ folder.</p>
          </>
        )}
      </section>
    </main>
  );
}
