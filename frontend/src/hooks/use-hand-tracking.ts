"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { MediaPipeGestureClassifier } from "@/lib/vision/classifier";
import { clearCanvas, drawHands } from "@/lib/vision/draw";
import { createHandTracker, type Delegate, type HandTracker } from "@/lib/vision/hand-tracker";
import { GestureStabilizer } from "@/lib/vision/stabilizer";
import type { FrameClassifier, FrameObservation, RecognitionKind } from "@/lib/vision/types";

export type VisionStatus = "off" | "loading" | "running" | "error";

export interface VisionSnapshot {
  handCount: number;
  /** Best per-frame prediction (any confidence), for live display. */
  gesture: { label: string; confidence: number } | null;
  /** Label currently winning the stabilizer window. */
  candidate: { label: string; agreement: number } | null;
  fps: number;
}

export interface RecognitionEvent {
  label: string;
  confidence: number;
  kind: RecognitionKind;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Run only while the camera is live. */
  enabled: boolean;
  showSkeleton: boolean;
  minConfidence: number;
  onRecognition?: (event: RecognitionEvent) => void;
  /**
   * Called for every processed frame with the raw landmarks and the
   * monotonic timestamp (performance.now()). Used by training and the custom
   * sign recognizer; keep it cheap.
   */
  onFrame?: (frame: FrameObservation, timestampMs: number) => void;
}

const EMPTY_SNAPSHOT: VisionSnapshot = { handCount: 0, gesture: null, candidate: null, fps: 0 };
const PUBLISH_INTERVAL_MS = 100;

interface Phase {
  status: Exclude<VisionStatus, "off">;
  delegate: Delegate | null;
  error: string | null;
}
const LOADING: Phase = { status: "loading", delegate: null, error: null };

const snapshotKey = (s: VisionSnapshot) =>
  `${s.handCount}|${s.gesture?.label}|${s.gesture?.confidence.toFixed(2)}|${s.candidate?.label}|${s.candidate?.agreement.toFixed(1)}|${s.fps}`;

/**
 * Runs MediaPipe hand tracking on the existing <video> element (no second
 * camera stream). Per-frame work stays in refs; React state is updated at
 * most every 100 ms and only when the visible values change.
 */
export function useHandTracking({
  videoRef,
  canvasRef,
  enabled,
  showSkeleton,
  minConfidence,
  onRecognition,
  onFrame,
}: Options) {
  const [phase, setPhase] = useState<Phase>(LOADING);
  const [snapshot, setSnapshot] = useState<VisionSnapshot>(EMPTY_SNAPSHOT);

  const showSkeletonRef = useRef(showSkeleton);
  const onRecognitionRef = useRef(onRecognition);
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);
  useEffect(() => {
    showSkeletonRef.current = showSkeleton;
    if (!showSkeleton) clearCanvas(canvasRef.current);
  }, [showSkeleton, canvasRef]);
  useEffect(() => {
    onRecognitionRef.current = onRecognition;
  }, [onRecognition]);

  useEffect(() => {
    if (!enabled) return;

    // The canvas is always rendered, so the element is stable for this effect.
    const canvasEl = canvasRef.current;
    let cancelled = false;
    let raf = 0;
    let tracker: HandTracker | null = null;
    let triedCpuFallback = false;

    const classifier: FrameClassifier = new MediaPipeGestureClassifier();
    const stabilizer = new GestureStabilizer({ minConfidence });

    let lastVideoTime = -1;
    let lastTimestamp = 0;
    let lastPublish = 0;
    let lastKey = snapshotKey(EMPTY_SNAPSHOT);
    let fps = 0;
    let fpsFrames = 0;
    let fpsWindowStart = performance.now();

    const fail = (message: string) => {
      cancelAnimationFrame(raf);
      tracker?.close();
      tracker = null;
      if (!cancelled) setPhase({ status: "error", delegate: null, error: message });
    };

    const loop = () => {
      if (cancelled || !tracker) return;
      raf = requestAnimationFrame(loop);

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      if (video.currentTime === lastVideoTime) return; // no new frame
      lastVideoTime = video.currentTime;

      // MediaPipe requires strictly increasing timestamps.
      const now = Math.max(performance.now(), lastTimestamp + 1);
      lastTimestamp = now;

      let frame;
      try {
        frame = tracker.detect(video, now);
      } catch (err) {
        if (tracker.delegate === "GPU" && !triedCpuFallback) {
          console.warn("MediaPipe GPU inference failed, retrying on CPU.", err);
          triedCpuFallback = true;
          cancelAnimationFrame(raf);
          tracker.close();
          tracker = null;
          void start(false);
        } else {
          fail("Hand tracking stopped unexpectedly.");
        }
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        if (showSkeletonRef.current) drawHands(ctx, frame, tracker.connections);
      }

      onFrameRef.current?.(frame, now);

      const classification = classifier.classify(frame);
      const { event, candidate } = stabilizer.push({
        timestampMs: now,
        handsPresent: frame.hands.length > 0,
        classification,
      });
      if (event) {
        onRecognitionRef.current?.({
          label: event.label,
          confidence: event.confidence,
          kind: event.kind,
          timestamp: Date.now(),
        });
      }

      fpsFrames += 1;
      if (now - fpsWindowStart >= 1000) {
        fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
        fpsFrames = 0;
        fpsWindowStart = now;
      }

      if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
        const next: VisionSnapshot = {
          handCount: frame.hands.length,
          gesture: classification
            ? { label: classification.label, confidence: classification.confidence }
            : null,
          candidate,
          fps,
        };
        const key = snapshotKey(next);
        if (key !== lastKey) {
          lastKey = key;
          lastPublish = now;
          setSnapshot(next);
        }
      }
    };

    const start = async (preferGpu: boolean) => {
      try {
        const created = await createHandTracker({ preferGpu });
        if (cancelled) {
          created.close();
          return;
        }
        tracker = created;
        setPhase({ status: "running", delegate: created.delegate, error: null });
        raf = requestAnimationFrame(loop);
      } catch (err) {
        console.error("Failed to load MediaPipe gesture recognizer", err);
        fail("Could not load the hand tracking model.");
      }
    };

    void start(true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      tracker?.close();
      tracker = null;
      clearCanvas(canvasEl);
      setPhase(LOADING);
      setSnapshot(EMPTY_SNAPSHOT);
    };
  }, [enabled, minConfidence, videoRef, canvasRef]);

  return {
    status: (enabled ? phase.status : "off") as VisionStatus,
    delegate: enabled ? phase.delegate : null,
    error: enabled ? phase.error : null,
    snapshot: enabled ? snapshot : EMPTY_SNAPSHOT,
  };
}
