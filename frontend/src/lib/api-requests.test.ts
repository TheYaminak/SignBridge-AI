/**
 * Contract regression: the frontend request builders must produce exactly the
 * shared fixtures that the Go handler tests accept (contracts/fixtures).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildGestureInterpretRequest, buildIntentRequest, buildManualInterpretRequest } from "./api-requests";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contracts", "fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("API contract fixtures", () => {
  it("gesture interpretation", () => {
    const f = fixture("interpret-gesture.request.json");
    assert.deepEqual(buildGestureInterpretRequest(f.signs, f.language), f);
  });

  it("manual interpretation", () => {
    const f = fixture("interpret-manual.request.json");
    assert.deepEqual(buildManualInterpretRequest(f.signs, f.language), f);
  });

  it("custom sign intent", () => {
    const f = fixture("intent-interpret.request.json");
    assert.deepEqual(
      buildIntentRequest({ intent: f.intent, confidence: f.confidence, language: f.language, modelId: f.model_id }),
      f,
    );
  });
});
