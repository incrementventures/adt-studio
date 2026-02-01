"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { dialogStyles } from "@/app/ui/dialog-styles";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop | undefined>();
  const [pixelCrop, setPixelCrop] = useState<PixelCrop | undefined>();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    dlg.showModal();
    const handleClose = () => onClose();
    dlg.addEventListener("close", handleClose);
    return () => dlg.removeEventListener("close", handleClose);
  }, [onClose]);

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

  return (
    <dialog
      ref={dialogRef}
      className={dialogStyles.dialog.replace("max-w-lg", "max-w-fit")}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      {/* Header */}
      <div className={dialogStyles.header}>
        <h2 className={dialogStyles.headerTitle}>Crop Image</h2>
        <button
          onClick={() => dialogRef.current?.close()}
          className={dialogStyles.headerClose}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11.78 4.28a.75.75 0 0 0-1.06-1.06L7.5 6.44 4.28 3.22a.75.75 0 0 0-1.06 1.06L6.44 7.5 3.22 10.72a.75.75 0 1 0 1.06 1.06L7.5 8.56l3.22 3.22a.75.75 0 1 0 1.06-1.06L8.56 7.5l3.22-3.22Z" fill="currentColor"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className={dialogStyles.body}>
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
      </div>

      {/* Footer */}
      <div className={dialogStyles.footer}>
        <button type="button" onClick={handleClear} className={dialogStyles.secondaryBtn}>
          Clear
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()} className={dialogStyles.cancelBtn}>
          Cancel
        </button>
        <button type="button" onClick={handleApply} className={dialogStyles.primaryBtn}>
          Apply
        </button>
      </div>
    </dialog>
  );
}
