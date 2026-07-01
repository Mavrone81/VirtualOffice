"use client";

import { useRef, useEffect, useCallback } from "react";

/**
 * Lightweight canvas signature pad (no deps). Emits a PNG data URL on every
 * stroke end, or null when cleared. Works with mouse, touch and pen via
 * pointer events; hi-dpi aware.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);

  const ctxOf = () => canvasRef.current!.getContext("2d")!;

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1f2b";
  }, []);

  useEffect(() => {
    setup();
    window.addEventListener("resize", setup);
    return () => window.removeEventListener("resize", setup);
  }, [setup]);

  function point(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent) {
    drawing.current = true;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const { x, y } = point(e);
    const ctx = ctxOf();
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = point(e);
    const ctx = ctxOf();
    ctx.lineTo(x, y);
    ctx.stroke();
    inked.current = true;
  }

  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    if (inked.current) onChange(canvasRef.current!.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current!;
    ctxOf().clearRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
    onChange(null);
  }

  return (
    <div>
      <div className="relative rounded-lg border border-line bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          className="h-40 w-full touch-none rounded-lg"
          style={{ touchAction: "none" }}
        />
        <span className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-2">Sign above</span>
      </div>
      <button type="button" onClick={clear} className="mt-2 text-[12px] text-action hover:underline">
        Clear signature
      </button>
    </div>
  );
}
