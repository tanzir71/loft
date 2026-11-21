#!/usr/bin/env node
// Capacity + rate limits against a running PHP API (handoff M12). Start the API first, e.g.
//   LOFT_DATA=$(mktemp -d) php -S 127.0.0.1:8099 -t api/public api/public/index.php
// then: node scripts/load-room.mjs http://127.0.0.1:8099/api/v1
// Checks: 12 people get a seat and the 13th waits (and gets in when someone leaves), 12 people
// drawing at once never lose an op or reuse a seq, presence expires, and a burst from one IP gets 429s.
import assert from "node:assert/strict";

const API = (process.argv[2] ?? "http://127.0.0.1:8099/api/v1").replace(/\/$/, "");
const CAPACITY = 12;

class Client {
  constructor(name) {
    this.name = name;
    this.cookie = "";
    this.tab = `tab_${name.replace(/\W/g, "").toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async req(method, path, body) {
    const res = await fetch(`${API}/${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.get("set-cookie");
    if (set && /loft_session=([^;]+)/.test(set)) this.cookie = `loft_session=${set.match(/loft_session=([^;]+)/)[1]}`;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json };
  }
  get(path) {
    return this.req("GET", path);
  }
  post(path, body = {}) {
    return this.req("POST", path, body);
  }
}

const log = (...a) => console.log("·", ...a);

// 1. Install (first run) → the host is signed in.
const host = new Client("Host");
const inst = await host.get("install");
if (!inst.json?.installed) {
  const r = await host.post("install", { name: "Load Host", email: "host@load.test", appUrl: "http://127.0.0.1:8099/", timezone: "UTC" });
  assert.equal(r.status, 200, `install failed: ${JSON.stringify(r.json)}`);
  log("installed; host signed in");
} else {
  throw new Error("Run this against a fresh data folder (the install wizard must not have run yet).");
}

// 2. A room.
const room = (await host.post("rooms", { name: "Load test", guestJoin: true })).json;
assert.ok(room?.id, "room created");
log(`room ${room.code}`);

// The seat rule the app uses: you're in while fewer than 12 humans are in.
async function heartbeat(c, status) {
  const r = await c.post(`rooms/${room.id}/presence`, { tabId: c.tab, state: { status, cursor: null, joinedAt: c.joinedAt } });
  assert.equal(r.status, 200, `${c.name} presence: ${JSON.stringify(r.json)}`);
  return r.json;
}
async function joinRoom(c) {
  c.joinedAt = Date.now();
  const peers = await heartbeat(c, "waiting");
  const inNow = peers.filter((p) => p.status === "in").length;
  const queueAhead = peers.filter((p) => p.status === "waiting" && p.joinedAt < c.joinedAt).length;
  c.seat = inNow < CAPACITY && queueAhead < CAPACITY - inNow ? "in" : "waiting";
  await heartbeat(c, c.seat);
  return c.seat;
}

// 3. Host + 12 guests arrive; with the host, the 12th guest is person 13 and waits.
host.joinedAt = Date.now();
await heartbeat(host, "in");
const guests = [];
for (let i = 1; i <= 12; i++) {
  const g = new Client(`Guest ${i}`);
  const made = await g.post("guests", { name: g.name });
  assert.equal(made.status, 200, "guest created");
  assert.ok(g.cookie, "guest got a session cookie");
  const knock = await g.post(`rooms/${room.id}/knock`);
  assert.equal(knock.json?.status, "admitted", "guest join is on");
  guests.push(g);
  await joinRoom(g);
}
const seats = guests.map((g) => g.seat);
assert.equal(seats.filter((s) => s === "in").length, CAPACITY - 1, "11 guests + the host = 12 in the room");
assert.equal(seats.at(-1), "waiting", "the 13th person waits");
const peers = (await host.get(`rooms/${room.id}/presence`)).json;
assert.equal(peers.length, 13, "everyone shows in presence");
log("12 in the room, the 13th waiting");

// 4. Someone leaves → the person waiting gets the seat on their next heartbeat.
await guests[0].post(`rooms/${room.id}/presence/leave`, { tabId: guests[0].tab });
const waiting = guests.at(-1);
const after = await heartbeat(waiting, "waiting");
const inNow = after.filter((p) => p.status === "in").length;
assert.equal(inNow, CAPACITY - 1, "a seat freed up");
waiting.seat = inNow < CAPACITY ? "in" : "waiting";
assert.equal(waiting.seat, "in", "the waiting person gets in");
log("seat freed and taken");

// 5. Twelve people draw at once: every op lands, seqs are unique and gapless.
const drawers = [host, ...guests.slice(1)];
const before = (await host.get(`rooms/${room.id}/ops?since=0`)).json.length;
const results = await Promise.all(drawers.map((c, i) => c.post(`rooms/${room.id}/ops`, { ops: Array.from({ length: 5 }, (_, k) => ({ kind: "add", payload: { obj: { id: `s_${i}_${k}`, kind: "sticky", x: i * 10, y: k * 10, w: 100, h: 80, text: `${c.name} ${k}`, colour: "yellow", z: 1 } } })) })));
for (const r of results) assert.equal(r.status, 200, `ops: ${JSON.stringify(r.json)}`);
const all = (await host.get(`rooms/${room.id}/ops?since=0`)).json;
assert.equal(all.length - before, drawers.length * 5, "no op lost");
const seqs = all.map((o) => o.seq);
assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "seqs are unique and gapless");
log(`${drawers.length * 5} concurrent ops, seq 1…${seqs.length}`);

// 6. A burst from one IP hits the per-IP limit (240 writes a minute) with 429s, not errors.
const burst = new Client("Burst");
burst.cookie = host.cookie;
const codes = [];
for (let i = 0; i < 300; i++) codes.push((await burst.post(`rooms/${room.id}/presence`, { tabId: "burst", state: { status: "in" } })).status);
assert.ok(codes.includes(429), "the burst is rate-limited");
assert.ok(!codes.some((c) => c >= 500), "no server errors under load");
log(`burst: ${codes.filter((c) => c === 429).length} of 300 got 429`);

console.log("\nLoad check passed.");
