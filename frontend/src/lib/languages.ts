export const OUTPUT_LANGUAGES = [
  { value: "en", label: "English", speechLang: "en-US" },
  { value: "es", label: "Español", speechLang: "es-DO" },
] as const;

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number]["value"];

export function speechLangFor(language: OutputLanguage): string {
  return (
    OUTPUT_LANGUAGES.find((l) => l.value === language)?.speechLang ?? language
  );
}

/**
 * Voice preferences, most preferred first: Dominican Spanish, then other
 * Spanish variants; US English, then any English. The last entry is the
 * bare language prefix, which matches any remaining voice of that language.
 */
const VOICE_PREFERENCES: Record<string, string[]> = {
  es: ["es-DO", "es-US", "es-419", "es-MX", "es-ES", "es"],
  en: ["en-US", "en-GB", "en"],
};

/** Picks the best installed voice for a BCP 47 tag like "es-DO" or "en-US". */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const base = lang.toLowerCase().split("-")[0];
  const prefs = VOICE_PREFERENCES[base] ?? [lang, base];
  const norm = (tag: string) => tag.toLowerCase().replace("_", "-");
  for (const pref of prefs.map(norm)) {
    const match = voices.find((v) => (pref.includes("-") ? norm(v.lang) === pref : norm(v.lang).split("-")[0] === pref));
    if (match) return match;
  }
  return null;
}
