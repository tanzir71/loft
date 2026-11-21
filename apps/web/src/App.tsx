import { lazy, Suspense, type ComponentType } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { Home } from "./pages/Home";
import { More } from "./pages/More";
import { NotFound } from "./pages/Soon";
import { NewSpace } from "./pages/NewSpace";
import { SpacePage } from "./pages/Space";
import { ChatsPage, DmPage } from "./pages/Hallway";
import { InboxPage } from "./pages/Inbox";
import { Loading } from "./components/bits";
import "./pages/m3.css";
import "./pages/m5.css";
import "./pages/m6.css";
import "./room/room.css";
import "./pages/money/money.css";
import "./pages/insights/insights.css";
import "./pages/agents/agents.css";
import "./pages/system/system.css";

// Heavy screens load on demand so the first page stays light on phones (Lighthouse gate, M1/M12).
function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as unknown as ComponentType<Record<string, unknown>> }));
}
const room = () => import("./room/RoomPage");
const RoomPage = page(room, "RoomPage");
const NewRoom = page(room, "NewRoom");
const JoinPage = page(room, "JoinPage");
const CalendarPage = page(() => import("./pages/Calendar"), "CalendarPage");
const booking = () => import("./pages/Booking");
const AvailabilityPage = page(booking, "AvailabilityPage");
const BookingPage = page(booking, "BookingPage");
const ManagePage = page(booking, "ManagePage");
const PlanEditor = page(() => import("./pages/Plans"), "PlanEditor");
const WrapUpPage = page(() => import("./pages/WrapUp"), "WrapUpPage");
const money = () => import("./pages/money/Money");
const MoneyOverview = page(money, "MoneyOverview");
const MoneyLog = page(money, "MoneyLog");
const MoneyPackages = page(money, "MoneyPackages");
const MoneyPayments = page(money, "MoneyPayments");
const MoneyReminders = page(money, "MoneyReminders");
const invoices = () => import("./pages/money/Invoices");
const MoneyInvoices = page(invoices, "MoneyInvoices");
const InvoiceDetail = page(invoices, "InvoiceDetail");
const InvoicePrint = page(invoices, "InvoicePrint");
const pay = () => import("./pages/money/Pay");
const PayPage = page(pay, "PayPage");
const PayPrint = page(pay, "PayPrint");
const InsightsPage = page(() => import("./pages/insights/Insights"), "InsightsPage");
const CheckPage = page(() => import("./pages/checks/Checks"), "CheckPage");
const TakeCheck = page(() => import("./pages/checks/TakeCheck"), "TakeCheck");
const agents = () => import("./pages/agents/Agents");
const AgentsPage = page(agents, "AgentsPage");
const AgentsReadPage = page(agents, "AgentsReadPage");
const ReviewPage = page(agents, "ReviewPage");
const auth = () => import("./pages/system/Auth");
const SignInPage = page(auth, "SignInPage");
const InstallPage = page(auth, "InstallPage");
const OwnerPage = page(() => import("./pages/system/Owner"), "OwnerPage");
const BrandPage = page(() => import("./pages/system/Brand"), "BrandPage");
const SettingsPage = page(() => import("./pages/system/Settings"), "SettingsPage");
const AdminPage = page(() => import("./pages/system/Admin"), "AdminPage");

export function App() {
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="r/new" element={<NewRoom />} />
      <Route path="r/:code" element={<RoomPage />} />
      <Route path="join" element={<JoinPage />} />
      <Route path="book/:handle" element={<BookingPage />} />
      <Route path="manage/:token" element={<ManagePage />} />
      <Route path="pay/:token" element={<PayPage />} />
      <Route path="pay/:token/print" element={<PayPrint />} />
      <Route path="print/invoice/:id" element={<InvoicePrint />} />
      <Route path="checks/:id/take" element={<TakeCheck />} />
      <Route path="signin" element={<SignInPage />} />
      <Route path="install" element={<InstallPage />} />
      <Route path="owner" element={<OwnerPage />} />
      <Route path="admin" element={<AdminPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="calendar/availability" element={<AvailabilityPage />} />
        <Route path="plans/:id" element={<PlanEditor />} />
        <Route path="wrapup/:sessionId" element={<WrapUpPage />} />
        <Route path="review" element={<InboxPage initial="review" />} />
        <Route path="money" element={<MoneyOverview />} />
        <Route path="money/log" element={<MoneyLog />} />
        <Route path="money/invoices" element={<MoneyInvoices />} />
        <Route path="money/invoices/:id" element={<InvoiceDetail />} />
        <Route path="money/packages" element={<MoneyPackages />} />
        <Route path="money/payments" element={<MoneyPayments />} />
        <Route path="money/reminders" element={<MoneyReminders />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="checks/:id" element={<CheckPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/read" element={<AgentsReadPage />} />
        <Route path="agents/review/:taskId" element={<ReviewPage />} />
        <Route path="chats" element={<ChatsPage />} />
        <Route path="inbox" element={<InboxPage initial="review" />} />
        <Route path="spaces/new" element={<NewSpace />} />
        <Route path="s/:slug" element={<SpacePage />} />
        <Route path="s/:slug/:tab" element={<SpacePage />} />
        <Route path="dm/:userId" element={<DmPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="brand" element={<BrandPage />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
