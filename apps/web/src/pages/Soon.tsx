import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { buttonClass } from "@loft/ui";
import { PageHeader } from "../shell/PageHeader";

/** Honest placeholder for screens that land in a later milestone. */
export function Soon({ title, milestone, blurb }: { title: string; milestone: string; blurb: string }) {
  return (
    <div className="page">
      <PageHeader title={title} />
      <section className="empty" aria-labelledby="soon-title">
        <div className="first-run__icon" aria-hidden="true"><Clock /></div>
        <h2 id="soon-title" className="empty__title">{title} arrives in {milestone}</h2>
        <p className="empty__lead">{blurb}</p>
        <Link to="/" className={buttonClass("secondary")}>Back to Home</Link>
      </section>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page">
      <section className="empty" aria-labelledby="nf-title">
        <h2 id="nf-title" className="empty__title">Nothing here</h2>
        <p className="empty__lead">That link doesn't match a page. It may have moved, or the room has ended.</p>
        <Link to="/" className={buttonClass("primary")}>Go to Home</Link>
      </section>
    </div>
  );
}
