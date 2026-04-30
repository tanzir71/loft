import { useEffect, useState } from "react";
import { Whiteboard, type Tool } from "@/components/whiteboard/Whiteboard";
import { Toolbar } from "@/components/whiteboard/Toolbar";
import { ChatOverlay } from "@/components/whiteboard/ChatOverlay";
import { TopBar } from "@/components/whiteboard/TopBar";

const Index = () => {
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#1a1d2e");
  const [size, setSize] = useState(4);
  const [clearSignal, setClearSignal] = useState(0);
  const [exportSignal, setExportSignal] = useState(0);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "p" || e.key === "P") setTool("pen");
      if (e.key === "e" || e.key === "E") setTool("eraser");
      if (e.key === "t" || e.key === "T") setTool("text");
      if (e.key === "s" || e.key === "S") setTool("sticky");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden canvas-bg">
      {/* Dot grid layer */}
      <div className="pointer-events-none absolute inset-0 dot-grid opacity-70" />

      {/* SEO H1 (visually hidden but present) */}
      <h1 className="sr-only">
        WhiteboardChat — collaborative whiteboard with live chat overlay
      </h1>

      {/* Drawing surface — full bleed */}
      <Whiteboard
        tool={tool}
        color={color}
        size={size}
        clearSignal={clearSignal}
        exportSignal={exportSignal}
      />

      {/* Floating chrome */}
      <TopBar />
      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        size={size}
        setSize={setSize}
        onClear={() => setClearSignal((n) => n + 1)}
        onExport={() => setExportSignal((n) => n + 1)}
      />
      <ChatOverlay />
    </main>
  );
};

export default Index;
