import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Avatar } from "@loft/ui";
import { useQuery } from "../lib/data";
import { NotificationsBell } from "../pages/Inbox";
import type { NavData } from "./AppShell";

interface Person { id: string; name: string; status: string }

/** Desktop top bar (68 px): search people and spaces, notifications bell. */
export function TopBar() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { data: navData } = useQuery<NavData>("nav");
  const { data: people = [] } = useQuery<Person[]>("dms");
  const { data: spaces = [] } = useQuery<{ id: string; slug: string; name: string }[]>("spaces");
  const term = q.trim().toLowerCase();
  const results = term
    ? [
        ...spaces.filter((s) => s.name.toLowerCase().includes(term) || s.slug.includes(term)).map((s) => ({ key: s.id, label: s.name, sub: `#${s.slug}`, to: `/s/${s.slug}`, person: false })),
        ...people.filter((p) => p.name.toLowerCase().includes(term)).map((p) => ({ key: p.id, label: p.name, sub: "Direct message", to: `/dm/${p.id}`, person: true }))
      ].slice(0, 8)
    : [];
  return (
    <div className="topbar">
      <div className="topbar__search">
        <Search aria-hidden="true" />
        <input
          type="search"
          placeholder="Search people, spaces, files"
          aria-label="Search people, spaces, files"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              nav(results[0].to);
              setQ("");
            }
            if (e.key === "Escape") setQ("");
          }}
        />
        {results.length > 0 && (
          <ul className="topbar__results" role="listbox">
            {results.map((r) => (
              <li key={r.key} role="option" aria-selected="false">
                <button type="button" onClick={() => { nav(r.to); setQ(""); }}>
                  {r.person ? <Avatar name={r.label} size="sm" /> : <span className="hash" aria-hidden="true">#</span>}
                  <span><b>{r.label}</b><small>{r.sub}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <NotificationsBell />
      <span className="sr-only">{navData ? `${navData.counts.inbox} in your inbox` : ""}</span>
    </div>
  );
}
