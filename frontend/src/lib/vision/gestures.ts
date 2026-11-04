/**
 * MediaPipe Gesture Recognizer's built-in categories. These are generic hand
 * gestures, not sign-language words.
 */
export const SUPPORTED_GESTURES = [
  "Open_Palm",
  "Closed_Fist",
  "Thumb_Up",
  "Thumb_Down",
  "Victory",
  "Pointing_Up",
  "ILoveYou",
] as const;

export type GestureLabel = (typeof SUPPORTED_GESTURES)[number];

/** MediaPipe reports "None" when a hand is visible but matches no gesture. */
export const NO_GESTURE = "None";

const DISPLAY_NAMES: Record<GestureLabel, string> = {
  Open_Palm: "Open palm",
  Closed_Fist: "Closed fist",
  Thumb_Up: "Thumb up",
  Thumb_Down: "Thumb down",
  Victory: "Victory",
  Pointing_Up: "Pointing up",
  ILoveYou: "I-love-you hand shape",
};

const EMOJI: Record<GestureLabel, string> = {
  Open_Palm: "✋",
  Closed_Fist: "✊",
  Thumb_Up: "👍",
  Thumb_Down: "👎",
  Victory: "✌️",
  Pointing_Up: "☝️",
  ILoveYou: "🤟",
};

export function isSupportedGesture(label: string): label is GestureLabel {
  return (SUPPORTED_GESTURES as readonly string[]).includes(label);
}

export function gestureDisplayName(label: string): string {
  return isSupportedGesture(label) ? DISPLAY_NAMES[label] : label;
}

export function gestureEmoji(label: string): string {
  return isSupportedGesture(label) ? EMOJI[label] : "";
}
