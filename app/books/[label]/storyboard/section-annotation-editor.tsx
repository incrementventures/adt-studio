"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { Annotation } from "@/lib/pipeline/web-rendering/edit-section";

export interface SectionAnnotationEditorHandle {
  submit: () => void;
  canSubmit: boolean;
}

interface SectionAnnotationEditorProps {
  containerWidth: number;
  containerHeight: number;
  onSubmit: (annotationImageBase64: string, annotations: Annotation[]) => void;
  onCanSubmitChange?: (canSubmit: boolean) => void;
}

interface AnnotationBox {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export const SectionAnnotationEditor = forwardRef<
  SectionAnnotationEditorHandle,
  SectionAnnotationEditorProps
>(function SectionAnnotationEditor(
  { containerWidth, containerHeight, onSubmit, onCanSubmitChange },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [annotations, setAnnotations] = useState<AnnotationBox[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [currentPos, setCurrentPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const nextId = useRef(1);

  const getCanvasPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw completed annotations
    for (const ann of annotations) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
      ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
      ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);

      // Number label
      const idx = annotations.indexOf(ann) + 1;
      ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
      ctx.fillRect(ann.x, ann.y, 24, 20);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(String(idx), ann.x + 7, ann.y + 14);

      // Text label — wrap inside the annotation box
      if (ann.text) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.font = "11px sans-serif";
        const textX = ann.x + 4;
        const textY = ann.y + 28;
        const maxW = ann.width - 8;
        const lineH = 14;
        const words = ann.text.split(" ");
        let line = "";
        let dy = 0;
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, textX, textY + dy);
            line = word;
            dy += lineH;
          } else {
            line = test;
          }
        }
        if (line) {
          ctx.fillText(line, textX, textY + dy);
        }
      }
    }

    // Draw current selection
    if (drawing && startPos && currentPos) {
      const x = Math.min(startPos.x, currentPos.x);
      const y = Math.min(startPos.y, currentPos.y);
      const w = Math.abs(currentPos.x - startPos.x);
      const h = Math.abs(currentPos.y - startPos.y);
      ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(59, 130, 246, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }, [annotations, drawing, startPos, currentPos]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleSubmit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || annotations.length === 0 || editingId !== null) return;

    drawCanvas();

    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];

    const normalized: Annotation[] = annotations.map((a) => ({
      x: a.x / containerWidth,
      y: a.y / containerHeight,
      width: a.width / containerWidth,
      height: a.height / containerHeight,
      text: a.text,
    }));

    onSubmit(base64, normalized);
  }, [annotations, editingId, containerWidth, containerHeight, onSubmit, drawCanvas]);

  const canSubmit = annotations.length > 0 && editingId === null;

  useImperativeHandle(
    ref,
    () => ({
      submit: handleSubmit,
      canSubmit,
    }),
    [handleSubmit, canSubmit]
  );

  useEffect(() => {
    onCanSubmitChange?.(canSubmit);
  }, [canSubmit, onCanSubmitChange]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (editingId !== null) return;
      const pos = getCanvasPos(e);
      setDrawing(true);
      setStartPos(pos);
      setCurrentPos(pos);
    },
    [editingId, getCanvasPos]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawing) return;
      setCurrentPos(getCanvasPos(e));
    },
    [drawing, getCanvasPos]
  );

  const handleMouseUp = useCallback(() => {
    if (!drawing || !startPos || !currentPos) return;
    setDrawing(false);

    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const w = Math.abs(currentPos.x - startPos.x);
    const h = Math.abs(currentPos.y - startPos.y);

    if (w < 10 || h < 10) {
      setStartPos(null);
      setCurrentPos(null);
      return;
    }

    const id = nextId.current++;
    const newAnnotation: AnnotationBox = {
      id,
      x,
      y,
      width: w,
      height: h,
      text: "",
    };
    setAnnotations((prev) => [...prev, newAnnotation]);
    setEditingId(id);
    setStartPos(null);
    setCurrentPos(null);
  }, [drawing, startPos, currentPos]);

  const handleTextChange = useCallback((id: number, text: string) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, text } : a))
    );
  }, []);

  const handleTextKeyDown = useCallback(
    (e: React.KeyboardEvent, id: number) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ann = annotations.find((a) => a.id === id);
        if (ann && !ann.text.trim()) {
          setAnnotations((prev) => prev.filter((a) => a.id !== id));
        }
        setEditingId(null);
      } else if (e.key === "Escape") {
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
        setEditingId(null);
      }
    },
    [annotations]
  );

  const handleRemove = useCallback((id: number) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setEditingId(null);
  }, []);

  return (
    <div className="absolute inset-0" style={{ zIndex: 10 }}>
      <canvas
        ref={canvasRef}
        width={containerWidth}
        height={containerHeight}
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />

      {/* Text inputs anchored to annotations being edited */}
      {annotations.map((ann) =>
        editingId === ann.id ? (
          <div
            key={ann.id}
            className="absolute"
            style={{
              left: ann.x,
              top: ann.y + ann.height + 4,
              zIndex: 20,
            }}
          >
            <textarea
              autoFocus
              rows={2}
              value={ann.text}
              onChange={(e) => handleTextChange(ann.id, e.target.value)}
              onKeyDown={(e) => handleTextKeyDown(e, ann.id)}
              placeholder="Type instruction, Enter to confirm"
              className="resize-none rounded border border-blue-400 bg-white px-2 py-1 text-xs shadow-lg outline-none focus:ring-2 focus:ring-blue-500"
              style={{ width: Math.max(ann.width, 220) }}
            />
          </div>
        ) : null
      )}

      {/* Delete buttons on annotations */}
      {annotations.map((ann) => (
        <button
          key={`del-${ann.id}`}
          type="button"
          onClick={() => handleRemove(ann.id)}
          className="absolute flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow hover:bg-red-600"
          style={{
            left: ann.x + ann.width - 10,
            top: ann.y - 10,
            zIndex: 20,
          }}
        >
          ×
        </button>
      ))}
    </div>
  );
});
