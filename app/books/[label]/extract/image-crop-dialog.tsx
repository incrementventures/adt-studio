"use client";

import { useState, useRef, useCallback } from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

interface CropCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageCropDialogProps {
  src: string;
  alt: string;
  initialCrop?: CropCoords;
  onCrop: (crop: CropCoords | undefined) => void;
  onClose: () => void;
}

export function ImageCropDialog({
  src,
  alt,
  initialCrop,
  onCrop,
  onClose,
}: ImageCropDialogProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop | undefined>();
  const [pixelCrop, setPixelCrop] = useState<PixelCrop | undefined>();
  const [initialized, setInitialized] = useState(false);

  const onImageLoaded = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (initialized) return;
      setInitialized(true);
      const img = e.currentTarget;
      imgRef.current = img;
      if (initialCrop) {
        const pctX = (initialCrop.x / img.naturalWidth) * 100;
        const pctY = (initialCrop.y / img.naturalHeight) * 100;
        const pctW = (initialCrop.width / img.naturalWidth) * 100;
        const pctH = (initialCrop.height / img.naturalHeight) * 100;
        setCrop({
          unit: "%",
          x: pctX,
          y: pctY,
          width: pctW,
          height: pctH,
        });
        setPixelCrop({
          unit: "px",
          x: initialCrop.x,
          y: initialCrop.y,
          width: initialCrop.width,
          height: initialCrop.height,
        });
      }
    },
    [initialCrop, initialized]
  );

  function handleApply() {
    if (!pixelCrop || !imgRef.current) {
      onCrop(undefined);
      return;
    }
    const img = imgRef.current;
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    onCrop({
      x: Math.round(pixelCrop.x * scaleX),
      y: Math.round(pixelCrop.y * scaleY),
      width: Math.round(pixelCrop.width * scaleX),
      height: Math.round(pixelCrop.height * scaleY),
    });
  }

  function handleClear() {
    onCrop(undefined);
  }

  const mouseDownTarget = useRef<EventTarget | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onMouseDown={(e) => {
        mouseDownTarget.current = e.target;
      }}
      onClick={(e) => {
        if (
          e.target === e.currentTarget &&
          mouseDownTarget.current === e.currentTarget
        )
          onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex max-h-[90vh] max-w-[90vw] flex-col gap-3 rounded-xl bg-background p-4 shadow-2xl border border-border">
        <div className="overflow-hidden">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setPixelCrop(c)}
          >
            <img
              src={src}
              alt={alt}
              onLoad={onImageLoaded}
              style={{ maxHeight: "70vh", maxWidth: "80vw" }}
            />
          </ReactCrop>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="cursor-pointer rounded px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-surface transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="cursor-pointer rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
