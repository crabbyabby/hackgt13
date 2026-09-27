"use client";

import { useState } from "react";
import type { NoteBlock } from "@/lib/domain/note";

function cropUrl(documentId: string, block: NoteBlock) {
  const region = block.sourceRegion;
  if (!region) return undefined;
  const query = new URLSearchParams({
    x: String(region.x),
    y: String(region.y),
    width: String(region.width),
    height: String(region.height),
  });
  return `/api/documents/${encodeURIComponent(documentId)}/pages/${region.page}/crop?${query}`;
}

export function VisualCropImage({ block, documentId }: { block: NoteBlock; documentId?: string }) {
  const [pageRatio, setPageRatio] = useState<number | null>(null);
  const region = block.sourceRegion;
  const alt = block.altText || block.title || block.text || "Graph from the source notes";

  // Bundled fixtures keep the complete rendered page so crop edits can be previewed
  // instantly without a running Python API.
  if (block.sourceImageUrl && region) {
    const cropRatio = pageRatio ? pageRatio * region.width / region.height : 16 / 9;
    return (
      <div className="visual-crop-window" style={{ aspectRatio: cropRatio }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={block.sourceImageUrl}
          alt={alt}
          onLoad={(event) => setPageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          style={{
            width: `${10000 / region.width}%`,
            left: `${-100 * region.x / region.width}%`,
            top: `${-100 * region.y / region.height}%`,
          }}
        />
      </div>
    );
  }

  const imageUrl = documentId ? cropUrl(documentId, block) : block.imageUrl;
  if (!imageUrl) return <div className="visual-crop-empty">No source crop is available.</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="visual-crop-result" src={imageUrl} alt={alt} />;
}
