export const OUTPUT_LANGUAGES = [
  { value: "en", label: "English", speechLang: "en-US" },
  { value: "es", label: "Español", speechLang: "es-ES" },
] as const;

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number]["value"];

export function speechLangFor(language: OutputLanguage): string {
  return (
    OUTPUT_LANGUAGES.find((l) => l.value === language)?.speechLang ?? language
  );
}
