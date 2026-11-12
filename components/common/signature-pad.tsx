"use client";

import { Eraser, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A drawn signature, or an uploaded image of one, as a PNG data URL.
//
// Pointer events cover mouse, pen and finger alike, so the same pad works on
// a site manager's phone at handover. The canvas is drawn at the device's
// pixel ratio so a signature does not print blurred, and an upload is redrawn
// onto the same white canvas so the server only ever receives a PNG.

const HEIGHT = 160;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function SignaturePad({
  value,
  onChange,
  disabled,
  label = "Signature",
  className,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const context = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext("2d") : null;
  }, []);

  const reset = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, HEIGHT);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [context]);

  useEffect(() => {
    reset();
  }, [reset]);

  // Redraw a value set from outside (an upload), or clear for null.
  useEffect(() => {
    if (value !== null) return;
    reset();
  }, [reset, value]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const commit = () => {
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const p = point(event);
    last.current = p;
    const ctx = context();
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "#111827";
      ctx.fill();
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = context();
    const p = point(event);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    commit();
  };

  const onUpload = (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Choose an image of the signature.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("That image is too large. Use one under 5 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      reset();
      const canvas = canvasRef.current;
      const ctx = context();
      if (canvas && ctx) {
        const width = canvas.clientWidth;
        const scale = Math.min(width / image.width, HEIGHT / image.height, 1);
        const w = image.width * scale;
        const h = image.height * scale;
        ctx.drawImage(image, (width - w) / 2, (HEIGHT - h) / 2, w, h);
        commit();
      }
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      setUploadError("That image could not be read.");
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden="true" />
            Upload
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || value === null}
            onClick={() => {
              reset();
              onChange(null);
            }}
          >
            <Eraser className="size-4" aria-hidden="true" />
            Clear
          </Button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={`${label}: draw with your finger, pen or mouse`}
        role="img"
        className={cn(
          "block w-full touch-none rounded-md border border-dashed border-input bg-white",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair",
        )}
        style={{ height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          onUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground">
        {value ? "Signature captured." : "Sign in the box, or upload an image."}
      </p>
      {uploadError ? (
        <p className="text-xs text-destructive-ink" role="alert">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}
