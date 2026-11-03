"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "idle" | "requesting" | "active" | "error";

export type CameraErrorCode =
  | "permission-denied"
  | "not-found"
  | "in-use"
  | "constraints"
  | "insecure-context"
  | "unsupported"
  | "disconnected"
  | "unknown";

export interface CameraError {
  code: CameraErrorCode;
  message: string;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

function toCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        code: "permission-denied",
        message:
          "Camera access was denied. Allow camera permission in your browser settings and try again.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { code: "not-found", message: "No camera was found on this device." };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        code: "in-use",
        message:
          "The camera could not be started. It may be in use by another application.",
      };
    case "OverconstrainedError":
      return {
        code: "constraints",
        message: "The selected camera does not support the requested settings.",
      };
    default:
      return { code: "unknown", message: "An unexpected camera error occurred." };
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function listVideoDevices(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "videoinput" && d.deviceId)
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
    }));
}

/**
 * Manages a local webcam stream. Frames never leave the browser:
 * nothing here records or uploads video.
 */
export function useCamera() {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<CameraError | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  // Incremented on every start/stop so stale getUserMedia results are discarded.
  const requestIdRef = useRef(0);

  const refreshDevices = useCallback(async () => {
    setDevices(await listVideoDevices());
  }, []);

  const release = useCallback(() => {
    requestIdRef.current += 1;
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (requestedDeviceId?: string) => {
      if (!window.isSecureContext) {
        setStatus("error");
        setError({
          code: "insecure-context",
          message: "Camera access requires HTTPS or http://localhost.",
        });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError({
          code: "unsupported",
          message: "This browser does not support camera access.",
        });
        return;
      }

      release();
      const requestId = requestIdRef.current;
      setStream(null);
      setStatus("requesting");
      setError(null);

      const id = requestedDeviceId ?? deviceId;
      const size = { width: { ideal: 1280 }, height: { ideal: 720 } };

      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: id
            ? { deviceId: { exact: id }, ...size }
            : { facingMode: "user", ...size },
        });

        if (requestId !== requestIdRef.current) {
          stopStream(next);
          return;
        }

        streamRef.current = next;
        setStream(next);
        setStatus("active");

        const track = next.getVideoTracks()[0];
        const activeId = track?.getSettings().deviceId;
        if (activeId) setDeviceId(activeId);

        track?.addEventListener("ended", () => {
          if (streamRef.current !== next) return;
          release();
          setStream(null);
          setStatus("error");
          setError({
            code: "disconnected",
            message: "The camera was disconnected.",
          });
        });

        // Labels are only available after permission is granted.
        await refreshDevices();
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setStatus("error");
        setError(toCameraError(err));
      }
    },
    [deviceId, refreshDevices, release],
  );

  const stop = useCallback(() => {
    release();
    setStream(null);
    setStatus("idle");
    setError(null);
  }, [release]);

  const selectDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      if (streamRef.current) void start(id);
    },
    [start],
  );

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let active = true;
    const sync = () =>
      listVideoDevices().then((list) => {
        if (active) setDevices(list);
      });
    void sync();
    media.addEventListener("devicechange", sync);
    return () => {
      active = false;
      media.removeEventListener("devicechange", sync);
    };
  }, []);

  // Always release the camera when the component using this hook unmounts.
  useEffect(() => release, [release]);

  return {
    status,
    error,
    devices,
    deviceId,
    stream,
    start: () => start(),
    stop,
    selectDevice,
  };
}
