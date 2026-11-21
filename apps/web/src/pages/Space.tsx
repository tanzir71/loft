import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { Bell, ChevronLeft, CircleCheck, Copy, FileText, History, ListChecks, Play, Send, Settings, Upload, UserPlus } from "lucide-react";
import { Avatar, Badge, Button } from "@loft/ui";
import { formatTime, SPACE_MODES, tabLabel, type ModeConfig, type SpaceMode, type SpaceTab } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";
import { useBreakpoint } from "../lib/media";
import { ErrorState, Loading, relTime, whenLabel } from "../components/bits";
import { PlansTab } from "./Plans";
import { BillingSetup } from "./money/Billing";

interface SpaceView {
  id: string; slug: string; name: string; sub: string; code: string; colour: string; mode: SpaceMode;
  modeConfig: ModeConfig; isHost: boolean; myRole: string; joinCode: string;
  members: { userId: string; name: string; role: string; status: string; title: string }[];
  upcoming: { kind: string; title: string; at: string }[];
}
interface PostView {
  id: string; kind: string; title: string; body: string; mustRead: boolean; dueAt?: string; createdAt: string; createdBy: string; authorName: string;
  attachments: { name: string; meta: string; kind: string }[]; acked: number; audience: number; ackedByMe: boolean; notSeen: string[]; handIns: number;
  mySubmission: { status: string } | null;
}

const LATER: Partial<Record<SpaceTab, string>> = { agenda: "M6", votes: "M4", grades: "M8", sessions: "M5", notes: "M6" };

/** Figma 04 · "Host · Space — Stream (hybrid)" and 05 · "Host · Space stream (phone)". */
export function SpacePage() {
  const { slug = "", tab = "" } = useParams();
  const adapter = useAdapter();
  const nav = useNavigate();
  const phone = useBreakpoint() === "phone";
  const { data: s, error, reload } = useQuery<SpaceView>(`spaces/${slug}`);
  const marked = useRef<string | null>(null);

  useEffect(() => {
    if (s && marked.current !== s.id) {
      marked.current = s.id;
      void adapter.mutate(`spaces/${s.id}/read`);
    }
  }, [adapter, s]);

  if (error) return <ErrorState what="this space" onRetry={reload} />;
  if (!s) return <Loading label="Loading space" />;
  // Every space has a Plans tab for hosts (the workshop's "Agenda" tab is its plans).
  type Tab = SpaceTab | "plans";
  let tabs: Tab[] = s.modeConfig.tabs.map((t) => (t === "agenda" ? "plans" : t));
  if (s.isHost && !tabs.includes("plans")) tabs.splice(Math.max(0, tabs.indexOf("chat") + 1), 0, "plans");
  // Billing is the host's (Figma 06 · I1): every paid mode gets the tab; members never see it.
  if (s.isHost && s.mode !== "team" && !tabs.includes("billing")) tabs.push("billing");
  if (!s.isHost) tabs = tabs.filter((t) => t !== "plans" && t !== "billing");
  const current = (tabs.includes(tab as Tab) ? tab : tabs[0]) as Tab;
  const labelOf = (t: Tab) => (t === "plans" ? (s.mode === "workshop" ? "Agenda" : "Plans") : tabLabel(s.mode, t));
  const startRoom = async () => {
    const r = await adapter.mutate<{ code: string }>("rooms", { name: s.name, spaceId: s.id });
    nav(`/r/${r.code}`);
  };

  return (
    <div className="space-page">
      <header className="space-top">
        {phone && <button type="button" className="lf-icon-btn" onClick={() => nav(-1)} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>}
        <h1 className="space-top__name"><span aria-hidden="true">#</span> {s.slug}</h1>
        <nav className="space-tabs" aria-label="Space sections">
          {tabs.map((t) => (
            <NavLink key={t} to={`/s/${s.slug}/${t}`} className={() => `space-tab${current === t ? " is-on" : ""}`} aria-current={current === t ? "page" : undefined}>
              {labelOf(t)}
            </NavLink>
          ))}
        </nav>
        {!phone && <button type="button" className="lf-icon-btn" aria-label="Space settings" title="Space settings arrive with Admin (M10)"><Settings aria-hidden="true" /></button>}
        <Button size="sm" icon={<Play aria-hidden="true" />} onClick={() => void startRoom()}>{phone ? "Room" : "Start room"}</Button>
      </header>
      <div className={`space-body${current === "billing" ? " space-body--wide" : ""}`}>
        {current === "stream" && (
          <div className={`space-banner sc-${s.colour}`}>
            <h2>{s.name}</h2>
            <p>{s.sub}</p>
            <i aria-hidden="true">{s.code}</i>
          </div>
        )}
        {current === "stream" ? (
          <div className="stream-grid">
            {!phone && (
              <aside className="stream-side">
                <JoinCodeCard code={s.joinCode} mode={s.mode} />
                <section className="side-card">
                  <h3>Upcoming</h3>
                  {s.upcoming.length === 0 ? <p className="muted-note">Nothing due.</p> : (
                    <ul role="list">
                      {s.upcoming.map((u) => (
                        <li key={u.kind + u.at + u.title}>
                          <small>{whenLabel(u.at).split(" ")[0]}</small>
                          <span>{formatTime(u.at)} – {u.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link to={`/s/${s.slug}/work`} className="link-action">View all</Link>
                </section>
              </aside>
            )}
            <Stream space={s} />
          </div>
        ) : current === "chat" ? (
          <SpaceChat spaceId={s.id} />
        ) : current === "work" ? (
          <Work space={s} />
        ) : current === "files" ? (
          <Files spaceId={s.id} />
        ) : current === "people" ? (
          <People space={s} />
        ) : current === "plans" ? (
          <PlansTab spaceId={s.id} />
        ) : current === "billing" ? (
          <BillingSetup spaceId={s.id} />
        ) : (
          <section className="empty">
            <h2 className="empty__title">{labelOf(current)} arrives in {LATER[current as SpaceTab] ?? "a later milestone"}</h2>
            <p className="empty__lead">This tab is part of the {SPACE_MODES[s.mode].label.toLowerCase()} mode.</p>
          </section>
        )}
      </div>
    </div>
  );
}

function JoinCodeCard({ code, mode }: { code: string; mode: SpaceMode }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="side-card">
      <h3>{mode === "course" ? "Class code" : "Join code"}</h3>
      <div className="join-code">
        <b>{code}</b>
        <button
          type="button"
          className="lf-icon-btn"
          aria-label="Copy join code"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {
              /* ignore */
            }
          }}
        >
          {copied ? <CircleCheck aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
    </section>
  );
}

function Stream({ space }: { space: SpaceView }) {
  const adapter = useAdapter();
  const { data: posts = [] } = useQuery<PostView[]>(`spaces/${space.id}/posts`);
  const { data: me } = useQuery<{ id: string; name: string }>("me");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"post" | "notice" | "task">("post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const submit = async () => {
    await adapter.mutate(`spaces/${space.id}/posts`, { kind, title: kind === "post" ? "" : title, body, dueAt: kind === "task" && due ? new Date(due).toISOString() : "" });
    setOpen(false);
    setTitle("");
    setBody("");
    setDue("");
    setKind("post");
  };

  return (
    <div className="stream">
      {flash && <p className="flash" role="status">{flash}</p>}
      {!open ? (
        <button type="button" className="composer" onClick={() => setOpen(true)}>
          <Avatar name={me?.name ?? "?"} tone="lilac" />
          <span>{space.modeConfig.composer}</span>
        </button>
      ) : (
        <form
          className="composer composer--open"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {space.isHost && (
            <div className="seg" role="radiogroup" aria-label="Post type">
              {(["post", "notice", "task"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
                  {k === "post" ? "Update" : k === "notice" ? "Must-read" : space.modeConfig.workLabel.replace(/s$/, "")}
                </button>
              ))}
            </div>
          )}
          {kind !== "post" && <input className="field" placeholder={kind === "task" ? "Title" : "What changed?"} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} aria-label="Title" />}
          <textarea className="field field--area" placeholder={kind === "notice" ? "Everyone will be asked to confirm they've seen this." : "Write something…"} value={body} onChange={(e) => setBody(e.target.value)} rows={3} aria-label="Message" autoFocus />
          {kind === "task" && (
            <label className="inline-field">Due <input type="datetime-local" className="field" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          )}
          <div className="composer__actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" icon={<Send aria-hidden="true" />} disabled={!body.trim() && !title.trim()}>Post</Button>
          </div>
        </form>
      )}
      {posts.length === 0 && <p className="muted-note">Nothing here yet. Recaps post themselves after each session.</p>}
      <ul className="posts" role="list">
        {posts.map((p) => (
          <li key={p.id} className="post">
            <span className="post__ic" aria-hidden="true">
              {p.kind === "recap" ? <History /> : p.kind === "notice" ? <Bell /> : p.kind === "task" ? <ListChecks /> : <Avatar name={p.authorName} />}
            </span>
            <div className="post__main">
              <b className="post__title">
                {p.kind === "task" ? `${p.authorName.split(" ")[0]} posted: ${p.title}` : p.title || p.authorName}
              </b>
              <span className="post__meta">
                {new Date(p.createdAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                {p.kind === "recap" && " · posted automatically after the session"}
                {p.mustRead && ` · ${p.acked} of ${p.audience} acknowledged`}
                {p.kind === "task" && p.dueAt && ` · due ${whenLabel(p.dueAt)}`}
              </span>
              {p.body && <p className="post__body">{p.body}</p>}
              {p.attachments.length > 0 && (
                <div className="post__files">
                  {p.attachments.map((a) => (
                    <span key={a.name} className="file-chip">
                      {a.kind === "task" ? <ListChecks aria-hidden="true" /> : <FileText aria-hidden="true" />}
                      <span><b>{a.name}</b><small>{a.meta}</small></span>
                    </span>
                  ))}
                </div>
              )}
              {p.mustRead && space.isHost && p.notSeen.length > 0 && (
                <p className="post__ack">
                  <span className="warn">{p.notSeen.length} haven't seen this yet</span>
                  <button
                    type="button"
                    className="link-action"
                    onClick={async () => {
                      const r = await adapter.mutate<{ reminded: number }>(`posts/${p.id}/remind`);
                      setFlash(`Reminded ${r.reminded} ${r.reminded === 1 ? "person" : "people"}.`);
                      setTimeout(() => setFlash(null), 2500);
                    }}
                  >
                    Remind them
                  </button>
                  <span className="post__who" title={p.notSeen.join(", ")}>{p.notSeen.join(", ")}</span>
                </p>
              )}
              {p.mustRead && !space.isHost && (p.ackedByMe ? <Badge status="success">Seen</Badge> : <Button size="sm" variant="soft" onClick={() => adapter.mutate(`posts/${p.id}/ack`)}>Got it</Button>)}
              {p.kind === "task" && space.isHost && p.handIns > 0 && <Link to={`/s/${space.slug}/work`} className="link-action">{p.handIns} hand-in{p.handIns === 1 ? "" : "s"} to review</Link>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface WorkItem { id: string; title: string; body: string; dueAt?: string; assigned: number; submissions: { id: string; userId: string; name?: string; status: string; note: string; at: string; feedback?: string }[] }

function Work({ space }: { space: SpaceView }) {
  const adapter = useAdapter();
  const { data: items = [] } = useQuery<WorkItem[]>(`spaces/${space.id}/work`);
  return (
    <div className="stream">
      <h2 className="tab-title">{space.modeConfig.workLabel}</h2>
      {items.length === 0 && <p className="muted-note">No {space.modeConfig.workLabel.toLowerCase()} yet. Post one from the stream.</p>}
      <ul className="posts" role="list">
        {items.map((t) => {
          const mine = t.submissions[0];
          return (
            <li key={t.id} className="post">
              <span className="post__ic" aria-hidden="true"><ListChecks /></span>
              <div className="post__main">
                <b className="post__title">{t.title}</b>
                <span className="post__meta">{t.dueAt ? `Due ${whenLabel(t.dueAt)}` : "No due date"}{space.isHost && ` · ${t.submissions.length} of ${t.assigned} handed in`}</span>
                {t.body && <p className="post__body">{t.body}</p>}
                {space.isHost ? (
                  <ul className="handins" role="list">
                    {t.submissions.map((s) => (
                      <li key={s.id}>
                        <Avatar name={s.name ?? "?"} size="sm" />
                        <span className="handins__who"><b>{s.name}</b> · {relTime(s.at)}{s.note && ` · “${s.note}”`}</span>
                        {s.status === "handed-in" ? (
                          <>
                            <Button size="sm" variant="soft" onClick={() => adapter.mutate(`submissions/${s.id}/review`, { status: "done" })}>Mark done</Button>
                            <Button size="sm" variant="ghost" onClick={() => { const f = prompt("What should they change?"); if (f) void adapter.mutate(`submissions/${s.id}/review`, { status: "returned", feedback: f }); }}>Return</Button>
                          </>
                        ) : (
                          <Badge status={s.status === "done" ? "success" : "warning"}>{s.status === "done" ? "Done" : "Returned"}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : mine ? (
                  <Badge status={mine.status === "done" ? "success" : mine.status === "returned" ? "warning" : "info"}>{mine.status === "handed-in" ? "Handed in" : mine.status === "done" ? "Done" : `Returned: ${mine.feedback ?? ""}`}</Badge>
                ) : (
                  <Button size="sm" onClick={() => adapter.mutate(`posts/${t.id}/handin`, { note: prompt("Add a note (optional)") ?? "" })}>Hand in</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Files({ spaceId }: { spaceId: string }) {
  const adapter = useAdapter();
  const { data: files = [] } = useQuery<{ id: string; fileId: string; name: string; bytes: number; ownerName: string; createdAt: string }[]>(`spaces/${spaceId}/files`);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const open = async (fileId: string) => {
    const a = adapter as unknown as { files: { load?: (id: string) => Promise<string>; url: (id: string) => string } };
    const url = a.files.load ? await a.files.load(fileId) : a.files.url(fileId);
    if (url) window.open(url, "_blank", "noopener");
  };
  return (
    <div className="stream">
      <div className="tab-head">
        <h2 className="tab-title">Files</h2>
        <Button size="sm" variant="secondary" icon={<Upload aria-hidden="true" />} onClick={() => input.current?.click()} disabled={busy}>Upload</Button>
        <input
          ref={input}
          type="file"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              const ref = await adapter.files.put(f, { name: f.name, spaceId });
              await adapter.mutate(`spaces/${spaceId}/files`, { ref });
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </div>
      {files.length === 0 && <p className="muted-note">No files yet. Boards saved from rooms land here too.</p>}
      <ul className="file-list" role="list">
        {files.map((f) => (
          <li key={f.id}>
            <button type="button" className="file-row" onClick={() => void open(f.fileId)}>
              <FileText aria-hidden="true" />
              <span><b>{f.name}</b><small>{(f.bytes / 1024).toFixed(0)} KB · {f.ownerName} · {relTime(f.createdAt)}</small></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function People({ space }: { space: SpaceView }) {
  const adapter = useAdapter();
  return (
    <div className="stream">
      <div className="tab-head">
        <h2 className="tab-title">People · {space.members.length}</h2>
        {space.isHost && (
          <Button
            size="sm"
            variant="secondary"
            icon={<UserPlus aria-hidden="true" />}
            onClick={() => {
              const name = prompt("Name of the person to add");
              if (name) void adapter.mutate(`spaces/${space.id}/members`, { name, role: "member" });
            }}
          >
            Add person
          </Button>
        )}
      </div>
      <ul className="people" role="list">
        {space.members.map((m) => (
          <li key={m.userId}>
            <Avatar name={m.name} presence={m.status as "available"} />
            <span><b>{m.name}</b><small>{m.title}</small></span>
            <Badge status={m.role === "host" ? "info" : m.role === "payer" ? "warning" : "neutral"} dot={false}>{m.role}</Badge>
            {m.role !== "host" && <Link to={`/dm/${m.userId}`} className="link-action">Message</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SpaceMsg { id: string; userId: string; name: string; body: string; createdAt: string }

export function SpaceChat({ spaceId }: { spaceId: string }) {
  const adapter = useAdapter();
  const { data: msgs = [] } = useQuery<SpaceMsg[]>(`spaces/${spaceId}/messages`);
  return <ChatThread msgs={msgs} placeholder="Message the space" onSend={(body) => adapter.mutate(`spaces/${spaceId}/messages`, { body })} />;
}

export function ChatThread({ msgs, placeholder, onSend, extraActions, renderMsg }: { msgs: SpaceMsg[]; placeholder: string; onSend: (body: string) => Promise<unknown>; extraActions?: React.ReactNode; renderMsg?: (m: SpaceMsg) => React.ReactNode | null }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [msgs.length]);
  return (
    <div className="thread">
      <ol className="thread__list" ref={list} aria-live="polite">
        {msgs.length === 0 && <li className="muted-note">No messages yet.</li>}
        {msgs.map((m, i) => {
          const day = new Date(m.createdAt).toDateString();
          const prev = msgs[i - 1];
          const divider = !prev || new Date(prev.createdAt).toDateString() !== day;
          return (
            <li key={m.id}>
              {divider && <div className="thread__day"><span>{day === new Date().toDateString() ? "Today" : new Date(m.createdAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</span></div>}
              <div className="msg">
                <Avatar name={m.name} />
                <div>
                  <span className="msg__head"><b>{m.name}</b> <time>{formatTime(m.createdAt)}</time></span>
                  {renderMsg?.(m) ?? <p>{m.body}</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <form
        className="thread__form"
        onSubmit={(e) => {
          e.preventDefault();
          const b = text.trim();
          if (!b) return;
          setText("");
          void onSend(b);
        }}
      >
        <label className="sr-only" htmlFor="thread-input">{placeholder}</label>
        <input id="thread-input" className="thread__input" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" maxLength={2000} />
        {extraActions}
        <button type="submit" className="lf-icon-btn lf-icon-btn--primary thread__send" aria-label="Send" disabled={!text.trim()}><Send aria-hidden="true" /></button>
      </form>
    </div>
  );
}
