"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";
import { WebRenderingPanel, type EnrichedSection } from "./web-rendering-panel";
import { usePipelineBusy } from "../use-pipeline-refresh";

type PanelKey = "images" | "text" | "sections";
const PANEL_KEYS: PanelKey[] = ["images", "text", "sections"];

interface StoryboardPageRowProps {
  children: [ReactNode, ReactNode, ReactNode]; // ImageClassificationPanel, TextClassificationPanel, SectionsPanel
  panelLoaded: Record<PanelKey, boolean>;
  webRenderingProps: {
    label: string;
    pageId: string;
    pageNumber?: number;
    sections: EnrichedSection[] | null;
  };
}

export function StoryboardPageRow({ children, panelLoaded, webRenderingProps }: StoryboardPageRowProps) {
  const { pageId } = webRenderingProps;

  const [toggles, setToggles] = useState<Record<PanelKey, boolean>>({
    images: false,
    text: false,
    sections: false,
  });

  const panelBusy: Record<PanelKey, boolean> = {
    images: usePipelineBusy(pageId, "image-classification"),
    text: usePipelineBusy(pageId, "text-classification"),
    sections: usePipelineBusy(pageId, "sections"),
  };

  const panelEls = useRef<Record<PanelKey, HTMLDivElement | null>>({
    images: null,
    text: null,
    sections: null,
  });

  const handleToggle = useCallback((panel: PanelKey) => {
    setToggles((prev) => {
      const opening = !prev[panel];
      if (opening) {
        requestAnimationFrame(() => {
          panelEls.current[panel]?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return { ...prev, [panel]: !prev[panel] };
    });
  }, []);

  return (
    <>
      {PANEL_KEYS.map((key, i) => (
        <div
          key={key}
          ref={(el) => { panelEls.current[key] = el; }}
          className="grid scroll-mt-16 transition-[grid-template-rows] duration-300 ease-in-out"
          style={{ gridTemplateRows: toggles[key] ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">{children[i]}</div>
        </div>
      ))}
      <WebRenderingPanel
        {...webRenderingProps}
        panelToggles={toggles}
        panelBusy={panelBusy}
        panelLoaded={panelLoaded}
        onTogglePanel={handleToggle}
      />
    </>
  );
}
