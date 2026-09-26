"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ReaderControls, type FormulaReadRequest } from "@/components/reader-controls";
import { createDemoNote } from "@/lib/demo-note";
import { loadDraft } from "@/lib/domain/storage";
import type { SemanticNote } from "@/lib/domain/note";

export default function ReaderPage() {
  const [note, setNote] = useState<SemanticNote | null>(null);
  const [index, setIndex] = useState(0);
  const [formulaRequest, setFormulaRequest] = useState<FormulaReadRequest>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNote(loadDraft() ?? { ...createDemoNote(), status: "published" }), 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (!note) return <AppShell step="reader"><main className="single-column"><p>Loading note…</p></main></AppShell>;

  return (
    <AppShell step="reader">
      <main className="reader-layout">
        <article className="published-note">
          <header><p className="overline">{note.course}</p><h1>{note.title}</h1><p>Accessible interactive note · {note.blocks.length} items</p></header>
          <div className="published-blocks">{note.blocks.map((block, blockIndex) => <section key={block.id} className={blockIndex === index ? "current-block" : ""} onClick={() => setIndex(blockIndex)} tabIndex={0} aria-current={blockIndex === index ? "true" : undefined}>
            <span className="kind-label">{block.kind}</span>{block.title && <h2>{block.title}</h2>}<p>{block.text}</p>
            {block.math && <button className="reader-equation" type="button" aria-label={`Read formula: ${block.math.spoken}`} onClick={(event) => { event.stopPropagation(); setIndex(blockIndex); setFormulaRequest({ index: blockIndex, token: Date.now() }); }}><span>{block.math.latex}</span><small>Click to hear this formula</small></button>}
            {block.altText && <div className="visual-description"><strong>Visual description</strong><p>{block.altText}</p></div>}
          </section>)}</div>
        </article>
        <ReaderControls note={note} formulaRequest={formulaRequest} onFormulaReadHandled={() => setFormulaRequest(null)} />
      </main>
    </AppShell>
  );
}
