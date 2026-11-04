import type { Connection } from "./hand-tracker";
import type { FrameObservation } from "./types";

const HAND_COLORS = ["#2dd4bf", "#38bdf8"];

/**
 * Draws hand skeletons in raw video coordinates. The canvas is sized to the
 * video's intrinsic resolution and shares its CSS (object-cover + mirror), so
 * the overlay lines up with the mirrored preview without flipping math here.
 */
export function drawHands(
  ctx: CanvasRenderingContext2D,
  frame: FrameObservation,
  connections: Connection[],
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const scale = Math.max(width, height) / 640;

  frame.hands.forEach((hand, i) => {
    const color = HAND_COLORS[i % HAND_COLORS.length];
    const pts = hand.landmarks;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const { start, end } of connections) {
      const a = pts[start];
      const b = pts[end];
      if (!a || !b) continue;
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
    }
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1.5 * scale;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 3.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
}

export function clearCanvas(canvas: HTMLCanvasElement | null): void {
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}
