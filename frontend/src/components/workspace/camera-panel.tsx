"use client";

import { useEffect, type RefObject } from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Hand,
  Loader2,
  ShieldCheck,
  VideoOff,
} from "lucide-react";

import { StatusDot } from "@/components/status-dot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { useCamera } from "@/hooks/use-camera";
import type { useHandTracking } from "@/hooks/use-hand-tracking";
import { formatPercent } from "@/lib/format";
import { gestureDisplayName, gestureEmoji } from "@/lib/vision/gestures";
import { cn } from "@/lib/utils";

type Camera = ReturnType<typeof useCamera>;
type Vision = ReturnType<typeof useHandTracking>;

const STATUS_LABELS: Record<Camera["status"], string> = {
  idle: "Off",
  requesting: "Starting",
  active: "Live",
  error: "Error",
};

interface CameraPanelProps {
  camera: Camera;
  vision: Vision;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  showSkeleton: boolean;
  onToggleSkeleton: () => void;
}

export function CameraPanel({
  camera,
  vision,
  videoRef,
  canvasRef,
  showSkeleton,
  onToggleSkeleton,
}: CameraPanelProps) {
  const { status, error, devices, deviceId, stream } = camera;
  const isActive = status === "active";
  const isRequesting = status === "requesting";
  const { snapshot } = vision;

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = stream;
  }, [stream, videoRef]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="size-4 text-primary" aria-hidden="true" />
          Camera
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          Processed on your device. Never recorded or uploaded.
        </CardDescription>
        <CardAction>
          <Badge
            variant={status === "error" ? "destructive" : "outline"}
            className="gap-1.5"
          >
            <StatusDot
              tone={
                isActive ? "success" : status === "error" ? "danger" : "muted"
              }
              pulse={isActive}
            />
            {STATUS_LABELS[status]}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="relative aspect-video overflow-hidden rounded-xl border bg-black/50">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Live camera preview, mirrored"
            className={cn(
              "size-full -scale-x-100 object-cover",
              !isActive && "invisible",
            )}
          />
          {/* Same box, fit, and mirror as the video so landmarks line up. */}
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 size-full -scale-x-100 object-cover",
              (!isActive || !showSkeleton) && "invisible",
            )}
          />

          {isActive && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 font-medium text-white backdrop-blur">
                {vision.status === "loading" ? (
                  <>
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    Loading hand model…
                  </>
                ) : vision.status === "error" ? (
                  <>
                    <AlertTriangle className="size-3 text-destructive" aria-hidden="true" />
                    Hand tracking unavailable
                  </>
                ) : (
                  <>
                    <Hand className="size-3" aria-hidden="true" />
                    {snapshot.handCount} {snapshot.handCount === 1 ? "hand" : "hands"}
                  </>
                )}
              </span>
              {snapshot.gesture && (
                <span className="rounded-full bg-black/60 px-2.5 py-1 font-medium text-white backdrop-blur">
                  {gestureEmoji(snapshot.gesture.label)} {gestureDisplayName(snapshot.gesture.label)}{" "}
                  <span className="tabular-nums opacity-80">
                    {formatPercent(snapshot.gesture.confidence)}
                  </span>
                </span>
              )}
            </div>
          )}
          {isActive && vision.delegate && (
            <span className="pointer-events-none absolute right-3 bottom-3 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
              MediaPipe · {vision.delegate}
              {snapshot.fps > 0 && ` · ${snapshot.fps} fps`}
            </span>
          )}

          {!isActive && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"
              aria-live="polite"
            >
              {isRequesting ? (
                <>
                  <Loader2
                    className="size-8 animate-spin text-primary"
                    aria-hidden="true"
                  />
                  <p>Waiting for camera permission…</p>
                </>
              ) : status === "error" ? (
                <>
                  <AlertTriangle
                    className="size-8 text-destructive"
                    aria-hidden="true"
                  />
                  <p>Camera unavailable</p>
                </>
              ) : (
                <>
                  <VideoOff className="size-8" aria-hidden="true" />
                  <p>Camera is off. Start it to see a live preview.</p>
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Camera error</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {vision.error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Hand tracking error</AlertTitle>
            <AlertDescription>{vision.error} Stop and restart the camera to retry.</AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {isActive || isRequesting ? (
          <Button
            variant="destructive"
            size="lg"
            onClick={camera.stop}
            className="sm:w-36"
          >
            <CameraOff aria-hidden="true" />
            Stop camera
          </Button>
        ) : (
          <Button size="lg" onClick={camera.start} className="sm:w-36">
            <Camera aria-hidden="true" />
            {status === "error" ? "Try again" : "Start camera"}
          </Button>
        )}

        <Button
          variant="outline"
          size="lg"
          onClick={onToggleSkeleton}
          aria-pressed={showSkeleton}
        >
          <Hand aria-hidden="true" />
          {showSkeleton ? "Hide skeleton" : "Show skeleton"}
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
          <span
            id="camera-device-label"
            className="shrink-0 text-xs text-muted-foreground"
          >
            Device
          </span>
          <Select
            value={deviceId}
            onValueChange={(value) => {
              if (value) camera.selectDevice(value);
            }}
            items={devices.map((d) => ({ value: d.deviceId, label: d.label }))}
            disabled={devices.length === 0 || isRequesting}
          >
            <SelectTrigger
              aria-labelledby="camera-device-label"
              className="w-full min-w-0 sm:max-w-56"
            >
              <SelectValue
                placeholder={
                  devices.length === 0 ? "No cameras detected" : "Default camera"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardFooter>
    </Card>
  );
}
