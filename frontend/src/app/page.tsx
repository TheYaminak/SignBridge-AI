import { Info, Lock } from "lucide-react";

import { DeveloperTools } from "@/components/dev/developer-tools";
import { SiteHeader } from "@/components/site-header";
import { TranslationWorkspace } from "@/components/workspace/translation-workspace";
import { DEV_TOOLS_ENABLED } from "@/lib/config";

export default function Home() {
  return (
    <>
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to workspace
      </a>
      <SiteHeader />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-80 max-w-3xl rounded-full bg-primary/20 blur-3xl"
          />
          <div className="relative mx-auto max-w-7xl px-4 py-14 text-center sm:px-6 sm:py-20">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Every Gesture Deserves a{" "}
              <span className="bg-linear-to-r from-primary to-sky-400 bg-clip-text text-transparent">
                Voice.
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
              Breaking communication barriers through computer vision and
              artificial intelligence.
            </p>
          </div>
        </section>

        <section
          id="workspace"
          aria-label="Translation workspace"
          tabIndex={-1}
          className="mx-auto max-w-7xl px-4 py-8 outline-none sm:px-6 sm:py-10"
        >
          <TranslationWorkspace />
        </section>

        {DEV_TOOLS_ENABLED && <DeveloperTools />}
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" />
            Camera video stays in your browser. Nothing is recorded or uploaded.
          </p>
          <p className="flex items-center gap-1.5">
            <Info className="size-3.5" aria-hidden="true" />
            Recognizes a limited vocabulary of signs. Not a replacement for a
            qualified interpreter.
          </p>
        </div>
      </footer>
    </>
  );
}
