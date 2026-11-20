import type { LocalDb } from "./db";

/** Bump when demo data changes; the local adapter re-seeds a browser whose data is older. */
export const SEED_VERSION = 1;

export const DEMO_HOST_ID = "u_nusrat";

/**
 * Preview demo data. Consulting/team examples come first, tutoring second (handoff §6).
 * M0 seeds the host only, so Home shows the "first run" state.
 */
export async function seed(db: LocalDb, now = new Date()): Promise<void> {
  const iso = now.toISOString();
  await db.put("users", {
    id: DEMO_HOST_ID,
    name: "Nusrat Rahman",
    email: "nusrat@example.com",
    tz: "UTC",
    status: "available",
    createdAt: iso
  });
  await db.put("settings", {
    id: DEMO_HOST_ID,
    roomLink: "tanziro.com/spaces/r/nusrat",
    bookingPage: null,
    paymentLink: null
  });
  await db.setMeta("currentUserId", DEMO_HOST_ID);
  await db.setMeta("seedVersion", SEED_VERSION);
}
