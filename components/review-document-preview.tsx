"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathFormula } from "@/components/math-formula";
import { VisualCropImage } from "@/components/visual-crop-image";
import type { NoteBlock, SemanticNote } from "@/lib/domain/note";
import { associateEquationAnnotations } from "@/lib/reader/annotations";

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function ReviewDocumentPreview({
  note,
  activeBlockId,
  selectedBlockIds,
  onSelectBlock,
  onSelectedChange,
  onDelete,
  draggedBlockId,
  onDrop,
}: {
  note: SemanticNote;
  activeBlockId: string | null;
  selectedBlockIds: Set<string>;
  onSelectBlock: (id: string) => void;
  onSelectedChange: (id: string, selected: boolean) => void;
  onDelete: (id: string) => void;
  draggedBlockId: string | null;
  onDrop: (targetId: string, after: boolean) => void;
}) {
  const annotations = associateEquationAnnotations(note.blocks);
  const pages = Array.from({ length: Math.max(1, note.source.pageCount) }, (_, index) => index + 1);
  const emittedText = new Set<string>();

  function blockBody(block: NoteBlock, index: number) {
    if (annotations.consumedIndices.has(index)) return null;
    if (block.kind === "heading") {
      const text = block.title ?? block.text;
      const key = normalize(text);
      if (key === normalize(note.title) || emittedText.has(key)) return null;
      emittedText.add(key);
      return <h2>{text}</h2>;
    }
    if (block.math) return <MathFormula
      math={block.math}
      label={block.title?.toLowerCase().includes("formula") ? "Formula" : "Equation"}
      selected={activeBlockId === block.id}
      onSelect={() => onSelectBlock(block.id)}
      annotations={annotations.byEquationId.get(block.id) ?? []}
    />;
    if (block.kind === "graph" || block.kind === "diagram") return <figure className="preview-visual">
      <VisualCropImage block={block} documentId={note.source.documentId} />
      <figcaption>{block.kind === "graph" ? "Graph" : "Diagram"}</figcaption>
      <p>{block.altText ?? block.text}</p>
    </figure>;
    const text = block.text.trim();
    if (!text) return null;
    const key = normalize(text);
    if (key === normalize(note.title) || emittedText.has(key)) return null;
    emittedText.add(key);
    if (block.kind === "annotation") return <p className="preview-annotation">{text}</p>;
    return <p>{text}</p>;
  }

  return <article className="review-live-document">
    <header className="preview-document-header"><p className="preview-document-label">Accessible course notes</p><h1>{note.title}</h1><p>Live preview · This is how the document will read and appear when downloaded.</p></header>
    {pages.map((page) => {
      const pageBlocks = note.blocks.map((block, index) => ({ block, index })).filter(({ block }) => (block.page ?? 1) === page);
      if (!pageBlocks.length && page > 1) return null;
      return <section key={page} className="preview-page" aria-label={`Page ${page} content`}>
        {note.source.pageCount > 1 && <h3>Page {page}</h3>}
        {pageBlocks.map(({ block, index }) => {
          if (annotations.consumedIndices.has(index)) return null;
          const content = blockBody(block, index);
          if (!content) return null;
          const active = activeBlockId === block.id;
          return <section key={block.id} className={`preview-content-block${active ? " is-active" : ""}${block.needsReview ? " needs-review" : ""}${draggedBlockId === block.id ? " is-dragging" : ""}`} onClick={() => onSelectBlock(block.id)} onDragOver={(event) => { if (draggedBlockId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { if (!draggedBlockId) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); onDrop(block.id, event.clientY >= bounds.top + bounds.height / 2); }}>
            <div className="preview-block-tools" onClick={(event) => event.stopPropagation()}>
              <label><input type="checkbox" checked={selectedBlockIds.has(block.id)} onChange={(event) => onSelectedChange(block.id, event.target.checked)} /><span className="sr-only">Select {block.kind} for merging</span></label>
              {block.needsReview && <span className="preview-needs-review">Needs review</span>}
              <Button size="icon" variant="ghost" type="button" className="preview-delete" aria-label={`Delete ${block.kind === "heading" ? "section" : "block"}: ${block.title ?? block.text ?? block.kind}`} title="Delete (Ctrl+Z to undo)" onClick={() => onDelete(block.id)}><Trash2 /></Button>
            </div>
            <div className="preview-content-body">{content}</div>
          </section>;
        })}
      </section>;
    })}
  </article>;
}
