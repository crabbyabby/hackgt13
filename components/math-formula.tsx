"use client";

import type { MathNode } from "@/lib/domain/note";

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

export function MathFormula({ math, onPlay }: { math: MathNode; onPlay?: () => void }) {
  const mathml = safeMathml(math.mathml);

  return (
    <div className="reader-equation">
      {mathml ? (
        // The spoken form is attached to a visually hidden description rather than an
        // aria-label, so the MathML tree itself stays available to assistive technology.
        <div className="equation-notation" dangerouslySetInnerHTML={{ __html: mathml }} />
      ) : (
        <div className="equation-notation equation-unverified">
          <code>{math.latex}</code>
          <p className="equation-warning" role="status">
            This notation could not be verified and is shown as unconverted source.
            {math.mathmlError ? ` ${math.mathmlError}` : ""}
          </p>
        </div>
      )}
      <p className="sr-only">{math.spoken}</p>
      {onPlay && (
        <button type="button" className="equation-listen" onClick={(event) => { event.stopPropagation(); onPlay(); }}>
          Hear this formula
        </button>
      )}
    </div>
  );
}
