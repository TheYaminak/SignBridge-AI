"use client";

import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
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
import { cn } from "@/lib/utils";

type Camera = ReturnType<typeof useCamera>;

const STATUS_LABELS: Record<Camera["status"], string> = {
  idle: "Off",
  requesting: "Starting",
  active: "Live",
  error: "Error",
};

export function CameraPanel({ camera }: { camera: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { status, error, devices, deviceId, stream } = camera;
  const isActive = status === "active";
  const isRequesting = status === "requesting";

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = stream;
  }, [stream]);

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
      </CardContent>

      <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
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
              className="w-full min-w-0 sm:max-w-64"
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
