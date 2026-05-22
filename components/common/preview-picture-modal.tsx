"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ZoomIn, ZoomOut, RotateCcw, Move, X } from "lucide-react";

interface PreviewPictureModalProps {
  open: boolean;
  onClose: () => void;
  imageUrl: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.25;

export function PreviewPictureModal({
  open,
  onClose,
  imageUrl,
}: PreviewPictureModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({
    x: 0,
    y: 0,
  });

  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({
    x: 0,
    y: 0,
  });

  const imageStartRef = useRef({
    x: 0,
    y: 0,
  });

  const resetView = useCallback(() => {
    setScale(1);
    setPosition({
      x: 0,
      y: 0,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      resetView();
    }
  }, [open, resetView]);

  const clampScale = (value: number) => {
    return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
  };

  const zoomIn = () => {
    setScale((prev) => clampScale(prev + ZOOM_STEP));
  };

  const zoomOut = () => {
    setScale((prev) => clampScale(prev - ZOOM_STEP));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const delta = event.deltaY;

    setScale((prev) => {
      if (delta > 0) {
        return clampScale(prev - ZOOM_STEP);
      }

      return clampScale(prev + ZOOM_STEP);
    });
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (scale <= 1) {
      return;
    }

    setIsDragging(true);

    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    imageStartRef.current = {
      ...position,
    };
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) {
      return;
    }

    const deltaX = event.clientX - dragStartRef.current.x;

    const deltaY = event.clientY - dragStartRef.current.y;

    setPosition({
      x: imageStartRef.current.x + deltaX,
      y: imageStartRef.current.y + deltaY,
    });
  };

  const stopDragging = () => {
    setIsDragging(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="border-none bg-transparent p-0 shadow-none sm:max-w-[100vw]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Image Preview</DialogTitle>

        <div
          ref={containerRef}
          className="relative h-screen w-full overflow-hidden bg-transparent"
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
        >
          <div
            className="absolute inset-0 flex items-center justify-center"
            onMouseDown={handleMouseDown}
          >
            <div
              className={`relative h-[90vh] w-[90vw] select-none transition-transform duration-100 ${
                isDragging
                  ? "cursor-grabbing"
                  : scale > 1
                    ? "cursor-grab"
                    : "cursor-default"
              }`}
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                willChange: "transform",
              }}
            >
              <Image
                src={imageUrl}
                alt="Preview image"
                fill
                priority
                draggable={false}
                className="object-contain"
                sizes="90vw"
              />
            </div>
          </div>

          {/* Floating Controls */}
          <div className="absolute bottom-6 right-6 z-50 flex flex-col gap-3">
            <button
              type="button"
              onClick={zoomIn}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:scale-105 hover:bg-black/80"
            >
              <ZoomIn className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={zoomOut}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:scale-105 hover:bg-black/80"
            >
              <ZoomOut className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={resetView}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:scale-105 hover:bg-black/80"
            >
              <RotateCcw className="h-5 w-5" />
            </button>

            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Zoom Indicator */}
          <div className="absolute left-6 top-6 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-md">
            {Math.round(scale * 100)}%
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
