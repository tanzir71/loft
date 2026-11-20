import { Calendar, ChartLine, House, Inbox, Sparkles, Wallet } from "lucide-react";
import type { NavItem } from "@loft/ui";

export function mainNav(counts: { review?: number } = {}): NavItem[] {
  return [
    { key: "home", label: "Home", to: "/", icon: <House aria-hidden="true" /> },
    { key: "calendar", label: "Calendar", to: "/calendar", icon: <Calendar aria-hidden="true" /> },
    { key: "review", label: "To review", to: "/review", icon: <Inbox aria-hidden="true" />, count: counts.review ?? 0 },
    { key: "money", label: "Money", to: "/money", icon: <Wallet aria-hidden="true" /> },
    { key: "insights", label: "Insights", to: "/insights", icon: <ChartLine aria-hidden="true" /> },
    { key: "agents", label: "Agents", to: "/agents", icon: <Sparkles aria-hidden="true" /> }
  ];
}
