"use client";

import { useMemo } from "react";
import katex from "katex";

export function MathExpression({ latex, spoken }: { latex: string; spoken: string }) {
  const rendered = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        output: "htmlAndMathml",
        strict: "ignore",
        throwOnError: true,
        trust: false,
      });
    } catch (error) {
      console.warn("[EigenScribe] KaTeX could not render formula; using spoken fallback", {
        latex,
        error,
      });
      return null;
    }
  }, [latex]);

  if (!rendered) return <span className="math-spoken-fallback">{spoken}</span>;
  return <span className="math-typeset" aria-hidden="true" dangerouslySetInnerHTML={{ __html: rendered }} />;
}
