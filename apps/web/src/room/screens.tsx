import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Camera, CircleCheck, Download, MessageCircle, Mic, UserPlus, Users, X } from "lucide-react";
import { Button, buttonClass, PreviewBanner } from "@loft/ui";
import { isRoomCode, normaliseCode } from "@loft/core";
import { IS_PREVIEW } from "../lib/env";

/** Full-screen state used by join / waiting / full / ended (Figma 07 · access row). */
export function StateScreen({ icon, tone = "primary", title, children, actions, onClose }: { icon?: ReactNode; tone?: "primary" | "warning" | "accent"; title: string; children?: ReactNode; actions?: ReactNode; onClose?: () => void }) {
  return (
    <div className="state-screen">
      {IS_PREVIEW && <PreviewBanner />}
      <div className="state-screen__body">
        {onClose && (
          <button type="button" className="lf-icon-btn state-screen__close" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        )}
        <div className="state-screen__main">
          {icon && <div className={`state-icon state-icon--${tone}`} aria-hidden="true">{icon}</div>}
          <h1 className="state-screen__title">{title}</h1>
          {children}
        </div>
        {actions && <div className="state-screen__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Figma 07 · Join with code (phone). Six boxes, a name asked once and remembered on this device. */
export function JoinForm({ initialCode = "", initialName = "", onJoin }: { initialCode?: string; initialName?: string; onJoin: (code: string, name: string) => void }) {
  const nav = useNavigate();
  const clean = normaliseCode(initialCode).replace("-", "");
  const [chars, setChars] = useState<string[]>(() => Array.from({ length: 6 }, (_, i) => clean[i] ?? ""));
  const [name, setName] = useState(initialName);
  const code = `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`;
  const valid = isRoomCode(code) && name.trim().length > 0;

  const setAt = (i: number, v: string, target: HTMLInputElement) => {
    const pasted = normaliseCode(v).replace("-", "");
    if (pasted.length > 1) {
      // Pasted a whole code or link.
      setChars(Array.from({ length: 6 }, (_, k) => pasted[k] ?? ""));
      (target.form?.elements.namedItem("you") as HTMLInputElement | null)?.focus();
      return;
    }
    const next = [...chars];
    next[i] = pasted.slice(-1);
    setChars(next);
    if (pasted && i < 5) (target.parentElement?.querySelectorAll("input")[i + 1] as HTMLInputElement | undefined)?.focus();
  };

  return (
    <form
      className="join"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onJoin(code, name.trim());
      }}
    >
      <StateScreen
        title="Join with a code"
        onClose={() => nav("/")}
        actions={
          <Button type="submit" block icon={<ArrowRight aria-hidden="true" />} disabled={!valid}>
            Join
          </Button>
        }
      >
        <p className="state-screen__lead state-screen__lead--left">Or paste a link. Codes look like K7P-42Q.</p>
        <div className="code-boxes" role="group" aria-label="Room code">
          {chars.map((c, i) => (
            <span key={i} className="code-boxes__cell">
              {i === 3 && <span className="code-boxes__dash" aria-hidden="true">–</span>}
              <input
                value={c}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                aria-label={`Character ${i + 1}`}
                onChange={(e) => setAt(i, e.target.value, e.target)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !c && i > 0) ((e.target as HTMLInputElement).parentElement?.parentElement?.querySelectorAll("input")[i - 1] as HTMLInputElement | undefined)?.focus();
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  setAt(i, e.clipboardData.getData("text"), e.target as HTMLInputElement);
                }}
              />
            </span>
          ))}
        </div>
        <label className="field-label" htmlFor="join-you">Your name</label>
        <input id="join-you" name="you" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} />
        <p className="field-help">Asked once and remembered on this device. The host sees it.</p>
      </StateScreen>
    </form>
  );
}

export function WaitingForHost({ roomName, hostName, people, name, badge }: { roomName: string; hostName: string; people: number; name: string; badge: string }) {
  const host = hostName.split(" ")[0] ?? hostName;
  return (
    <StateScreen title={roomName} icon={<span className="state-badge">{badge}</span>} actions={<Link to="/signin" className="link-center">Have an account? Sign in</Link>}>
      <p className="state-screen__lead">{hostName} invited you · {people} {people === 1 ? "person" : "people"} inside</p>
      <div className="waiting-form">
        <label className="field-label" htmlFor="wait-name">Your name</label>
        <input id="wait-name" className="field" value={name} readOnly />
        <div className="av-row">
          <button type="button" className={buttonClass("secondary", "md", true)} disabled title="Audio arrives in M11"><Mic aria-hidden="true" /> Mic off</button>
          <button type="button" className={buttonClass("secondary", "md", true)} disabled title="Video arrives in M11"><Camera aria-hidden="true" /> Camera off</button>
        </div>
        <div className="waiting-box" role="status" aria-live="polite">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <b>Waiting for {host} to let you in</b>
          <span>No account needed. You'll join the board as a guest.</span>
        </div>
      </div>
    </StateScreen>
  );
}

export function RoomFull({ roomName, capacity, position, onLeave, onMessage }: { roomName: string; capacity: number; position: number; onLeave: () => void; onMessage: () => void }) {
  return (
    <StateScreen
      tone="warning"
      icon={<Users />}
      title="This room is full"
      actions={
        <>
          <Button variant="secondary" block icon={<MessageCircle aria-hidden="true" />} onClick={onMessage}>Message the host</Button>
          <Button variant="ghost" block onClick={onLeave}>Leave the line</Button>
        </>
      }
    >
      <p className="state-screen__lead">
        {capacity} of {capacity} people are in {roomName}. Rooms are kept small so they stay fast. You're next in line: we'll let you in as soon as someone leaves.
      </p>
      <span className="pill-note" role="status" aria-live="polite">You're #{position} in line</span>
    </StateScreen>
  );
}

export function SessionEnded({ roomName, isHost, isGuest, onDownload }: { roomName: string; isHost: boolean; isGuest: boolean; onDownload: () => void }) {
  return (
    <StateScreen
      tone="accent"
      icon={<CircleCheck />}
      title="Session ended"
      actions={
        <>
          <Button variant="secondary" block icon={<Download aria-hidden="true" />} onClick={onDownload}>Download the board (PNG)</Button>
          {isGuest ? (
            <Link to="/signin" className={buttonClass("primary", "md", true)}><UserPlus aria-hidden="true" /> Create a free account to keep it</Link>
          ) : (
            <Link to="/" className={buttonClass("primary", "md", true)}>Back to Home</Link>
          )}
        </>
      }
    >
      <p className="state-screen__lead">
        {isHost ? `${roomName} has ended for everyone.` : `Thanks for joining ${roomName}.`} The board and notes will be posted to the space shortly.
      </p>
    </StateScreen>
  );
}
