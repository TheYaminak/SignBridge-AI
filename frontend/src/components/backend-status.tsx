"use client";

import { RefreshCw } from "lucide-react";

import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { API_BASE_URL } from "@/lib/config";

const LABELS = {
  checking: "Checking backend…",
  online: "Backend online",
  offline: "Backend offline",
} as const;

export function BackendStatus() {
  const { status, error, retry } = useBackendHealth();

  return (
    <div className="flex items-center gap-2">
      <div
        role="status"
        aria-live="polite"
        title={error ?? API_BASE_URL}
        className="flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs font-medium"
      >
        <StatusDot
          tone={
            status === "online"
              ? "success"
              : status === "offline"
                ? "danger"
                : "warning"
          }
          pulse={status === "checking"}
        />
        <span>{LABELS[status]}</span>
      </div>
      {status === "offline" && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={retry}
          aria-label="Retry backend connection"
        >
          <RefreshCw />
        </Button>
      )}
    </div>
  );
}
