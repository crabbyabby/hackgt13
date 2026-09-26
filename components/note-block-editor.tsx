import type { NoteBlock } from "@/lib/domain/note";

export function NoteBlockEditor({ block, onChange }: { block: NoteBlock; onChange: (block: NoteBlock) => void }) {
  return (
    <section className={`block-editor ${block.needsReview ? "needs-review" : ""}`} aria-labelledby={`${block.id}-label`}>
      <div className="block-editor-header">
        <div><span className="kind-label" id={`${block.id}-label`}>{block.kind}</span>{block.needsReview && <span className="review-flag">Needs review</span>}</div>
        <span>{Math.round(block.confidence * 100)}% confidence</span>
      </div>
      {block.title !== undefined && <label>Label<input value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })} /></label>}
      <label>Content<textarea rows={block.kind === "paragraph" ? 4 : 2} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} /></label>
      {block.math && <div className="two-column-fields"><label>LaTeX<input value={block.math.latex} onChange={(event) => onChange({ ...block, math: { ...block.math!, latex: event.target.value } })} /></label><label>Spoken math<input value={block.math.spoken} onChange={(event) => onChange({ ...block, math: { ...block.math!, spoken: event.target.value } })} /></label></div>}
      {block.interpretations && block.interpretations.length > 1 && <div className="interpretation-list"><strong>Possible interpretations</strong>{block.interpretations.map((candidate, index) => <div key={`${candidate.reading}-${index}`}><span>{Math.round(candidate.confidence * 100)}%</span><p>{candidate.reading}{candidate.latex ? ` · ${candidate.latex}` : ""}</p><small>{candidate.evidence}</small></div>)}</div>}
      {(block.kind === "graph" || block.kind === "diagram") && <label>Visual description<textarea rows={3} value={block.altText ?? ""} onChange={(event) => onChange({ ...block, altText: event.target.value })} /></label>}
      <label className="review-checkbox"><input type="checkbox" checked={!block.needsReview} onChange={(event) => onChange({ ...block, needsReview: !event.target.checked })} /> Mark as reviewed</label>
    </section>
  );
}
