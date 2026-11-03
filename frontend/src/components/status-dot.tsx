import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "muted";

const toneClasses: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground",
};

export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("relative flex size-2", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden",
            toneClasses[tone],
          )}
        />
      )}
      <span
        className={cn("relative inline-flex size-2 rounded-full", toneClasses[tone])}
      />
    </span>
  );
}
