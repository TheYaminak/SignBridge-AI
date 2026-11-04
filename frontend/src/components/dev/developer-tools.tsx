import { Wrench } from "lucide-react";

import { ManualInterpretationTest } from "@/components/dev/manual-interpretation-test";
import { MetaConnectionPanel } from "@/components/dev/meta-connection-panel";

/** Development-only diagnostics. Rendered only when DEV_TOOLS_ENABLED. */
export function DeveloperTools() {
  return (
    <section
      aria-labelledby="dev-tools-heading"
      className="mx-auto max-w-7xl px-4 pb-10 sm:px-6"
    >
      <div className="rounded-2xl border border-dashed border-warning/40 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Wrench className="size-4 text-warning" aria-hidden="true" />
          <h2 id="dev-tools-heading" className="font-semibold">
            Developer tools
          </h2>
          <span className="text-xs text-muted-foreground">
            Development only. Hidden in production builds.
          </span>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <MetaConnectionPanel />
          <ManualInterpretationTest />
        </div>
      </div>
    </section>
  );
}
