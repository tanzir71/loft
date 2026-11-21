import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { transformWithEsbuild } from "vite";

// The Cloudflare SFU client (apps/web/src/room/calls/sfu.ts) against a loopback stand-in for Cloudflare
// Realtime, with real WebRTC in Chromium. Each fake "SFU session" is an RTCPeerConnection that follows
// Cloudflare's documented flow: tracks/new with local tracks → it answers the offer; tracks/new with
// remote tracks → it offers them (requiresImmediateRenegotiation) and the client answers via renegotiate;
// tracks/close stops them. Two people publish fake cameras and see each other's frames.
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["camera"] });

test.describe("video · Cloudflare SFU client (M11)", () => {
  test.skip(({ browserName, viewport }) => browserName !== "chromium" || (viewport?.width ?? 0) < 768, "WebRTC loop runs on desktop Chromium");

  test("publish cameras, pull each other's, frames arrive; dropping someone closes their track", async ({ page }) => {
    const src = readFileSync(fileURLToPath(new URL("../apps/web/src/room/calls/sfu.ts", import.meta.url)), "utf8");
    const { code } = await transformWithEsbuild(src, "sfu.ts", { format: "iife", globalName: "LoftSfu", target: "es2022" });
    await page.goto("./app/");
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async () => {
      type Body = Record<string, unknown>;
      const w = window as unknown as { LoftSfu: { CloudflareSfu: new (relay: (op: string, body: Body) => Promise<unknown>, ice: RTCIceServer[]) => {
        publish(t: MediaStreamTrack[]): Promise<string[]>; pull(s: string, n: string[]): Promise<void>; drop(s: string): Promise<void>; connected(ms?: number): Promise<void>;
        remotes: Map<string, { stream: MediaStream; sessionId: string }>; onChange: () => void; pulling(): Set<string>;
      } } };
      const gathered = (pc: RTCPeerConnection) => (pc.iceGatheringState === "complete" ? Promise.resolve() : new Promise<void>((r) => pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && r())));
      // --- the stand-in for Cloudflare Realtime ---
      const sessions = new Map<string, { pc: RTCPeerConnection; published: Map<string, MediaStreamTrack> }>();
      const log: string[] = [];
      const fakeCloudflare = (sessionId: string) => async (op: string, body: Body) => {
        const me = sessions.get(sessionId)!;
        log.push(`${sessionId}:${op}`);
        const tracks = (body.tracks ?? []) as { location?: string; mid?: string; trackName: string; sessionId?: string }[];
        if (op === "tracks/new" && body.sessionDescription) {
          await me.pc.setRemoteDescription(body.sessionDescription as RTCSessionDescriptionInit);
          for (const t of tracks) {
            const tr = me.pc.getTransceivers().find((x) => x.mid === t.mid);
            if (tr) me.published.set(t.trackName, tr.receiver.track);
          }
          await me.pc.setLocalDescription(await me.pc.createAnswer());
          await gathered(me.pc);
          return { sessionDescription: { type: "answer", sdp: me.pc.localDescription!.sdp }, tracks: tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) };
        }
        if (op === "tracks/new") {
          const out = [];
          for (const t of tracks) {
            const track = sessions.get(t.sessionId!)?.published.get(t.trackName);
            if (!track) return { errorCode: "not_found", errorDescription: `No track ${t.trackName}` };
            const tr = me.pc.addTransceiver(track, { direction: "sendonly" });
            out.push({ tr, t });
          }
          await me.pc.setLocalDescription(await me.pc.createOffer());
          await gathered(me.pc);
          return { requiresImmediateRenegotiation: true, sessionDescription: { type: "offer", sdp: me.pc.localDescription!.sdp }, tracks: out.map(({ tr, t }) => ({ mid: tr.mid, trackName: t.trackName, sessionId: t.sessionId })) };
        }
        if (op === "renegotiate") {
          await me.pc.setRemoteDescription(body.sessionDescription as RTCSessionDescriptionInit);
          return {};
        }
        if (op === "tracks/close") {
          for (const { mid } of tracks as { mid: string }[]) me.pc.getTransceivers().find((x) => x.mid === mid)?.stop();
          return { tracks: tracks.map((t) => ({ mid: t.mid })) };
        }
        return { errorCode: "bad_op" };
      };
      const join = (sessionId: string) => {
        sessions.set(sessionId, { pc: new RTCPeerConnection({ bundlePolicy: "max-bundle" }), published: new Map() });
        return new w.LoftSfu.CloudflareSfu(fakeCloudflare(sessionId), []);
      };
      // --- two people ---
      const a = join("sess-a");
      const b = join("sess-b");
      const camA = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 } });
      const camB = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 } });
      const [nameA] = await a.publish(camA.getVideoTracks());
      const [nameB] = await b.publish(camB.getVideoTracks());
      await Promise.all([a.connected(8000), b.connected(8000)]);
      await Promise.all([b.pull("sess-a", [nameA!]), a.pull("sess-b", [nameB!])]);
      const frames = async (stream: MediaStream | undefined) => {
        if (!stream) return 0;
        const v = document.createElement("video");
        v.muted = true;
        v.srcObject = stream;
        document.body.append(v);
        await v.play().catch(() => {});
        for (let i = 0; i < 50 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
        return v.videoWidth;
      };
      const seenByB = await frames(b.remotes.get(`sess-a/${nameA}`)?.stream);
      const seenByA = await frames(a.remotes.get(`sess-b/${nameB}`)?.stream);
      await b.drop("sess-a");
      return { seenByB, seenByA, bStillPulls: [...b.pulling()], bTiles: b.remotes.size, log };
    });
    expect(result.seenByB, "B sees A's camera").toBeGreaterThan(0);
    expect(result.seenByA, "A sees B's camera").toBeGreaterThan(0);
    expect(result.bStillPulls).toEqual([]);
    expect(result.bTiles).toBe(0);
    expect(result.log).toEqual(expect.arrayContaining(["sess-a:tracks/new", "sess-b:tracks/new", "sess-b:renegotiate", "sess-a:renegotiate", "sess-b:tracks/close"]));
  });
});
