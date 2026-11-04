"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { pickVoice } from "@/lib/languages";

const subscribe = () => () => {};
const getSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;
const getServerSupported = () => false;

export interface SpeakOptions {
  onEnd?: () => void;
  onError?: (message: string) => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "The browser blocked audio. Click anywhere on the page (or Replay) to allow speech.",
  "audio-busy": "The audio device is busy.",
  "language-unavailable": "No voice is installed for this language.",
  "voice-unavailable": "The selected voice is unavailable.",
  network: "The speech service is unreachable.",
  "synthesis-failed": "Speech synthesis failed.",
};

/**
 * Wrapper around the browser SpeechSynthesis API: picks a voice for the
 * language (es-DO first for Spanish, en-US for English), never overlaps
 * utterances, and reports errors instead of failing silently.
 */
export function useSpeechSynthesis() {
  const supported = useSyncExternalStore(subscribe, getSupported, getServerSupported);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceLabel, setVoiceLabel] = useState<string | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  // Incremented on every speak/cancel so callbacks of stale utterances are ignored.
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!getSupported()) return;
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);

  const cancel = useCallback(() => {
    tokenRef.current += 1;
    if (getSupported()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, lang: string, opts: SpeakOptions = {}) => {
    if (!getSupported()) {
      const msg = "Speech synthesis is not supported in this browser.";
      setError(msg);
      opts.onError?.(msg);
      return;
    }
    if (!text.trim()) return;
    // Never overlap: stop whatever is playing first.
    window.speechSynthesis.cancel();
    const token = ++tokenRef.current;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(voicesRef.current, lang);
    utterance.lang = voice?.lang ?? lang;
    if (voice) utterance.voice = voice;
    setVoiceLabel(voice ? `${voice.name} (${voice.lang})` : `default (${lang})`);
    setError(null);
    utterance.onstart = () => token === tokenRef.current && setSpeaking(true);
    utterance.onend = () => {
      if (token !== tokenRef.current) return;
      setSpeaking(false);
      opts.onEnd?.();
    };
    utterance.onerror = (e) => {
      if (token !== tokenRef.current) return;
      setSpeaking(false);
      // "interrupted"/"canceled" are our own cancel() calls, not failures.
      if (e.error === "interrupted" || e.error === "canceled") {
        opts.onEnd?.();
        return;
      }
      const msg = ERROR_MESSAGES[e.error] ?? `Speech error: ${e.error}`;
      setError(msg);
      opts.onError?.(msg);
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  return { supported, speaking, error, voiceLabel, speak, cancel };
}
