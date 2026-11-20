import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DoorOpen, Play } from "lucide-react";
import { Button, Sheet } from "@loft/ui";
import { normaliseCode } from "@loft/core";

/** The "+" action: start a room now, or join one with a code. */
export function StartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const join = () => {
    const c = normaliseCode(code);
    if (!c) return;
    onClose();
    nav(`/join?code=${encodeURIComponent(c)}`);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Start or join a room">
      <h2 className="t-display-m" style={{ marginBottom: 4 }}>Start or join</h2>
      <p className="t-body-s" style={{ color: "var(--color-muted-fg)", marginBottom: 16 }}>
        Rooms hold 12 people. Guests join with your link or a code.
      </p>
      <Button
        block
        icon={<Play aria-hidden="true" />}
        onClick={() => {
          onClose();
          nav("/r/new");
        }}
      >
        Start a room now
      </Button>
      <form
        className="start-join"
        onSubmit={(e) => {
          e.preventDefault();
          join();
        }}
      >
        <label htmlFor="join-code" className="t-label">Join with a code</label>
        <div className="start-join__row">
          <input id="join-code" className="field field--mono" placeholder="abc-def-ghk" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <Button type="submit" variant="secondary" icon={<DoorOpen aria-hidden="true" />}>Join</Button>
        </div>
      </form>
    </Sheet>
  );
}
