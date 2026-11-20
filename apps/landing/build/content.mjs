// Landing content + renderers. Source: Figma "Loft · landing v2 (tack pattern)" [57:370] and
// "Loft · for organisations v2" [65:1669]. Copy follows the design, except where the handoff's
// constraints win (no custom domains) — see docs/decisions.md.
import { icon } from "./icons.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mk = (tone = "") => `<span class="mk${tone ? ` mk--${tone}` : ""}" aria-hidden="true"></span>`;

export function makeLinks({ base, appUrl, router }) {
  const app = appUrl ?? `${base}app/`;
  return {
    home: base,
    orgs: `${base}organisations/`,
    app,
    route: (path) => (router === "hash" ? `${app}#${path}` : `${app}${path.replace(/^\//, "")}`),
    img: (name) => `${base}img/${name}`
  };
}

function btn(label, href, variant = "dark", extra = "") {
  const tone = { dark: "white", muted: "", card: "", white: "dark" }[variant];
  return `<a class="tbtn tbtn--${variant}" href="${href}"${extra}>${mk(tone)}${esc(label)}</a>`;
}

function chip(text) {
  return `<span class="chip">${mk()}${esc(text)}</span>`;
}

function eyebrow(text) {
  return `<p class="eyebrow">${mk()}${esc(text)}</p>`;
}

function img(L, name, w, h, alt, eager = false) {
  return `<img src="${L.img(name)}" width="${w}" height="${h}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'}>`;
}

export function nav(L, active = "") {
  const link = (label, href, key) => `<a href="${href}"${active === key ? ' class="is-active" aria-current="page"' : ""}>${label}</a>`;
  return `<header class="tnav">
  <a class="tbrand" href="${L.home}" aria-label="loft home"><span class="tbrand__word">loft</span><span class="tbrand__mk" aria-hidden="true"></span><span class="tbrand__by">by tanzir rahman</span></a>
  <nav class="tnav__links" aria-label="Sections">
    ${link("rooms", `${L.home}#rooms`, "rooms")}
    ${link("spaces", `${L.home}#spaces`, "spaces")}
    ${link("money", `${L.home}#money`, "money")}
    ${link("for schools", L.orgs, "orgs")}
    ${link("faq", `${L.home}#faq`, "faq")}
  </nav>
  <div class="tnav__cta">
    ${btn("sign in", L.route("/signin"), "muted", ' data-hide="phone"')}
    ${btn("open loft · free", L.app, "dark")}
  </div>
</header>`;
}

export function footer(L) {
  return `<footer class="tfoot">
  <span>loft · by tanzir rahman · tanziro.com/loft</span>
  <span class="tfoot__rule" aria-hidden="true"></span>
  <nav aria-label="Footer"><a href="https://tanziro.com/tack">tack</a><a href="${L.home}#privacy">privacy</a><a href="${L.home}#terms">terms</a><a href="https://github.com/tanzir71/loft">github</a><a href="${L.home}milestones/">milestones</a></nav>
</footer>`;
}

// ---------------------------------------------------------------- landing

const FEATURES = [
  {
    id: "rooms", n: "01", tag: "rooms", img: ["f01-rooms.webp", 680, 425], alt: "A live room: a worksheet PDF on the board with named cursors, the share popover and a guest waiting to join.",
    title: "Open a room. Anyone joins with a link.",
    body: "A board, chat and audio in one tab. Share the link anywhere, and clients, teammates or students join from a phone without making an account.",
    bullets: ["live cursors with names, so you see who is writing where", "follow-me and lock keep everyone on your page", "guest join on: they walk in. off: you let each one in", "your own Meet or Zoom link still works as a fallback"],
    flowLabel: "workflow", flow: "start room → copy link → paste in WhatsApp → guest taps it → you tap let in → same page, same voice",
    note: "vs Meet: Meet shares your screen. loft shares the page, and everyone can write on it."
  },
  {
    id: "diagrams", n: "02", tag: "diagrams", img: ["f02-diagrams.webp", 680, 500], alt: "Diagram as code: a few typed lines on the left become a laid-out flowchart with connectors on the right.",
    title: "Draw it by hand. Or type it.",
    body: "A whiteboard that behaves like a diagram tool. Flowchart shapes, connectors that snap and re-route, sections and sticky notes. Or type a few lines and get a tidy diagram you can still drag around.",
    bullets: ["connectors snap to shapes and follow them when moved: straight, elbow or curved", "smoothed pen strokes; a rough box or circle becomes a clean shape", "diagram as code for flowcharts, sequence diagrams, ERDs and swimlanes", "workshop kit: dot voting, hide-and-reveal, shared timer, cursor chat"],
    flowLabel: "how it works", flow: "sketch or type → auto-layout → tidy up → present or export as PNG / PDF",
    note: "it all runs in your browser: no plugin, nothing to install, nothing extra on the server."
  },
  {
    id: "files", n: "03", tag: "files", img: ["f03-files.webp", 680, 430], alt: "A dropped PDF becomes board pages, handed out so each person works on a private copy.",
    title: "Drop a file. Give everyone their own copy.",
    body: "PDFs, photos and slide decks become pages on the board. Your browser does the converting, so it runs on a $3 host and phones only load light images.",
    bullets: ["PDFs and photos turn into pages you can mark up", "paste a public Google Slides or Docs link to import it", "hand out: everyone gets a private copy, you see them all", "the marked-up board is saved as a PDF in the space's files"],
    flowLabel: "workflow", flow: "drop brief.pdf → pages appear → hand out → each person works on a copy → copies come back to you",
    note: "vs Miro: a great board. loft's board knows who is in the space and turns the page into follow-up work."
  },
  {
    id: "calls", n: "04", tag: "calls", img: ["f04-calls.webp", 680, 400], alt: "Call controls: peer-to-peer audio, stage mode with raised hands and a 60-second turn.",
    title: "Audio that costs nothing. Video when it earns it.",
    body: "Calls are built in and audio comes first. Up to 6 people talk peer-to-peer for free. Groups of up to 12 use stage mode: one person speaks, the rest raise a hand.",
    bullets: ["peer-to-peer audio for up to 6 talking, free", "stage mode: hands up, the host gives a 60-second turn", "bigger event? use your Zoom or Meet link for the call", "a daily budget steps video down to audio, never cuts a session"],
    flowLabel: "workflow", flow: "hand up → host taps let them speak → 60 s on the floor → mic goes back",
    note: "vs Zoom: Zoom is a call with a whiteboard attached. loft is a workspace with a call attached."
  },
  {
    id: "hallway", n: "05", tag: "hallway", img: ["f05-hallway.webp", 680, 425], alt: "The hallway: live rooms, spaces as channels and direct messages with presence and a Knock button.",
    title: "See who's around. Pull them into a room.",
    body: "A Slack-style side panel shows live rooms, your spaces as channels, and direct messages with who is online. Talking and working happen in the same place.",
    bullets: ["live rooms with one-click join, or start a new one", "knock on anyone who is free; they land on your board", "room invites arrive as cards in the chat", "clients and guests chat free, only in their own spaces"],
    flowLabel: "workflow", flow: "Leena is free → knock → she taps join → you're both on the board, audio on",
    note: "vs Slack: Slack is where work gets talked about. In loft the talk sits next to the board, the session and the bill."
  },
  {
    id: "spaces", n: "06", tag: "spaces", img: ["f06-spaces.webp", 680, 425], alt: "A space stream with an automatic recap post, a must-read post with acknowledgements and a task.",
    title: "A stream people actually read.",
    body: "Every space, whether a client, a class or a team, gets familiar tabs: Stream, Chat, Work, Files, People and Progress. The difference is what lands in the stream on its own.",
    bullets: ["recaps post themselves after each session, with the board as a PDF", "must-acknowledge posts show exactly who hasn't seen them", "files sorted by topic, with who opened what", "tasks, quizzes and sign-offs, joined with a code or link"],
    flowLabel: "workflow", flow: "end session → recap, board PDF and follow-ups post to the stream → everyone in the space sees it",
    note: "vs Google Classroom: Classroom stops at the assignment. loft also runs the live session and sends the invoice."
  },
  {
    id: "agendas", n: "07", tag: "agendas", img: ["f07-agendas.webp", 680, 425], alt: "A session plan with timed blocks and a pacing bar, attached to Thursday's session.",
    title: "Write the agenda once. It runs the session.",
    body: "A plan has timed sections. In the room they become the agenda timer, the pages on the board, the hand-outs, the closing check and the follow-up work.",
    bullets: ["a pacing bar shows where the hour goes", "attach a plan to a session and the room is ready", "templates for lessons, sprints, retros and client reviews", "optional AI with your own key drafts the first version"],
    flowLabel: "workflow", flow: "agenda → attach to Monday 16:00 → start room → timer, pages and hand-outs are already there",
    note: "vs docs and AI planners: they write good plans. loft's plan becomes the live agenda, the board and the follow-up."
  },
  {
    id: "money", n: "08", tag: "money", img: ["f08-money.webp", 680, 425], alt: "An invoice where every line links to the session recap it pays for, with the host's payment link attached.",
    title: "Invoices that explain themselves.",
    body: "loft counts the sessions that happened and drafts the invoice. Every line links to its recap, and your payment link is attached for you, so you never paste it again.",
    bullets: ["one default link, a link per payer, or a {amount} template", "per session, monthly, packages, retainers and fixed fees", "payers tap “I've paid” and you confirm with one tap", "reminders 3 days before and after the due date, in USD"],
    flowLabel: "workflow", flow: "session ends → line added → invoice on the 1st → client pays with your link → taps I've paid → you confirm → receipt",
    note: "vs invoicing apps: they bill well but never see the work. loft's invoice shows what each line paid for."
  },
  {
    id: "insights", n: "09", tag: "insights", img: ["f09-insights.webp", 680, 425], alt: "Insights: last seen, attendance and payments per person, with people at risk at the top and a nudge button.",
    title: "Know who is drifting before they leave.",
    body: "Last seen, last login, attendance, open tasks and payments for everyone in a space, with the people at risk at the top and a nudge one tap away.",
    bullets: ["reminders go out 24 hours before something is due", "missed two sessions? the right person hears about it", "write a custom nudge to a group and schedule it", "in-app and push first, email or a WhatsApp link as backup"],
    flowLabel: "workflow", flow: "3 haven't replied → custom nudge → Friday 18:00 → 2 respond by Saturday",
    note: "vs spreadsheets: a sheet tells you who paid. loft tells you who is drifting and lets you act on it."
  },
  {
    id: "checks", n: "10", tag: "checks", img: ["f10-checks.webp", 680, 425], alt: "A quick check attempt with an event timeline: a tab switch at 04:12 and an integrity score to review.",
    title: "Quick checks with integrity signals. No webcam.",
    body: "Quizzes, polls and sign-off checks grade themselves. For checks that matter, a 6 KB script records tab switches, pasting and leaving fullscreen, and gives you a score to review, not a verdict.",
    bullets: ["multiple choice, true/false and short answers, auto-graded", "time limits and attempts enforced on the server", "an event timeline per attempt, flagged for a human look", "no camera, no microphone, nothing to install"],
    flowLabel: "workflow", flow: "switches tab at 04:12 → event logged → score 78 → you review the timeline",
    note: "vs proctoring suites: they watch the person. loft watches the browser, and leaves the judgement to you."
  },
  {
    id: "phones", n: "11", tag: "phones", img: ["f11-phones.webp", 680, 470], alt: "Loft on a phone: audio-only room following the host's page, and a client paying an invoice.",
    title: "Built for a phone on patchy data.",
    body: "People join from a phone, audio-only if the network is weak. Pages arrive as light images, the app installs from the browser, and every screen works one-handed.",
    bullets: ["one link to join, no app store, installs as an app", "audio-only mode for slow connections", "raise a hand, follow the page, keep private notes", "clients pay and check progress from the same phone"],
    flowLabel: "workflow", flow: "tap the link → audio connects → follow the board → raise a hand",
    note: "vs Meet on a phone: a shared screen is too small to read. loft sends the page itself, so it fits."
  }
];

function feature(L, f, i, extra = "") {
  const flip = i % 2 === 1;
  return `<section class="feat${flip ? " feat--flip" : ""}" id="${f.id}" aria-labelledby="feat-${f.id}">
  <div class="feat__copy">
    ${eyebrow(`${f.n} · ${f.tag}`)}
    <h2 id="feat-${f.id}" class="h2">${esc(f.title)}</h2>
    <p class="body">${esc(f.body)}</p>
    <ul class="bullets" role="list">${f.bullets.map((b) => `<li>${mk()}${esc(b)}</li>`).join("")}</ul>
    ${f.flow ? `<div class="flow"><span class="flow__label">${esc(f.flowLabel)}</span><p>${esc(f.flow)}</p></div>` : ""}
    ${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}
    ${extra}
  </div>
  <figure class="feat__visual">${img(L, ...f.img, f.alt)}</figure>
</section>`;
}

function agents() {
  const steps = [
    {
      n: "01", t: "Give it one link", b: "Paste the agent link and one line into Claude Code, Codex or any agent that can read a URL.",
      v: `<div class="av av--link"><span class="av__url">${icon("link", { size: 12 })}tanziro.com/spaces/a/9k2m…x7</span><span class="av__prompt">&gt; Get things ready through this link, top to bottom.</span><span class="av__scope"><span>scope</span><b>Acme pricing sprint</b></span></div>`
    },
    {
      n: "02", t: "It claims the prep", b: "Tasks you queue, like 'plan Thursday' or 'turn this PDF into a board', get claimed one by one.",
      v: `<div class="av"><span class="av__task">${mk()}<span><b>Agenda for Thu 15:00</b><small>claude · claimed</small></span></span><span class="av__task">${mk("accent")}<span><b>Board from the brief</b><small>codex · working</small></span></span><span class="av__task">${mk("muted")}<span><b>5-question check</b><small>— · queued</small></span></span></div>`
    },
    {
      n: "03", t: "It drafts in the room", b: "Plans, board pages, shapes, connectors and checks appear as dashed drafts while you watch.",
      v: `<div class="av"><div class="av__board"><span class="d1">Map</span><span class="d2">Decide</span><span class="d3">Storyboard<i>draft · by claude</i></span>${icon("mouse-pointer-2", { size: 14, cls: "av__cursor" })}</div></div>`
    },
    {
      n: "04", t: "You approve, then run it", b: "Accept everything, keep some, or reply with changes. Nothing goes to your group until you say so.",
      v: `<div class="av"><div class="av__review"><b>6 drafts ready for you</b><span>${icon("circle-check", { size: 11 })}Agenda · 5 blocks</span><span>${icon("circle-check", { size: 11 })}Board · 3 sections</span><span>${icon("circle-check", { size: 11 })}Check · 5 questions</span><span class="av__btns"><i class="dark">accept all</i><i>ask for changes</i></span></div></div>`
    }
  ];
  const rails = ["drafts only", "can't send, invite or charge", "asks when stuck, then moves on", "no audio, no seat taken", "link expires in 30 days", "revoke any agent in one tap"];
  return `<section class="agents" id="agents" aria-labelledby="agents-title">
  <div class="agents__head">
    ${chip("new · agents get the room ready")}
    <h2 id="agents-title" class="h2 h2--xl">Let Claude or Codex do the prep. <br>You run the room.</h2>
    <p class="lead">Give your agent one link. It picks up the prep for your next session, builds plans, boards and checks as drafts, and asks you when it's stuck. You approve what you like and walk in ready.</p>
  </div>
  <ol class="steps" role="list">${steps
    .map((s) => `<li class="step"><span class="step__n">${s.n}</span><h3>${esc(s.t)}</h3><p>${esc(s.b)}</p>${s.v}</li>`)
    .join("")}</ol>
  <ul class="rails" role="list">${rails.map((r) => `<li>${mk()}${esc(r)}</li>`).join("")}</ul>
</section>`;
}

function hero(L) {
  return `<section class="hero" aria-labelledby="hero-title">
  <div class="hero__copy">
    ${chip("built for small teams · up to 12 people per room")}
    <h1 id="hero-title">Plan the session. Run the room. <br>Get paid without chasing.</h1>
    <p class="lead">loft is a free workspace for small teams who run things live: client calls, workshops, classes and team meetings. A shared board that opens your files, chat with whoever is online, built-in audio, a space for every group, and invoices where every line links to the session it pays for.</p>
    <div class="quick" data-start="${L.route("/r/new")}" data-join="${L.route("/join")}">
      <form class="quick__col" id="q-start">
        <p class="quick__label">${mk()}start a room</p>
        <div class="quick__row">
          <label class="sr-only" for="q-name">Room name (optional)</label>
          <input id="q-name" name="name" class="tinput" placeholder="name it (optional)" autocomplete="off" maxlength="60">
          <button class="tbtn tbtn--dark" type="submit">${mk("white")}start · free</button>
        </div>
        <label class="toggle"><input type="checkbox" name="guests" checked><span class="toggle__track" aria-hidden="true"></span>guests join without approval</label>
        <p class="quick__note">no account needed. you get a link to share; sign up later to keep the room.</p>
      </form>
      <form class="quick__col" id="q-join">
        <p class="quick__label">${mk("accent")}join one</p>
        <div class="quick__row">
          <label class="sr-only" for="q-code">Room code or link</label>
          <input id="q-code" name="code" class="tinput" placeholder="code or link · K7P-42Q" autocomplete="off" required>
          <button class="tbtn tbtn--muted" type="submit">${mk()}join</button>
        </div>
        <p class="quick__hint"><label for="q-you">your name</label><input id="q-you" name="you" class="tinput tinput--inline" placeholder="· asked once, remembered on this device" autocomplete="name" maxlength="40"></p>
        <p class="quick__note">if the host turned guests off, they'll be asked to let you in.</p>
      </form>
    </div>
    <p class="hero__links"><a href="${L.route("/signin")}">have an account? sign in to your spaces →</a><span aria-hidden="true">·</span><span class="muted">tanziro.com/spaces</span></p>
    <p class="fine">no credit card · up to 12 people per room · guests join with a link</p>
  </div>
  <figure class="hero__visual">${img(L, "hero.webp", 1312, 886, "loft on desktop: Home with today's sessions, spaces and the side panel, plus a client paying an invoice on a phone.", true)}</figure>
</section>`;
}

function oneTab() {
  const items = ["meet links", "whiteboards", "slack threads", "shared drives", "spreadsheets", "invoice apps"];
  return `<section class="onetab" aria-label="What loft replaces"><span class="onetab__label">one tab instead of</span>${items.map((i) => `<span>${i}</span>`).join("")}</section>`;
}

function principles() {
  const items = [
    ["plus", "Free", "Every host, member and guest. Organisations pay only to put their own brand on it."],
    ["server", "Small on purpose", "Rooms hold up to 12 people and calls work best with up to 6 talking. Staying small is what keeps loft fast and free on simple hosting."],
    ["zap", "Optional everything", "Calls, email, AI and payment links are switches in the dashboard. It works with all of them off."],
    ["layers", "Calm", "A side panel for people and rooms, one card per space, and a board with chat tucked away."]
  ];
  return `<section class="principles" aria-labelledby="principles-title">
  <h2 id="principles-title" class="h2 center">Built like a tool you own</h2>
  <ul class="cards4" role="list">${items.map(([ic, t, b]) => `<li class="pcard">${icon(ic, { size: 20 })}<h3>${t}</h3><p>${b}</p></li>`).join("")}</ul>
</section>`;
}

function orgBand(L) {
  return feature(
    L,
    {
      id: "organisations", n: "", tag: "", img: ["orgs-band.webp", 680, 440], alt: "The same pay page before and after branding: free with loft branding, and branded for Aurelian.",
      title: "Put your name on every screen.",
      body: "loft stays free. A branded plan swaps in your logo, colours and name everywhere people see it, so members and payers only ever see you.",
      bullets: ["your own link: tanziro.com/spaces/your-name", "sign-in, room links and the side panel in your colours", "invoices, receipts and certificates on your letterhead", "emails and WhatsApp messages sent in your name"],
      flow: "", note: ""
    },
    0,
    btn("see branded plans →", L.orgs, "muted")
  ).replace(`<p class="eyebrow">${mk()} · </p>`, eyebrow("for schools & organisations"));
}

const COMPARE_COLS = ["loft", "classroom", "slack", "zoom", "miro", "billing apps"];
// y = yes, p = partly (paid tier, add-on or workaround), n = no
const COMPARE = [
  ["Shared board that opens your PDFs and slides", "ynnpyn"],
  ["Flowcharts with connectors that snap and re-route", "ynnpyn"],
  ["Type a diagram as text: flowcharts, sequences, ERDs", "ynnnpn"],
  ["Workshop kit: dot voting, timer, hide-and-reveal", "ynnpyn"],
  ["Guests join from a link, no account", "ynpypn"],
  ["Calls built in, free for small groups", "yppppn"],
  ["Chat with whoever is online, rooms one click away", "ynypnn"],
  ["Stream, files and must-acknowledge posts", "yppnnn"],
  ["An agenda that runs the live session", "ynnnpn"],
  ["Invoices linked to sessions, with your own pay link", "ynnnnp"],
  ["Activity insights and nudges", "ypppnp"],
  ["Free for every host, member and guest", "ynnnnn"]
];

function compare() {
  const cell = (v, i) =>
    v === "y" ? `<td><span class="yes${i === 0 ? " yes--loft" : ""}" role="img" aria-label="yes"></span></td>` : v === "p" ? `<td class="partly">partly</td>` : `<td class="no"><span aria-label="no">—</span></td>`;
  return `<section class="compare" aria-labelledby="compare-title">
  <h2 id="compare-title" class="h2 center">How loft is different</h2>
  <p class="lead center">Most tools do one of these well. loft puts them in one place for small teams, shared by hosts, members and guests.</p>
  <div class="ctable" tabindex="0" role="region" aria-label="Comparison table">
    <table>
      <thead><tr><th scope="col"><span class="sr-only">Feature</span></th>${COMPARE_COLS.map((c, i) => `<th scope="col"${i === 0 ? ' class="is-loft"' : ""}>${c}</th>`).join("")}</tr></thead>
      <tbody>${COMPARE.map(([label, vals]) => `<tr><th scope="row">${esc(label)}</th>${[...vals].map(cell).join("")}</tr>`).join("")}</tbody>
    </table>
  </div>
  <p class="fine center"><span class="yes yes--key" aria-hidden="true"></span> yes &nbsp; partly = paid tier, add-on or workaround &nbsp; — = no. &nbsp; Based on each product's public feature pages, Nov 2026.</p>
</section>`;
}

const FAQ = [
  ["Is it really free?", "Yes, for every host, member and guest. Schools and organisations pay only if they want their own logo, colours and name on it."],
  ["Do I still need Zoom or Meet?", "No. Audio is built in and free for small groups. Keep your own link as a fallback, or switch on video when you need it."],
  ["Can people join without an account?", "Yes, from a link. Turn guest join off and you'll be asked to let each person in."],
  ["How do I get paid?", "Through your own payment link: Stripe, PayPal, Wise or any URL. loft never touches the money; it drafts the invoice and keeps track."],
  ["Where is my data?", "At tanziro.com/spaces, in one database on our server. Export everything any time."],
  ["What can I run on it?", "Client calls, workshops, classes, coaching and team rituals. Each space picks a mode, which only changes the labels and templates."],
  ["How many people can join?", "Up to 12 in a room at once, and calls are smoothest with up to 6 talking. loft is made for small teams and small groups, not webinars."],
  ["What if a session is bigger?", "Use your Zoom or Meet link for the call and keep loft for the board, the plan and the invoice. Organisations can also add their own video provider."]
];

function faq() {
  return `<section class="faq" id="faq" aria-labelledby="faq-title">
  <h2 id="faq-title" class="h2">Questions</h2>
  <ul class="faq__grid" role="list">${FAQ.map(([q, a]) => `<li class="qcard"><h3>${esc(q)}</h3><p>${esc(a)}</p></li>`).join("")}</ul>
</section>`;
}

function cta(L) {
  return `<section class="cta-wrap" aria-labelledby="cta-title">
  <div class="cta">
    <span class="cta__brand">loft<span aria-hidden="true"></span></span>
    <h2 id="cta-title">Open your first room.</h2>
    <p>Free at tanziro.com/spaces for small teams: up to 12 people per room. No card, no setup.</p>
    <div class="cta__actions">${btn("open loft", L.app, "card")}<a class="cta__link" href="${L.orgs}">for organisations →</a></div>
  </div>
</section>`;
}

export function renderLanding(L) {
  return `${nav(L)}
<main id="main">
<div class="dotgrid" aria-hidden="true"></div>
${hero(L)}
${agents()}
${oneTab()}
${FEATURES.map((f, i) => feature(L, f, i)).join("\n")}
${principles()}
${orgBand(L)}
${compare()}
${faq()}
${cta(L)}
</main>
${footer(L)}`;
}

// ---------------------------------------------------------------- organisations

const ORG_FEATURES = [
  {
    id: "identity", n: "01", tag: "identity", img: ["orgs-f01-identity.webp", 680, 425], alt: "Brand studio: upload a logo, pick one colour, and loft builds an accessible palette with contrast checks.",
    title: "Your logo and colours, checked for you.",
    body: "Upload a logo and pick a colour. loft generates the tints, checks text contrast, and applies it to every screen, email and printable document.",
    bullets: ["one colour in, a full accessible palette out", "the side panel, buttons and room chrome take your colour", "contrast is checked before anything goes live", "preview as a client or member before you publish"],
    flowLabel: "how it works", flow: "upload logo + pick colour → preview as a member → publish once branding is on",
    note: "the look changes; the product doesn't. hosts keep every feature they had."
  },
  {
    id: "link", n: "02", tag: "your link", img: ["orgs-f02-link.webp", 680, 440], alt: "Aurelian's branded sign-in page at tanziro.com/spaces/aurelian.",
    title: "One link that opens your loft.",
    body: "Your organisation gets its own address on loft. Anyone who opens it sees your sign-in page, your colours and your name.",
    bullets: ["tanziro.com/spaces/your-name, chosen by your admin", "room links and invites carry your name and colours", "rename it any time; the old link forwards", "nothing to install and nothing to configure"],
    flowLabel: "how it works", flow: "branding switched on → admin picks the name → share the link",
    note: "custom domains aren't offered. your link lives on tanziro.com, so there's no DNS or certificate to manage."
  },
  {
    id: "documents", n: "03", tag: "documents", img: ["orgs-f03-documents.webp", 680, 520], alt: "An invoice and a certificate on Aurelian's letterhead, with a verify link.",
    title: "Paperwork in your name.",
    body: "Invoices, receipts, certificates and progress reports carry your letterhead, and every certificate has a verify link on your page.",
    bullets: ["invoices and receipts on your letterhead", "certificates with an ID anyone can verify", "progress reports for clients and sponsors", "board exports with your header and footer"],
    flowLabel: "how it works", flow: "session ends → report or certificate generated → emailed with your name → verified on your page",
    note: "documents print at A4 or Letter; save as PDF from any browser."
  }
];

const MAIL = "hello@tanziro.com";
const mailto = (org = "<organisation>") =>
  `mailto:${MAIL}?subject=${encodeURIComponent(`Branded loft for ${org}`)}&body=${encodeURIComponent(
    "Organisation · website · country:\nPeople using loft (rough):\nMonthly or yearly:\nEmail of your loft admin (so we switch on the right account):\n"
  )}`;

function orgWhatChanges() {
  const rows = [
    ["rooms, board, files, calls, chat", true, true],
    ["plans, invoices, insights, quick checks", true, true],
    ["your logo, colours and name on every screen", false, true],
    ["your own link: tanziro.com/spaces/your-name", false, true],
    ["letterhead on invoices, receipts, certificates, reports", false, true],
    ["emails show your name; replies come to you", false, true],
    ["no loft badge on pages members and payers see", false, true]
  ];
  const c = (v) => (v ? `<td><span class="sq" role="img" aria-label="included">■</span></td>` : `<td class="no"><span aria-label="not included">—</span></td>`);
  return `<section class="block" id="what-changes" aria-labelledby="wc-title">
  <div class="block__head">${eyebrow("what changes")}<h2 id="wc-title" class="h2">Free loft vs. branded loft</h2><p class="body">Branding changes what people see. It never takes features away from anyone.</p></div>
  <div class="wtable"><table><thead><tr><th scope="col"><span class="sr-only">Feature</span></th><th scope="col">free</th><th scope="col">branded</th></tr></thead>
  <tbody>${rows.map(([l, a, b]) => `<tr><th scope="row">${esc(l)}</th>${c(a)}${c(b)}</tr>`).join("")}</tbody></table></div>
</section>`;
}

function orgBuying() {
  const steps = [
    ["01", "email us", "Your organisation, roughly how many people use loft, and the email of your loft admin. The button opens a filled-in email."],
    ["02", "get an invoice", "In USD, payable by card link or bank transfer. Monthly or yearly."],
    ["03", "branding is switched on", "When the payment arrives. Your admins get an email saying it's live."],
    ["04", "make it yours", "Your admin uploads the logo, picks a colour and chooses your link in Brand studio. Preview, then publish."]
  ];
  return `<section class="block block--card" id="buying" aria-labelledby="buy-title">
  <div class="block__head">${eyebrow("how buying works")}<h2 id="buy-title" class="h2">It starts with an email, not a checkout.</h2><p class="body">No card form and no trial clock. Pay an invoice, and branding is switched on for your account.</p></div>
  <ol class="buy" role="list">${steps.map(([n, t, b]) => `<li><span class="step__n">${n}</span><h3>${t}</h3><p>${b}</p></li>`).join("")}</ol>
  <p class="callout">${mk()}Brand studio is open to every admin for free. Set everything up and preview it before you even email us.</p>
  <div class="mailbox">
    <span class="flow__label">what the button opens</span>
    <pre>mailto:${MAIL}?subject=Branded loft for &lt;organisation&gt;

Organisation · website · country
People using loft (rough)
Monthly or yearly
Email of your loft admin (so we switch on the right account)</pre>
    <p class="note">the same fields also work as a plain form below, for people without a mail app.</p>
  </div>
  <form class="contact" id="contact" data-mail="${MAIL}" data-endpoint="/spaces/api/v1/contact" aria-labelledby="contact-title">
    <h3 id="contact-title">Or send the form</h3>
    <div class="contact__grid">
      <label>Organisation<input class="tinput" name="organisation" required maxlength="120" autocomplete="organization"></label>
      <label>Website<input class="tinput" name="website" maxlength="200" inputmode="url" placeholder="https://"></label>
      <label>Country<input class="tinput" name="country" maxlength="60" autocomplete="country-name"></label>
      <label>People using loft (rough)<input class="tinput" name="people" inputmode="numeric" maxlength="10"></label>
      <label>Monthly or yearly<select class="tinput" name="period"><option>monthly</option><option>yearly</option></select></label>
      <label>Email of your loft admin<input class="tinput" type="email" name="admin_email" required maxlength="200" autocomplete="email"></label>
    </div>
    <div class="contact__actions"><button class="tbtn tbtn--dark" type="submit">${mk("white")}send</button><span class="contact__status" role="status" aria-live="polite"></span></div>
  </form>
</section>`;
}

function orgPlans() {
  const perks = ["logo, colours and name everywhere", "your link on tanziro.com", "letterhead documents", "emails with your name", "switch off any time; nothing is deleted"];
  const plan = (dark, size, price, who) => `<li class="plan${dark ? " plan--dark" : ""}">
    <span class="plan__size">${size}</span>
    <p class="plan__price"><b>${price}</b><span>/ month</span></p>
    <p class="plan__who">${who}</p>
    <ul role="list">${perks.map((p) => `<li>${mk(dark ? "glow" : "")}${p}</li>`).join("")}</ul>
    <a class="tbtn tbtn--${dark ? "white" : "dark"}" href="${mailto()}">${mk(dark ? "dark" : "white")}email us</a>
    <span class="plan__note">yearly: 2 months free</span>
  </li>`;
  return `<section class="block" id="plans" aria-labelledby="plans-title">
  <div class="block__head">${eyebrow("plans")}<h2 id="plans-title" class="h2">One branded plan, priced by size.</h2><p class="body">Same features at both sizes. Prices in USD, invoiced by email.</p></div>
  <ul class="plans" role="list">${plan(false, "up to 300 active members", "$29", "coaching practices, studios, small teams")}${plan(true, "more than 300 active members", "$99", "firms, schools and larger organisations")}</ul>
  <p class="fine">active member = joined at least one session in the last 30 days. on every plan, rooms hold up to 12 people at once: loft is built for small teams.</p>
</section>`;
}

function orgFaq() {
  const qs = [
    ["Why email instead of a checkout?", "There's no billing system to sign up for. You get a normal invoice, pay it, and branding is switched on."],
    ["Can we see it before paying?", "Yes. Any admin can set up the brand in Brand studio and preview it. It goes live once branding is switched on."],
    ["Can we use our own domain?", "No. Your branded link is tanziro.com/spaces/your-name. It needs no setup from anyone."],
    ["Can we pay by bank transfer?", "Yes. The invoice has a card payment link and bank details, in USD."],
    ["What if we stop paying?", "Admins see a reminder before the paid period ends, then get 14 days' grace. After that your spaces return to the standard look. Nothing is deleted."],
    ["Do you take a cut of what our hosts invoice?", "No. Invoices use the hosts' own payment links. loft never touches the money."]
  ];
  return `<section class="block block--card" id="faq" aria-labelledby="ofaq-title">
  <div class="block__head">${eyebrow("questions")}<h2 id="ofaq-title" class="h2">Before you email</h2></div>
  <dl class="ofaq">${qs.map(([q, a]) => `<div><dt>${esc(q)}</dt><dd>${esc(a)}</dd></div>`).join("")}</dl>
</section>`;
}

export function renderOrganisations(L) {
  return `${nav(L, "orgs")}
<main id="main">
<section class="hero hero--orgs" aria-labelledby="hero-title">
  <div class="hero__copy">
    ${chip("for coaches, firms, schools and organisations")}
    <h1 id="hero-title">Your name on every screen. <br>loft stays free for everyone.</h1>
    <p class="lead">A branded space puts your logo, colours and name everywhere people see it: sign-in, rooms, invoices, certificates and reports. Your hosts, members and payers keep using everything for free.</p>
    <div class="hero__actions">${btn("email us to brand loft", mailto(), "dark")}${btn("see what changes", "#what-changes", "muted")}</div>
    <p class="fine">no checkout · we reply with an invoice · branding goes live when it's paid</p>
  </div>
  <figure class="hero__visual">${img(L, "orgs-hero.webp", 1312, 886, "loft branded as Aurelian, a premium coaching practice: Home on desktop and a pay page on a phone.", true)}</figure>
</section>
${ORG_FEATURES.map((f, i) => feature(L, f, i)).join("\n")}
${orgWhatChanges()}
${orgBuying()}
${orgPlans()}
${orgFaq()}
<section class="cta-wrap" aria-labelledby="cta-title">
  <div class="cta cta--left">
    <h2 id="cta-title">Put your name on loft.</h2>
    <p>Email us your organisation's name and roughly how many people use loft. We'll reply with an invoice.</p>
    <div class="cta__actions">${btn(`email ${MAIL}`, mailto(), "white")}<a class="cta__link" href="${L.app}">keep using free loft</a></div>
  </div>
</section>
</main>
${footer(L)}`;
}
