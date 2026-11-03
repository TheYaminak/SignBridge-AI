"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;
const getServerSupported = () => false;

/** Thin wrapper around the browser SpeechSynthesis API. */
export function useSpeechSynthesis() {
  const supported = useSyncExternalStore(
    subscribe,
    getSupported,
    getServerSupported,
  );
  const [speaking, setSpeaking] = useState(false);

  const cancel = useCallback(() => {
    if (!getSupported()) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, lang: string) => {
    if (!getSupported() || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    return () => {
      if (getSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  return { supported, speaking, speak, cancel };
}
