// Copies the MediaPipe Tasks Vision WASM runtime from node_modules into
// public/ so the browser loads it from our own origin (no CDN at runtime).
// Runs automatically before `dev` and `build`, so the files always match the
// installed @mediapipe/tasks-vision version, including inside Docker.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(root, "public", "mediapipe", "wasm");

// Only the non-module build is used (FilesetResolver.forVisionTasks(base, false)).
const files = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];

mkdirSync(dest, { recursive: true });
for (const file of files) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log(`mediapipe: copied ${files.length} WASM files to public/mediapipe/wasm`);
