// Cloudflare Realtime SFU client (video tier, M11). One RTCPeerConnection to Cloudflare per person: you
// publish your camera as a local track and pull other people's cameras as remote tracks. Every negotiation
// goes through Loft's server (rooms/:id/video/cf), which adds the org's app token, so no key reaches the
// browser. Negotiations run one at a time (an SDP exchange must finish before the next one starts).

export interface CfTrack { location?: "local" | "remote"; mid?: string | null; trackName: string; sessionId?: string; errorCode?: string; errorDescription?: string }
export interface CfResponse { sessionDescription?: { type: RTCSdpType; sdp: string }; tracks?: CfTrack[]; requiresImmediateRenegotiation?: boolean; errorCode?: string; errorDescription?: string }
export type CfOp = "tracks/new" | "renegotiate" | "tracks/close";
export type CfRelay = (op: CfOp, body: Record<string, unknown>) => Promise<CfResponse>;

export interface RemoteTrack { key: string; sessionId: string; trackName: string; mid: string; stream: MediaStream }

interface Options {
  makePc?: (config: RTCConfiguration) => RTCPeerConnection;
  makeStream?: (tracks: MediaStreamTrack[]) => MediaStream;
}

function check(res: CfResponse): CfResponse {
  if (res.errorCode) throw new Error(res.errorDescription || res.errorCode);
  return res;
}

export class CloudflareSfu {
  readonly pc: RTCPeerConnection;
  /** Pulled tracks by key `${sessionId}/${trackName}`. */
  readonly remotes = new Map<string, RemoteTrack>();
  onChange: () => void = () => {};
  private queue: Promise<unknown> = Promise.resolve();
  private byMid = new Map<string, { key: string; sessionId: string; trackName: string }>();
  private makeStream: (tracks: MediaStreamTrack[]) => MediaStream;

  constructor(private relay: CfRelay, iceServers: RTCIceServer[], o: Options = {}) {
    this.makeStream = o.makeStream ?? ((t) => new MediaStream(t));
    this.pc = (o.makePc ?? ((c) => new RTCPeerConnection(c)))({ iceServers, bundlePolicy: "max-bundle" });
    this.pc.addEventListener("track", (e) => {
      const mid = e.transceiver?.mid;
      const info = mid ? this.byMid.get(mid) : undefined;
      if (!mid || !info) return;
      this.remotes.set(info.key, { ...info, mid, stream: this.makeStream([e.track]) });
      this.onChange();
    });
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Publish local tracks (sendonly); returns their track names, which other people pull. */
  publish(tracks: MediaStreamTrack[]): Promise<string[]> {
    if (!tracks.length) return Promise.resolve([]);
    return this.run(async () => {
      const trs = tracks.map((t) => this.pc.addTransceiver(t, { direction: "sendonly" }));
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const res = check(await this.relay("tracks/new", { sessionDescription: { type: "offer", sdp: offer.sdp }, tracks: trs.map((tr) => ({ location: "local", mid: tr.mid, trackName: tr.sender.track!.id })) }));
      if (!res.sessionDescription) throw new Error("Cloudflare sent no answer");
      await this.pc.setRemoteDescription(res.sessionDescription);
      const failed = (res.tracks ?? []).find((t) => t.errorCode);
      if (failed) throw new Error(failed.errorDescription || failed.errorCode);
      return trs.map((tr) => tr.sender.track!.id);
    });
  }

  /** Resolves once the connection to Cloudflare is up (Cloudflare's guidance: connect before pulling). */
  connected(timeoutMs = 8000): Promise<void> {
    const ok = () => this.pc.iceConnectionState === "connected" || this.pc.iceConnectionState === "completed";
    if (ok()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pc.removeEventListener("iceconnectionstatechange", on); reject(new Error("Couldn't connect to the video server")); }, timeoutMs);
      const on = () => {
        if (!ok()) return;
        clearTimeout(t);
        this.pc.removeEventListener("iceconnectionstatechange", on);
        resolve();
      };
      this.pc.addEventListener("iceconnectionstatechange", on);
    });
  }

  /** Pull someone's tracks; Cloudflare may send an offer we answer (renegotiate). */
  pull(sessionId: string, trackNames: string[]): Promise<void> {
    const known = new Set([...this.byMid.values()].map((v) => v.key));
    const wanted = trackNames.filter((n) => !known.has(`${sessionId}/${n}`));
    if (!wanted.length) return Promise.resolve();
    return this.run(async () => {
      const res = check(await this.relay("tracks/new", { tracks: wanted.map((trackName) => ({ location: "remote", sessionId, trackName })) }));
      for (const t of res.tracks ?? []) if (t.mid && !t.errorCode) this.byMid.set(t.mid, { key: `${sessionId}/${t.trackName}`, sessionId, trackName: t.trackName });
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await this.pc.setRemoteDescription(res.sessionDescription);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        check(await this.relay("renegotiate", { sessionDescription: { type: "answer", sdp: answer.sdp } }));
      }
    });
  }

  /** Stop pulling someone (they left or stopped video). */
  drop(sessionId: string): Promise<void> {
    const mids = [...this.byMid].filter(([, v]) => v.sessionId === sessionId).map(([mid]) => mid);
    if (!mids.length) return Promise.resolve();
    for (const mid of mids) {
      const key = this.byMid.get(mid)!.key;
      this.byMid.delete(mid);
      this.remotes.delete(key);
    }
    this.onChange();
    return this.run(async () => {
      await this.relay("tracks/close", { tracks: mids.map((mid) => ({ mid })), force: true }).catch(() => {});
      for (const tr of this.pc.getTransceivers()) if (tr.mid && mids.includes(tr.mid)) tr.stop();
    });
  }

  /** The sessions we pull from right now. */
  pulling(): Set<string> {
    return new Set([...this.byMid.values()].map((v) => v.sessionId));
  }

  close(): void {
    this.pc.close();
    this.remotes.clear();
    this.byMid.clear();
  }
}
