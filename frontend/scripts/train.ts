/**
 * Offline training CLI. Uses exactly the same preprocessing, classifier, and
 * evaluation code as the /training page.
 *
 *   npm run train -- path/to/signbridge-dataset.json [--out public/models/sign-classifier.json] [--seed 42]
 */
import { readFileSync, writeFileSync } from "node:fs";

import { validateDataset } from "../src/lib/signs/dataset";
import { formatReport, trainAndEvaluate } from "../src/lib/signs/evaluate";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const input = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!input) {
  console.error("Usage: npm run train -- <dataset.json> [--out public/models/sign-classifier.json] [--seed 42]");
  process.exit(2);
}
const out = opt("--out", "public/models/sign-classifier.json");
const seed = Number(opt("--seed", "42"));

const v = validateDataset(JSON.parse(readFileSync(input, "utf8")));
for (const e of v.errors) console.error(`invalid: ${e}`);
if (v.samples.length === 0) {
  console.error("No valid samples; nothing to train.");
  process.exit(1);
}
console.log(`Loaded ${v.samples.length} valid samples from ${input}${v.errors.length ? ` (${v.errors.length} skipped)` : ""}.\n`);

const report = trainAndEvaluate(v.samples, { seed });
console.log(formatReport(report));
writeFileSync(out, JSON.stringify(report.model));
console.log(`\nSaved model to ${out}`);
