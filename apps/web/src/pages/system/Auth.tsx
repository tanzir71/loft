import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, CircleCheck, DoorOpen, X } from "lucide-react";
import { BrandIcon, Button } from "@loft/ui";
import { useAdapter, useQuery } from "../../lib/data";
import { afterAuth } from "../../lib/auth";
import { ADAPTER, IS_PREVIEW } from "../../lib/env";
import { RecoveryCode } from "./RecoveryCode";

export function SignInPage() {
  const adapter = useAdapter(), nav = useNavigate();
  const [params] = useSearchParams();
  const next = afterAuth(params.get("next"));
  const [mode, setMode] = useState<"login" | "register" | "recover">("login");
  const [username, setUsername] = useState(""), [name, setName] = useState("");
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changeMode = (value: typeof mode) => { setMode(value); setError(null); setPassword(""); setConfirm(""); };
  const submit = async () => {
    setError(null);
    if (mode !== "login" && password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const result = await adapter.mutate<{ recoveryCode: string | null }>(`auth/${mode}`, { username, name, password, recoveryCode: code });
      if (result.recoveryCode) setRecovery(result.recoveryCode); else nav(next, { replace: true });
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="auth-page"><section className="auth-card">
    {recovery ? <RecoveryCode key={recovery} code={recovery} onContinue={() => nav(next, { replace: true })} /> : <>
      <BrandIcon className="auth-mark" />
      <h1>{mode === "login" ? "Sign in to loft" : mode === "register" ? "Create your account" : "Recover your account"}</h1>
      <p className="muted-note">{mode === "login" ? "Use your username and password. No email link needed." : mode === "register" ? "Free to use. No email required. Save a recovery code after signing up." : "Use your saved recovery code to set a new password."}</p>
      {IS_PREVIEW && <p className="banner-box banner-box--info">Preview: accounts run on your server. <Link className="link" to="/">Open the demo</Link></p>}
      {error && <p className="state-error" role="alert">{error}</p>}
      <form className="auth-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="form-col">Username<input className="field" required value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={mode === "register" ? 3 : undefined} maxLength={mode === "register" ? 32 : 200} /></label>
        {mode === "register" && <label className="form-col">Your name (optional)<input className="field" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={80} /></label>}
        {mode === "recover" && <label className="form-col">Recovery code<textarea className="field auth-recovery-code" required value={code} onChange={event => setCode(event.target.value)} autoComplete="off" rows={3} /></label>}
        <label className="form-col">{mode === "login" ? "Password" : "New password"}<input className="field" type="password" required value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? undefined : 10} maxLength={72} /></label>
        {mode !== "login" && <label className="form-col">Confirm password<input className="field" type="password" required value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" /></label>}
        <Button type="submit" block disabled={busy || !username || !password}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Reset password"}</Button>
      </form>
      {mode === "login" && <p className="field-help">Existing accounts can also use their email address with their saved password.</p>}
      <div className="auth-switches"><button type="button" className="link" onClick={() => changeMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "Already have an account? Sign in" : "Create an account"}</button><button type="button" className="link" onClick={() => changeMode(mode === "recover" ? "login" : "recover")}>{mode === "recover" ? "Back to sign in" : "Use a recovery code"}</button></div>
      <div className="auth-or"><span>or</span></div>
      <Link className="lf-btn lf-btn--secondary lf-btn--block" to="/join"><DoorOpen aria-hidden="true" />Join a room with a code</Link>
    </>}
  </section><p className="auth-foot">built for small teams · up to 12 people per room</p></main>;
}

interface InstallInfo { installed: boolean; checks: { name: string; ok: boolean; detail: string }[]; timezone: string }
export function InstallPage() {
  const adapter = useAdapter(), nav = useNavigate();
  const [params] = useSearchParams();
  const next = afterAuth(params.get("next"));
  const http = ADAPTER === "http";
  const { data } = useQuery<InstallInfo>(http ? "install" : null);
  const [name, setName] = useState(""), [username, setUsername] = useState("");
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [site] = useState(() => `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`);
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [error, setError] = useState<string | null>(null), [recovery, setRecovery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.installed && !recovery && !busy) nav(`/signin?next=${encodeURIComponent(next)}`, { replace: true }); }, [data, recovery, busy, nav, next]);
  const checks = data?.checks ?? [], allOk = checks.length > 0 && checks.every(check => check.ok);
  const install = async () => {
    setError(null);
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try { const result = await adapter.mutate<{ recoveryCode: string }>("install", { username, password, name, appUrl: site, timezone: tz }); setRecovery(result.recoveryCode); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="auth-page"><section className="auth-card auth-card--wide">
    {recovery ? <RecoveryCode code={recovery} onContinue={() => nav(next, { replace: true })} /> : <>
      <ol className="steps-line" aria-label="Install steps"><li className={allOk ? "is-done" : "is-on"}><span>{allOk ? <Check /> : "1"}</span>Server check</li><li className={allOk ? "is-on" : ""}><span>2</span>Owner account</li><li><span>3</span>Recovery code</li></ol>
      <h1 className="auth-h2">Create the owner account</h1>
      <p>No email sender is needed. This account can open <code>/spaces/#/owner</code> to manage the installation.</p>
      {!http && <p className="banner-box banner-box--info">Owner setup runs on your server. This build is a preview.</p>}
      <ul className="install-checks">{checks.map(check => <li key={check.name} className={check.ok ? "" : "is-bad"}>{check.ok ? <CircleCheck aria-hidden="true" /> : <X aria-hidden="true" />}{check.name}{!check.ok && check.detail ? ` · ${check.detail}` : ""}</li>)}</ul>
      {error && <p className="state-error" role="alert">{error}</p>}
      <form className="auth-form" onSubmit={event => { event.preventDefault(); void install(); }}>
        <label className="form-col">Your name<input className="field" value={name} onChange={event => setName(event.target.value)} autoComplete="name" /></label>
        <label className="form-col">Username<input className="field" required minLength={3} maxLength={32} value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
        <label className="form-col">Password<input className="field" required minLength={10} maxLength={72} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" /></label>
        <label className="form-col">Confirm password<input className="field" required type="password" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" /></label>
        <Button type="submit" block disabled={!http || !allOk || busy}>{busy ? "Creating…" : "Create owner and finish"}</Button>
      </form><p className="money-foot">Your database and encryption key stay in the existing private storage directory.</p>
    </>}
  </section></main>;
}
