import { Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { Home } from "./pages/Home";
import { More } from "./pages/More";
import { NotFound, Soon } from "./pages/Soon";
import { JoinPage, NewRoom, RoomPage } from "./room/RoomPage";
import "./room/room.css";

export function App() {
  return (
    <Routes>
      <Route path="r/new" element={<NewRoom />} />
      <Route path="r/:code" element={<RoomPage />} />
      <Route path="join" element={<JoinPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="calendar" element={<Soon title="Calendar" milestone="M5" blurb="Week, day and month views, series with clash checks, booking pages and reschedule requests." />} />
        <Route path="review" element={<Soon title="To review" milestone="M3" blurb="Everything waiting on you: knocks, must-read acks, submitted tasks and, later, agent drafts." />} />
        <Route path="money" element={<Soon title="Money" milestone="M7" blurb="Session log, invoice runs where every line links to its session, payment links and “I've paid” claims." />} />
        <Route path="insights" element={<Soon title="Insights" milestone="M8" blurb="Last seen, attendance, on-time and at-risk, with automatic and custom nudges." />} />
        <Route path="agents" element={<Soon title="Agents" milestone="M9" blurb="One link and one line. Agents prepare drafts; you review and accept." />} />
        <Route path="chats" element={<Soon title="Chats" milestone="M3" blurb="The hallway: live rooms, spaces as channels, DMs with presence and Knock." />} />
        <Route path="inbox" element={<Soon title="Inbox" milestone="M3" blurb="To review and notifications in one place." />} />
        <Route path="spaces/new" element={<Soon title="New space" milestone="M3" blurb="Pick a mode (team, client, workshop, course, tutoring) and invite people." />} />
        <Route path="s/:slug/*" element={<Soon title="Space" milestone="M3" blurb="Stream, tasks, files and people for one group." />} />
        <Route path="signin" element={<Soon title="Sign in" milestone="M10" blurb="Email sign-in links arrive with the PHP backend. The preview keeps you signed in as the demo host." />} />
        <Route path="settings" element={<Soon title="Settings" milestone="M3" blurb="Your profile, time zone, notifications and integrations (all optional)." />} />
        <Route path="brand" element={<Soon title="Brand studio" milestone="M10" blurb="Branding is one toggle turned on by email. No checkout, no custom domains." />} />
        <Route path="admin" element={<Soon title="Admin" milestone="M10" blurb="Calls and budget, integrations with your own keys. Everything works with all of them off." />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
