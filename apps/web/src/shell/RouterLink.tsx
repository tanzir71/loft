import { Link } from "react-router-dom";
import type { LinkLike } from "@loft/ui";

/** Adapts react-router's Link to the UI package's LinkLike contract. */
export const RouterLink: LinkLike = ({ to, children, ...rest }) => (
  <Link to={to} {...rest}>
    {children}
  </Link>
);
