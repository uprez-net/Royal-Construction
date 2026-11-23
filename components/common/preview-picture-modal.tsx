"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { storedImageProps } from "@/lib/files/file-href";

interface PreviewPictureModalProps {
  open: boolean;
  onClose: () => void;
  imageUrls: string[];
  selectedIndex: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.25;

export function PreviewPictureModal({
  open,
  onClose,
  imageUrls,
  selectedIndex,
}: PreviewPictureModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [currentIndex, setCurrentIndex] = useState(selectedIndex);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const imageStartRef = useRef({ x: 0, y: 0 });

  const hasMultipleImages = imageUrls.length > 1;

  const resetView = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const clampScale = useCallback((value: number) => {
    return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
  }, []);

  const zoomIn = useCallback(() => {
    setScale((prev) => clampScale(prev + ZOOM_STEP));
  }, [clampScale]);

  const zoomOut = useCallback(() => {
    setScale((prev) => clampScale(prev - ZOOM_STEP));
  }, [clampScale]);

  const goToPrevious = useCallback(() => {
    if (!hasMultipleImages) return;
    resetView();
    setCurrentIndex((prev) => (prev === 0 ? imageUrls.length - 1 : prev - 1));
  }, [hasMultipleImages, imageUrls.length, resetView]);

  const goToNext = useCallback(() => {
    if (!hasMultipleImages) return;
    resetView();
    setCurrentIndex((prev) => (prev === imageUrls.length - 1 ? 0 : prev + 1));
  }, [hasMultipleImages, imageUrls.length, resetView]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        goToPrevious();
      } else if (event.key === "ArrowRight") {
        goToNext();
      } else if (event.key === "+" || event.key === "=") {
        zoomIn();
      } else if (event.key === "-") {
        zoomOut();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, goToPrevious, goToNext, zoomIn, zoomOut]);

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY;
    setScale((prev) => {
      if (delta > 0) {
        return clampScale(prev - ZOOM_STEP);
      }
      return clampScale(prev + ZOOM_STEP);
    });
  };

  const handleMouseDown = (event: React.MouseEvent) => {
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

  const handleMouseMove = (event: React.MouseEvent) => {
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
      resetView();
      onClose();
    }
  };

  const currentImageUrl = imageUrls[currentIndex];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-screen w-screen max-w-none border-none bg-transparent p-0 backdrop-blur-2xl"
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
              className={cn(
                "relative h-[90vh] w-[90vw] select-none transition-transform duration-100",
                isDragging
                  ? "cursor-grabbing"
                  : scale > 1
                    ? "cursor-grab"
                    : "cursor-default",
              )}
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                willChange: "transform",
              }}
            >
              <Image
                {...storedImageProps(currentImageUrl)}
                alt={`Preview image ${currentIndex + 1} of ${imageUrls.length}`}
                fill
                priority
                draggable={false}
                className="object-contain"
                sizes="90vw"
              />
            </div>
          </div>

          {/* Previous / Next Navigation */}
          {hasMultipleImages && (
            <>
              <button
                type="button"
                onClick={goToPrevious}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 z-50 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={goToNext}
                aria-label="Next image"
                className="absolute right-4 top-1/2 z-50 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* Floating Controls */}
          <div className="absolute bottom-6 right-6 z-50 flex flex-col gap-3">
            <button
              type="button"
              onClick={zoomIn}
              aria-label="Zoom in"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={zoomOut}
              aria-label="Zoom out"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={resetView}
              aria-label="Reset zoom"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Close preview"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Zoom + Image Counter Indicator */}
          <div className="absolute left-6 top-6 flex items-center gap-3">
            <div className="rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-md">
              {Math.round(scale * 100)}%
            </div>
            {hasMultipleImages && (
              <div className="rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-md">
                {currentIndex + 1} / {imageUrls.length}
              </div>
            )}
          </div>

          {/* Thumbnail Strip */}
          {hasMultipleImages && (
            <div className="absolute bottom-6 left-1/2 z-50 flex max-w-[80vw] -translate-x-1/2 gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/60 p-2 backdrop-blur-md">
              {imageUrls.map((url, index) => (
                <button
                  key={url + index}
                  type="button"
                  onClick={() => {
                    resetView();
                    setCurrentIndex(index);
                  }}
                  aria-label={`Go to image ${index + 1}`}
                  className={cn(
                    "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border transition",
                    index === currentIndex
                      ? "border-white opacity-100"
                      : "border-white/10 opacity-50 hover:opacity-80",
                  )}
                >
                  <Image
                    {...storedImageProps(url)}
                    alt={`Thumbnail ${index + 1}`}
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
