import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, LayoutDashboard, Link as LinkIcon, Play, Plus, Wallet } from "lucide-react";
import { Button } from "@loft/ui";
import type { User } from "@loft/core";
import { useQuery } from "../lib/data";
import { useBreakpoint } from "../lib/media";
import { PageHeader } from "../shell/PageHeader";
import { StartSheet } from "../shell/StartSheet";

interface HomeData {
  me: User;
  settings: { roomLink: string; bookingPage: string | null; paymentLink: string | null };
  spaces: unknown[];
  rooms: unknown[];
}

/** Figma 07 · "Home · first run (desktop)" and its phone version. */
export function Home() {
  const { data, error } = useQuery<HomeData>("home");
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const [start, setStart] = useState(false);

  if (error) return <div className="page"><p className="state-error">Could not load Home. <button className="link" onClick={() => location.reload()}>Try again</button></p></div>;
  if (!data) return <div className="page" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;

  const first = data.me.name.split(" ")[0] ?? data.me.name;
  const firstRun = data.spaces.length === 0;

  return (
    <div className="page page--home">
      {bp === "phone" && <PageHeader title="Home" />}
      {firstRun && (
        <section className="first-run" aria-labelledby="welcome">
          <div className="first-run__icon" aria-hidden="true">
            <LayoutDashboard />
          </div>
          <h1 id="welcome" className="first-run__title">Welcome, {first}</h1>
          <p className="first-run__lead">Start a room right now, or make a space for a group you meet regularly: a client, a team, a class.</p>
          <div className="first-run__actions">
            <Button variant="secondary" icon={<Play aria-hidden="true" />} onClick={() => setStart(true)} block={bp === "phone"}>
              Start a room
            </Button>
            <Button icon={<Plus aria-hidden="true" />} onClick={() => navigate("/spaces/new")} block={bp === "phone"}>
              New space
            </Button>
          </div>
          <ul className="first-run__cards" role="list">
            <li className="setup-card">
              <LinkIcon aria-hidden="true" />
              <span className="setup-card__title">Your room link</span>
              <span className="setup-card__sub">{data.settings.roomLink}</span>
            </li>
            <li className="setup-card">
              <Calendar aria-hidden="true" />
              <span className="setup-card__title">Booking page</span>
              <span className="setup-card__sub">{data.settings.bookingPage ?? "set your hours later"}</span>
            </li>
            <li className="setup-card">
              <Wallet aria-hidden="true" />
              <span className="setup-card__title">Payment link</span>
              <span className="setup-card__sub">{data.settings.paymentLink ?? "add it once, used on every invoice"}</span>
            </li>
          </ul>
        </section>
      )}
      <StartSheet open={start} onClose={() => setStart(false)} />
    </div>
  );
}
