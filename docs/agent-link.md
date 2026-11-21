# Agent link · capabilities v1

The host gives an agent **one link and one line**:

```
https://<your-domain>/spaces/a/<token>
Get things ready through this link, top to bottom.
```

That's the whole prompt. The first thing the agent reads (`next.md`) lists what it can do, so nobody has to explain the API. Plain HTTPS and JSON, no WebSockets or SSE, so it works on shared hosting. Any agent that can fetch a URL can use it: Claude Code, Codex, or your own script.

**Agents create drafts only.** They can't send messages, email or WhatsApp, send or confirm invoices, invite people, change branding, or read payer contact details and DMs.

## Scope and lifetime

| | |
|---|---|
| Scope | `workspace` (every space), `space` (one space) or `room` (one room's session) |
| Expiry | 30 days; the host can make a new link at any time (the old token stops working) |
| Pause | The host can pause all agents; claims return `paused: true` and drafts get `423` until resumed |

## Seats

The first request from an agent creates a **seat** from its `User-Agent` (for example `codex-cli/0.9`) and an optional `X-Agent-Name` header (for example `planner`).

- On a **workspace** link a new seat waits for the host to **Approve** it; until then every call except reading `next.md` returns `403`.
- On a **space** or **room** link new seats are approved straight away.
- The host can rename or **revoke** a seat. A revoked seat gets `403` immediately and its claimed tasks go back to the queue.
- Each seat may make **60 requests a minute** (token bucket). Over the limit: `429` with a retry time.
- Agents never take one of the 12 room seats, and at most **2 agents** work in one room.

## Endpoints

All paths are relative to the link, `/spaces/a/<token>`. Bodies and responses are JSON unless noted.

| Method | Path | What it does |
|---|---|---|
| GET | `/` | `next.md` (text/markdown): capabilities, rules, the next task, the queue, and drafts the host sent back with reasons |
| GET | `/next.json` | the same as structured JSON |
| POST | `/claim` | claims the next queued task (oldest "ready by" first) → `{ task: { id, template, title, brief, attachments, readyBy, session, feedback, done_when, context: ["/context/<id>"] } }`, or `{ task: null }`, or `{ paused: true }` |
| GET | `/context/<id>` | read-only context for a claimed task: the space, its plans, the last 3 recaps, file names, and where the board's first page is. **Redacted:** no emails, phone numbers, tokens or DMs |
| POST | `/drafts` | `{ taskId, kind, title, sub, payload }` where `kind` is `plan` (`{ title, minutes, blocks[] }`), `board_ops` (`{ ops[] }`, at most 500 per batch), `post` (`{ title, body }`), `check` (`{ title, questions[] }`) or `invoice_draft` (`{ note }`). Invalid drafts get `422` |
| POST | `/files` | upload a file (≤ 20 MB) to attach to drafts (PHP server only) |
| POST | `/report` | `{ taskId, status: "progress" \| "done" \| "blocker", note, minutes }`. `done` puts the task in the host's **Ready for you**; `blocker` puts it in **Needs you** |
| POST | `/ask` | `{ taskId, question, options[] }`: a question for the host (shows in **Needs you**). The agent moves on to the next task; the answer comes back as the task's `feedback` |
| GET | `/changes?since=<iso>` | what changed since: answers, accepts, rejects (with reasons), "ask for changes", pause |

Errors are `{ "error": "…", "status": <code> }` with the same HTTP status.

## Drafts and the board

- Every write is a **draft** row (`kind`, `payload`, `status`). Nothing reaches members until the host accepts it.
- Board drafts are op batches applied to a **draft layer** in the room that only hosts see: dashed outlines and "draft by <agent>" on sections, a named activity panel, "Review N drafts", and **Pause agents**.
- **Accept** re-issues the ops into the room's main op-log as the host (the draft flag is dropped). Plans attach to the session; posts go to the stream; checks arrive as check drafts the host publishes; invoice drafts are built in Money and are never sent.
- **Reject** deletes the draft and records the reason, which the agent sees in its next `next.md` ("Sent back by the host").
- **Ask for changes** puts the task back in the queue with the host's note as `feedback`.
- During a live session agent edits wait on the draft layer unless the host turns on "Let agents edit during live sessions".

## Prep tasks

Hosts queue tasks per space (Prep tab) from templates: agenda for a session, board from a brief or PDF, N-question check, recap from today's board, client-call agenda from the last 3 recaps, invoice drafts with anomalies flagged. Each task has a brief, optional attachments, a "ready by" time, and optionally a specific seat.

## Agent time

`report.minutes` is stored per seat and shown on Agents ("Agent time this week") and per task. It is recorded separately from the host's time and **never billed to clients**.

## A minimal agent

```sh
LINK=https://example.com/spaces/a/<token>
H='-H "User-Agent: my-agent/1.0" -H "X-Agent-Name: helper" -H "Content-Type: application/json"'
curl -s $LINK                                  # read next.md
curl -s -X POST $LINK/claim -H "User-Agent: my-agent/1.0"   # claim a task
curl -s $LINK/context/<taskId> -H "User-Agent: my-agent/1.0"
curl -s -X POST $LINK/drafts -H "User-Agent: my-agent/1.0" -H "Content-Type: application/json" \
  -d '{"taskId":"<taskId>","kind":"post","title":"Recap","payload":{"title":"Recap","body":"What we covered…"}}'
curl -s -X POST $LINK/report -H "User-Agent: my-agent/1.0" -H "Content-Type: application/json" \
  -d '{"taskId":"<taskId>","status":"done","note":"Drafted the recap.","minutes":4}'
```

## On the GitHub Pages preview

The preview has no server, so real agents can't reach a link there. The Agents page has **Run the demo agent**: a scripted agent (`apps/web/src/lib/demoAgent.ts`) that calls the same endpoints inside the browser's local adapter (read → claim → context → drafts → report), so the whole flow can be tried. The PHP server (M10) serves the real endpoints at `/spaces/a/<token>` with the same rules.
