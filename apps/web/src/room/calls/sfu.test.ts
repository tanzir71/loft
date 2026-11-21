import { describe, expect, it } from "vitest";
import { CloudflareSfu, type CfOp, type CfResponse } from "./sfu";

// A stand-in RTCPeerConnection: enough of the API to check what the SFU client sends and when.
class FakePc extends EventTarget {
  iceConnectionState: RTCIceConnectionState = "new";
  transceivers: { mid: string | null; sender: { track: { id: string } }; direction: string; stopped: boolean; stop(): void }[] = [];
  log: string[] = [];
  addTransceiver(track: { id: string }, init: { direction: string }) {
    const tr = { mid: null as string | null, sender: { track }, direction: init.direction, stopped: false, stop() { this.stopped = true; } };
    this.transceivers.push(tr);
    return tr;
  }
  getTransceivers() { return this.transceivers; }
  async createOffer() { this.log.push("createOffer"); return { type: "offer", sdp: "v=0 local-offer" }; }
  async createAnswer() { this.log.push("createAnswer"); return { type: "answer", sdp: "v=0 local-answer" }; }
  async setLocalDescription(d: { type: string }) {
    this.log.push(`setLocal:${d.type}`);
    this.transceivers.forEach((t, i) => { if (t.mid === null) t.mid = String(i); });
  }
  async setRemoteDescription(d: { type: string; sdp: string }) { this.log.push(`setRemote:${d.type}`); }
  connect() { this.iceConnectionState = "connected"; this.dispatchEvent(new Event("iceconnectionstatechange")); }
  deliver(mid: string, trackId: string) {
    const e = new Event("track") as Event & { transceiver: { mid: string }; track: { id: string } };
    Object.assign(e, { transceiver: { mid }, track: { id: trackId } });
    this.dispatchEvent(e);
  }
  close() { this.log.push("close"); }
}

function setup(answers: Partial<Record<CfOp, (body: Record<string, unknown>) => CfResponse>>) {
  const calls: { op: CfOp; body: Record<string, unknown> }[] = [];
  let pc!: FakePc;
  const sfu = new CloudflareSfu(
    async (op, body) => {
      calls.push({ op, body });
      await new Promise((r) => setTimeout(r, 1));
      return answers[op]?.(body) ?? {};
    },
    [{ urls: "stun:stun.cloudflare.com:3478" }],
    { makePc: (c) => { pc = new FakePc(); pc.log.push(`config:${c.bundlePolicy}`); return pc as unknown as RTCPeerConnection; }, makeStream: (t) => ({ id: `stream-${t[0]!.id}` }) as unknown as MediaStream }
  );
  return { sfu, calls, pc: () => pc };
}

describe("Cloudflare SFU client", () => {
  it("publishes the camera: sendonly transceiver, offer with mids and track names, then Cloudflare's answer", async () => {
    const { sfu, calls, pc } = setup({ "tracks/new": () => ({ sessionDescription: { type: "answer", sdp: "v=0 cf-answer" }, tracks: [{ mid: "0", trackName: "cam-1" }] }) });
    const names = await sfu.publish([{ id: "cam-1", kind: "video" } as unknown as MediaStreamTrack]);
    expect(names).toEqual(["cam-1"]);
    expect(calls).toEqual([{ op: "tracks/new", body: { sessionDescription: { type: "offer", sdp: "v=0 local-offer" }, tracks: [{ location: "local", mid: "0", trackName: "cam-1" }] } }]);
    expect(pc().transceivers[0]!.direction).toBe("sendonly");
    expect(pc().log).toEqual(["config:max-bundle", "createOffer", "setLocal:offer", "setRemote:answer"]);
  });

  it("pulls someone's camera, answers Cloudflare's offer, and maps the arriving track to that person", async () => {
    const { sfu, calls, pc } = setup({
      "tracks/new": () => ({ requiresImmediateRenegotiation: true, sessionDescription: { type: "offer", sdp: "v=0 cf-offer" }, tracks: [{ mid: "4", trackName: "cam-a", sessionId: "sess-a" }] }),
      renegotiate: () => ({})
    });
    let changes = 0;
    sfu.onChange = () => changes++;
    await sfu.pull("sess-a", ["cam-a"]);
    expect(calls.map((c) => c.op)).toEqual(["tracks/new", "renegotiate"]);
    expect(calls[0]!.body).toEqual({ tracks: [{ location: "remote", sessionId: "sess-a", trackName: "cam-a" }] });
    expect(calls[1]!.body).toEqual({ sessionDescription: { type: "answer", sdp: "v=0 local-answer" } });
    expect(pc().log.slice(1)).toEqual(["setRemote:offer", "createAnswer", "setLocal:answer"]);
    pc().deliver("4", "remote-cam");
    expect(sfu.remotes.get("sess-a/cam-a")).toMatchObject({ sessionId: "sess-a", trackName: "cam-a", mid: "4", stream: { id: "stream-remote-cam" } });
    expect(changes).toBe(1);
    // Pulling the same track again does nothing.
    await sfu.pull("sess-a", ["cam-a"]);
    expect(calls).toHaveLength(2);
    expect([...sfu.pulling()]).toEqual(["sess-a"]);
  });

  it("runs one negotiation at a time even when pulls arrive together", async () => {
    let n = 0;
    const order: string[] = [];
    const { sfu } = setup({
      "tracks/new": (b) => {
        const s = (b.tracks as { sessionId: string }[])[0]!.sessionId;
        order.push(`start:${s}`);
        return { requiresImmediateRenegotiation: true, sessionDescription: { type: "offer", sdp: "x" }, tracks: [{ mid: String(++n), trackName: "cam", sessionId: s }] };
      },
      renegotiate: () => { order.push("renegotiate"); return {}; }
    });
    await Promise.all([sfu.pull("sess-a", ["cam"]), sfu.pull("sess-b", ["cam"]), sfu.pull("sess-c", ["cam"])]);
    expect(order).toEqual(["start:sess-a", "renegotiate", "start:sess-b", "renegotiate", "start:sess-c", "renegotiate"]);
  });

  it("drops someone who left: their tile goes at once, then the tracks are closed and transceivers stopped", async () => {
    const { sfu, calls, pc } = setup({ "tracks/new": () => ({ requiresImmediateRenegotiation: true, sessionDescription: { type: "offer", sdp: "x" }, tracks: [{ mid: "0", trackName: "cam-a" }] }), renegotiate: () => ({}), "tracks/close": () => ({}) });
    await sfu.pull("sess-a", ["cam-a"]);
    pc().transceivers.push({ mid: "0", sender: { track: { id: "r" } }, direction: "recvonly", stopped: false, stop() { this.stopped = true; } });
    pc().deliver("0", "remote-cam");
    expect(sfu.remotes.size).toBe(1);
    const p = sfu.drop("sess-a");
    expect(sfu.remotes.size).toBe(0);
    await p;
    expect(calls.at(-1)).toEqual({ op: "tracks/close", body: { tracks: [{ mid: "0" }], force: true } });
    expect(pc().transceivers.find((t) => t.mid === "0")!.stopped).toBe(true);
    expect(sfu.pulling().size).toBe(0);
  });

  it("surfaces Cloudflare errors and keeps later negotiations working", async () => {
    let fail = true;
    const { sfu } = setup({ "tracks/new": () => (fail ? { errorCode: "invalid_request", errorDescription: "Track not found" } : { tracks: [] }) });
    await expect(sfu.pull("sess-a", ["gone"])).rejects.toThrow("Track not found");
    fail = false;
    await expect(sfu.pull("sess-b", ["cam"])).resolves.toBeUndefined();
  });

  it("waits for the connection before pulling, with a timeout", async () => {
    const { sfu, pc } = setup({});
    const ready = sfu.connected(1000);
    pc().connect();
    await expect(ready).resolves.toBeUndefined();
    const { sfu: other } = setup({});
    await expect(other.connected(5)).rejects.toThrow("Couldn't connect");
  });
});
