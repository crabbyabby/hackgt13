import type { NoteBlock } from "@/lib/domain/note";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NoteBlockEditor({ block, onChange, onDelete }: {
  block: NoteBlock;
  onChange: (block: NoteBlock) => void;
  onDelete?: (id: string) => void;
}) {
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
    <section className={`block-editor ${block.needsReview ? "needs-review" : ""}`} aria-labelledby={`${block.id}-label`}>
      <div className="block-editor-header">
        <div><span className="kind-label" id={`${block.id}-label`}>{block.kind}</span>{block.needsReview && <span className="review-flag">Needs review</span>}</div>
        <div className="block-editor-tools"><span>{Math.round(block.confidence * 100)}% confidence</span>
          {onDelete && <Button className="delete-section" size="icon" variant="ghost" type="button"
            aria-label={`Delete ${block.kind === "heading" ? "section" : "block"}: ${block.title ?? block.text ?? block.kind}`}
            title={block.kind === "heading" ? "Delete this section (Ctrl+Z to undo)" : "Delete this block (Ctrl+Z to undo)"}
            onClick={() => onDelete(block.id)}><Trash2 /></Button>}
        </div>
      </div>
      {block.title !== undefined && <label>Label<input value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })} /></label>}
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
      {(block.kind === "graph" || block.kind === "diagram") && <label>Visual description<textarea rows={3} value={block.altText ?? ""} onChange={(event) => onChange({ ...block, altText: event.target.value })} /></label>}
      <label className="review-checkbox"><input type="checkbox" checked={!block.needsReview} onChange={(event) => onChange({ ...block, needsReview: !event.target.checked })} /> Mark as reviewed</label>
    </section>
  );
}
