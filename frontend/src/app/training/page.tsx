import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { TrainingStudio } from "@/components/training/training-studio";
import { DEV_TOOLS_ENABLED } from "@/lib/config";

export const metadata: Metadata = {
  title: "Training data — SignBridge AI",
};

/** Development-only page for recording landmark samples and training the classifier. */
export default function TrainingPage() {
  if (!DEV_TOOLS_ENABLED) notFound();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Training data</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Record your own examples of each communication intent while following the Dominican Sign Language (LSRD)
            dictionary. Samples contain MediaPipe hand landmarks only and stay in this browser until you export them.
          </p>
        </div>
        <TrainingStudio />
      </main>
    </>
  );
}
