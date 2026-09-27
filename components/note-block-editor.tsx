import type { DragEvent } from "react";
import type { BlockKind, NoteBlock } from "@/lib/domain/note";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisualCropImage } from "@/components/visual-crop-image";

const editableKinds: Array<{ value: BlockKind; label: string }> = [
  { value: "heading", label: "Heading" },
  { value: "paragraph", label: "Paragraph" },
  { value: "equation", label: "Equation" },
  { value: "graph", label: "Graph" },
];

export function NoteBlockEditor({ block, documentId, onChange, onDelete, selected = false, onSelectedChange, onDragStart, onDragEnd, onDrop, dragging = false }: {
  block: NoteBlock;
  documentId?: string;
  onChange: (block: NoteBlock) => void;
  onDelete?: (id: string) => void;
  selected?: boolean;
  onSelectedChange?: (id: string, selected: boolean) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onDrop?: (targetId: string, after: boolean) => void;
  dragging?: boolean;
}) {
  function changeKind(kind: BlockKind) {
    if (kind === block.kind) return;
    if (kind === "equation") {
      onChange({
        ...block,
        kind,
        title: block.title,
        math: block.math ?? {
          latex: block.text.trim(),
          spoken: block.text.trim(),
          label: "Equation",
          variables: [],
        },
      });
      return;
    }
    const formulaText = block.math && !block.text.trim()
      ? `${block.math.spoken}\n\nLaTeX: ${block.math.latex}`
      : block.text;
    onChange({
      ...block,
      kind,
      title: kind === "heading" ? (block.title ?? formulaText) : undefined,
      text: formulaText,
      math: undefined,
      altText: kind === "graph" ? (block.altText ?? formulaText) : undefined,
    });
  }

  function updateCrop(field: "x" | "y" | "width" | "height", rawValue: string) {
    const current = block.sourceRegion ?? { page: block.page ?? 1, x: 0, y: 0, width: 100, height: 100 };
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const maximum = field === "x" ? 100 - current.width
      : field === "y" ? 100 - current.height
      : field === "width" ? 100 - current.x
      : 100 - current.y;
    const minimum = field === "width" || field === "height" ? 1 : 0;
    onChange({ ...block, sourceRegion: { ...current, [field]: Math.min(maximum, Math.max(minimum, parsed)) } });
  }

  async function compileEditedMath(latex: string, baseBlock = block) {
    try {
      const response = await fetch("/api/mathml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex }),
      });
      if (!response.ok) return;
      const compiled = await response.json() as {
        latex: string; mathml: string | null; mathmlError: string | null;
        structureWarning: string | null; needsReview: boolean;
      };
      if (!baseBlock.math) return;
      onChange({
        ...baseBlock,
        needsReview: baseBlock.needsReview || compiled.needsReview,
        reviewReason: compiled.structureWarning || baseBlock.reviewReason,
        math: {
          ...baseBlock.math,
          latex: compiled.latex,
          mathml: compiled.mathml ?? undefined,
          mathmlError: compiled.mathmlError ?? undefined,
          structureWarning: compiled.structureWarning ?? undefined,
        },
      });
    } catch {
      // Keep the editable LaTeX even if the preview compiler is temporarily unavailable.
    }
  }

  return (
    <section
      className={`block-editor ${block.needsReview ? "needs-review" : ""}${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}`}
      aria-labelledby={`${block.id}-label`}
      onDragOver={(event) => { if (onDrop) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={(event) => {
        if (!onDrop) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onDrop(block.id, event.clientY >= bounds.top + bounds.height / 2);
      }}
    >
      <div className="block-editor-header">
        <div className="block-editor-identity">
          <input className="merge-checkbox" type="checkbox" checked={selected} onChange={(event) => onSelectedChange?.(block.id, event.target.checked)} aria-label={`Select ${block.kind} for merging`} />
          <span className="kind-label" id={`${block.id}-label`}>{block.kind}</span>{block.needsReview && <span className="review-flag">Needs review</span>}
        </div>
        <div className="block-editor-tools"><span>{Math.round(block.confidence * 100)}% confidence</span>
          <Button className="drag-handle" size="icon" variant="ghost" type="button" draggable
            aria-label={`Drag to reorder ${block.title ?? block.text ?? block.kind}`}
            title="Hold and drag to reorder"
            onDragStart={(event: DragEvent<HTMLButtonElement>) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", block.id);
              onDragStart?.(block.id);
            }}
            onDragEnd={() => onDragEnd?.()}><GripVertical /></Button>
          <label className="block-type-control"><span className="sr-only">Edit section type</span>
            <select aria-label={`Edit type for ${block.title ?? block.text ?? block.kind}`} value={block.kind} onChange={(event) => changeKind(event.target.value as BlockKind)}>
              {!editableKinds.some(({ value }) => value === block.kind) && <option value={block.kind}>{`${block.kind[0].toUpperCase()}${block.kind.slice(1)} (current)`}</option>}
              {editableKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </select>
          </label>
          {onDelete && <Button className="delete-section" size="icon" variant="ghost" type="button"
            aria-label={`Delete ${block.kind === "heading" ? "section" : "block"}: ${block.title ?? block.text ?? block.kind}`}
            title={block.kind === "heading" ? "Delete this section (Ctrl+Z to undo)" : "Delete this block (Ctrl+Z to undo)"}
            onClick={() => onDelete(block.id)}><Trash2 /></Button>}
        </div>
      </div>
      {block.kind === "heading" && <label>Label<input value={block.title ?? ""} onChange={(event) => onChange({ ...block, title: event.target.value })} /></label>}
      <label>Content<textarea rows={block.kind === "paragraph" ? 4 : 2} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} /></label>
      {block.math && <div className="two-column-fields"><label>LaTeX<input value={block.math.latex} onChange={(event) => onChange({ ...block, math: { ...block.math!, latex: event.target.value } })} onBlur={(event) => void compileEditedMath(event.currentTarget.value)} /></label><label>Spoken math<input value={block.math.spoken} onChange={(event) => onChange({ ...block, math: { ...block.math!, spoken: event.target.value } })} /></label></div>}
      {block.interpretations && block.interpretations.length > 1 && <div className="interpretation-list"><strong>Possible interpretations</strong>{block.interpretations.map((candidate, index) => {
        const selected = block.math ? candidate.latex === block.math.latex : candidate.reading === block.text;
        return <div key={`${candidate.reading}-${index}`}><span>{Math.round(candidate.confidence * 100)}%{selected ? " · current best read" : ""}</span><p>{candidate.reading}{candidate.latex ? ` · ${candidate.latex}` : ""}</p><small>{candidate.evidence}</small><button type="button" onClick={() => {
          if (block.math) {
            const latex = candidate.latex || block.math.latex;
            void compileEditedMath(latex, { ...block, text: candidate.reading, math: { ...block.math, latex, spoken: candidate.reading } });
          } else onChange({ ...block, text: candidate.reading });
        }}>Use this reading</button></div>;
      })}</div>}
      {(block.kind === "graph" || block.kind === "diagram") && <div className="visual-review-card">
        <div><strong>Source image crop</strong><p>Adjust the detected page region if the graph was cropped incorrectly.</p></div>
        <VisualCropImage block={block} documentId={documentId} />
        <div className="crop-controls">
          {(["x", "y", "width", "height"] as const).map((field) => <label key={field}>{field === "x" ? "Left" : field === "y" ? "Top" : field[0].toUpperCase() + field.slice(1)} (%)
            <input type="number" min={field === "width" || field === "height" ? 1 : 0} max="100" step="0.5" value={block.sourceRegion?.[field] ?? (field === "width" || field === "height" ? 100 : 0)} onChange={(event) => updateCrop(field, event.target.value)} />
          </label>)}
        </div>
        <label>Graph alt text<textarea rows={4} value={block.altText ?? ""} onChange={(event) => onChange({ ...block, altText: event.target.value })} /></label>
      </div>}
      <label className="review-checkbox"><input type="checkbox" checked={!block.needsReview} onChange={(event) => onChange({ ...block, needsReview: !event.target.checked })} /> Mark as reviewed</label>
    </section>
  );
}
