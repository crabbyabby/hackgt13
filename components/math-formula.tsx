"use client";

import type { MathNode } from "@/lib/domain/note";
import { MathExpression } from "@/components/math-expression";

/**
 * Renders notation as native MathML, which assistive technology can read as
 * mathematics rather than as a string of backslashes.
 *
 * Raw LaTeX source shown as text fails WCAG 2.1 SC 1.3.1: it looks like an equation
 * to a sighted reader while conveying nothing structural to a screen reader. LaTeX is
 * only shown when the backend could not compile it, and it is then labelled as
 * unverified rather than presented as a finished equation.
 */

/** MathML is generated server-side by latex2mathml; this rejects anything else. */
function safeMathml(mathml: string | undefined): string | null {
  if (!mathml) return null;
  const trimmed = mathml.trim();
  if (!trimmed.startsWith("<math")) return null;
  if (/<\s*script/i.test(trimmed)) return null;
  return trimmed;
}

export function MathFormula({
  math,
  label = "Equation",
  selected = false,
  onPlay,
  annotations = [],
}: {
  math: MathNode;
  label?: "Formula" | "Equation" | "Example";
  selected?: boolean;
  onPlay?: () => void;
  annotations?: string[];
}) {
  const mathml = safeMathml(math.mathml);

  return (
    <section
      className={`reader-equation ${selected ? "current-equation" : ""}`}
      onClick={onPlay}
    >
      <span className="equation-label">{label}</span>
      <div className="math-scroll">
        {mathml ? (
          // The spoken form is attached to a visually hidden description rather than an
          // aria-label, so the MathML tree itself stays available to assistive technology.
          <div className="equation-notation" dangerouslySetInnerHTML={{ __html: mathml }} />
        ) : (
          <div className="equation-notation equation-unverified">
            <MathExpression latex={math.latex} spoken={math.spoken} />
            <p className="equation-warning" role="status">
              This notation could not be verified as MathML and is shown using a visual fallback.
              {math.mathmlError ? ` ${math.mathmlError}` : ""}
            </p>
          </div>
        )}
      </div>
      {math.structureWarning && <p className="equation-warning" role="status">Instructor review needed: {math.structureWarning}</p>}
      <p className="sr-only">{math.spoken}</p>
      {annotations.map((annotation, index) => <p key={`${index}-${annotation}`} className="equation-annotation"><strong>Handwritten annotation:</strong> {annotation}</p>)}
      {onPlay && (
        <button type="button" className="equation-listen" onClick={(event) => { event.stopPropagation(); onPlay(); }}>
          Hear this {label.toLowerCase()}
        </button>
      )}
    </section>
  );
}
