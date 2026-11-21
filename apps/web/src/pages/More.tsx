import { Link } from "react-router-dom";
import { Calendar, ChartLine, ChevronRight, Palette, RotateCcw, Settings, Shield, Sparkles, Wallet } from "lucide-react";
import type { LocalAdapter } from "@loft/data";
import { useAdapter } from "../lib/data";
import { IS_PREVIEW } from "../lib/env";
import { PageHeader } from "../shell/PageHeader";

const ITEMS = [
  { to: "/money", label: "Money", icon: Wallet },
  { to: "/insights", label: "Insights", icon: ChartLine },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/agents", label: "Agents", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/brand", label: "Brand", icon: Palette },
  { to: "/admin", label: "Admin", icon: Shield },
  { to: "/owner", label: "Owner console", icon: Shield }
];

/** Figma 05 · Host · More (phone). Money, Insights, Calendar, Settings, Brand and Admin live here on phones. */
export function More() {
  const adapter = useAdapter();
  return (
    <div className="page">
      <PageHeader title="More" />
      <ul className="list-card" role="list">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="list-row">
              <Icon aria-hidden="true" />
              <span className="list-row__label">{label}</span>
              <ChevronRight aria-hidden="true" className="list-row__chev" />
            </Link>
          </li>
        ))}
      </ul>
      {IS_PREVIEW && (
        <ul className="list-card" role="list">
          <li>
            <button
              type="button"
              className="list-row"
              onClick={async () => {
                if (confirm("Reset to the demo workspace? This browser's preview data is replaced.")) {
                  await (adapter as LocalAdapter).reset();
                  location.hash = "#/";
                }
              }}
            >
              <RotateCcw aria-hidden="true" />
              <span className="list-row__label">Reset to the demo workspace</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="list-row"
              onClick={async () => {
                if (confirm("Start with an empty workspace? This browser's preview data is replaced.")) {
                  await (adapter as LocalAdapter).reset({ empty: true });
                  location.hash = "#/";
                }
              }}
            >
              <RotateCcw aria-hidden="true" />
              <span className="list-row__label">Start with an empty workspace</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
