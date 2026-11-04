import Link from "next/link";
import { Hand } from "lucide-react";

import { BackendStatus } from "@/components/backend-status";
import { DEV_TOOLS_ENABLED } from "@/lib/config";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Hand className="size-4" aria-hidden="true" />
            </span>
            <span>
              SignBridge <span className="text-primary">AI</span>
            </span>
          </Link>
          {DEV_TOOLS_ENABLED && (
            <nav aria-label="Main" className="flex gap-4 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">Translate</Link>
              <Link href="/training" className="hover:text-foreground">Training</Link>
            </nav>
          )}
        </div>
        <BackendStatus />
      </div>
    </header>
  );
}
