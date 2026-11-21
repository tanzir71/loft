import { Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { Home } from "./pages/Home";
import { More } from "./pages/More";
import { NotFound, Soon } from "./pages/Soon";
import { JoinPage, NewRoom, RoomPage } from "./room/RoomPage";
import { NewSpace } from "./pages/NewSpace";
import { SpacePage } from "./pages/Space";
import { ChatsPage, DmPage } from "./pages/Hallway";
import { InboxPage } from "./pages/Inbox";
import "./pages/m3.css";
import { CalendarPage } from "./pages/Calendar";
import { AvailabilityPage, BookingPage, ManagePage } from "./pages/Booking";
import "./pages/m5.css";
import "./room/room.css";

export function App() {
  return (
    <Routes>
      <Route path="r/new" element={<NewRoom />} />
      <Route path="r/:code" element={<RoomPage />} />
      <Route path="join" element={<JoinPage />} />
      <Route path="book/:handle" element={<BookingPage />} />
      <Route path="manage/:token" element={<ManagePage />} />
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="calendar/availability" element={<AvailabilityPage />} />
        <Route path="review" element={<InboxPage initial="review" />} />
        <Route path="money" element={<Soon title="Money" milestone="M7" blurb="Session log, invoice runs where every line links to its session, payment links and “I've paid” claims." />} />
        <Route path="insights" element={<Soon title="Insights" milestone="M8" blurb="Last seen, attendance, on-time and at-risk, with automatic and custom nudges." />} />
        <Route path="agents" element={<Soon title="Agents" milestone="M9" blurb="One link and one line. Agents prepare drafts; you review and accept." />} />
        <Route path="chats" element={<ChatsPage />} />
        <Route path="inbox" element={<InboxPage initial="review" />} />
        <Route path="spaces/new" element={<NewSpace />} />
        <Route path="s/:slug" element={<SpacePage />} />
        <Route path="s/:slug/:tab" element={<SpacePage />} />
        <Route path="dm/:userId" element={<DmPage />} />
        <Route path="signin" element={<Soon title="Sign in" milestone="M10" blurb="Email sign-in links arrive with the PHP backend. The preview keeps you signed in as the demo host." />} />
        <Route path="settings" element={<Soon title="Settings" milestone="M10" blurb="Your profile, time zone, notifications and integrations (all optional) arrive with accounts in M10." />} />
        <Route path="brand" element={<Soon title="Brand studio" milestone="M10" blurb="Branding is one toggle turned on by email. No checkout, no custom domains." />} />
        <Route path="admin" element={<Soon title="Admin" milestone="M10" blurb="Calls and budget, integrations with your own keys. Everything works with all of them off." />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
