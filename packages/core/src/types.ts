/** Domain types shared by the SPA, the data adapters and (by contract) the PHP API. */

export type SpaceMode = "team" | "client" | "workshop" | "course" | "tutoring";
export type MemberRole = "host" | "cohost" | "member" | "payer" | "guest";
export type PresenceStatus = "available" | "away" | "busy" | "offline";

export interface User {
  id: string;
  name: string;
  email: string;
  tz: string;
  status: PresenceStatus;
  createdAt: string;
}

export interface Org {
  id: string;
  slug: string;
  name: string;
  theme: "loft" | "sunrise" | "northwind" | "aurelian";
  brandedUntil: string | null;
  ownerNote?: string;
  createdAt: string;
}

export interface Space {
  id: string;
  orgId: string | null;
  mode: SpaceMode;
  code: string;
  name: string;
  slug: string;
  colour: string;
  roomSlug: string;
  createdAt: string;
}

export interface Membership {
  spaceId: string;
  userId: string;
  role: MemberRole;
  payerUserId?: string | null;
}

export interface Room {
  id: string;
  spaceId: string | null;
  slug: string;
  code: string;
  name: string;
  capacity: number;
  guestJoin: boolean;
  createdBy: string;
  createdAt: string;
  endedAt: string | null;
}

export interface Settings {
  roomLink: string;
  bookingPage: string | null;
  paymentLink: string | null;
}
