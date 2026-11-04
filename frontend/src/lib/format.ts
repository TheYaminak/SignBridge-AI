import type { TokenUsage } from "@/types/sign";

export function formatUsage(usage?: TokenUsage): string {
  if (!usage) return "Not reported";
  const parts = [
    `${usage.prompt_tokens} in`,
    `${usage.completion_tokens} out`,
  ];
  if (usage.reasoning_tokens) parts.push(`${usage.reasoning_tokens} reasoning`);
  return `${usage.total_tokens} total (${parts.join(", ")})`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
