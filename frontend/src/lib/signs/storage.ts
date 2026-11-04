"use client";

import { isSignModel, type SignModel } from "./knn";
import type { Sample } from "./types";

/**
 * Local browser storage (IndexedDB) for landmark samples and the active
 * model. Nothing here leaves the device unless the user exports it.
 */
const DB_NAME = "signbridge";
const DB_VERSION = 1;
const SAMPLES = "samples";
const MODELS = "models";
const ACTIVE_MODEL_KEY = "active";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAMPLES)) db.createObjectStore(SAMPLES, { keyPath: "sample_id" });
      if (!db.objectStoreNames.contains(MODELS)) db.createObjectStore(MODELS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = run(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function listSamples(): Promise<Sample[]> {
  const all = (await tx<Sample[]>(SAMPLES, "readonly", (s) => s.getAll())) ?? [];
  return all.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

export async function putSamples(samples: Sample[]): Promise<void> {
  await tx(SAMPLES, "readwrite", (s) => {
    for (const sample of samples) s.put(sample);
  });
}

export async function deleteSample(id: string): Promise<void> {
  await tx(SAMPLES, "readwrite", (s) => s.delete(id));
}

export async function clearSamples(): Promise<void> {
  await tx(SAMPLES, "readwrite", (s) => s.clear());
}

export async function saveActiveModel(model: SignModel): Promise<void> {
  await tx(MODELS, "readwrite", (s) => s.put(model, ACTIVE_MODEL_KEY));
}

export async function loadActiveModel(): Promise<SignModel | null> {
  const m = await tx<unknown>(MODELS, "readonly", (s) => s.get(ACTIVE_MODEL_KEY));
  return isSignModel(m) ? m : null;
}

export async function clearActiveModel(): Promise<void> {
  await tx(MODELS, "readwrite", (s) => s.delete(ACTIVE_MODEL_KEY));
}

/** Triggers a local file download (no upload). */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
