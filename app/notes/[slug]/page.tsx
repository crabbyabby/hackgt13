"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ReaderControls, type CardReadRequest } from "@/components/reader-controls";
import { MathFormula } from "@/components/math-formula";
import { VisualCropImage } from "@/components/visual-crop-image";
import { createDemoNote } from "@/lib/demo-note";
import { loadDraft } from "@/lib/domain/storage";
import type { SemanticNote } from "@/lib/domain/note";
import { buildReaderItems } from "@/lib/reader/presentation";

export default function ReaderPage() {
  const [note, setNote] = useState<SemanticNote | null>(null);
  const [index, setIndex] = useState(0);
  const [cardRequest, setCardRequest] = useState<CardReadRequest>(null);
  const { slug } = useParams<{ slug: string }>();
  useEffect(() => {
    let active = true;
    const draft = loadDraft();
    if (draft?.slug === slug && draft.status === "published") {
      // The reviewer’s latest edits live in this browser draft until persistence is
      // connected. Do not let an older backend extraction overwrite the export source.
      const publishedDraftTimer = window.setTimeout(() => setNote(draft), 0);
      return () => { active = false; window.clearTimeout(publishedDraftTimer); };
    }
    const draftTimer = window.setTimeout(() => {
      if (active && draft?.slug === slug) setNote(draft);
    }, 0);
    fetch(`/api/notes/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<SemanticNote> : Promise.reject())
      .then((published) => { if (active) setNote(published); })
      .catch(() => {
        if (active && draft?.slug !== slug) setNote({ ...createDemoNote(), status: "published" });
      });
    return () => { active = false; window.clearTimeout(draftTimer); };
  }, [slug]);
  if (!note) return <AppShell step="reader"><main className="single-column"><p>Loading note…</p></main></AppShell>;
  const readerItems = buildReaderItems(note);

  return (
    <AppShell step="reader">
      <main className="reader-layout">
        <article className="published-note">
          <header><h1>{note.title}</h1><p>Accessible interactive notes · Right click any math or graph card to listen</p></header>
          <div className="published-content">{readerItems.map((item) => {
            if (item.type === "heading") return <h2 key={`heading-${item.sourceIndex}`}>{item.text}</h2>;
            if (item.type === "prose") return <p key={`prose-${item.sourceIndices[0]}`} className="note-paragraph" aria-label={`Paragraph. ${item.text}`}>{item.text}</p>;
            if (item.type === "visual") return <figure
              key={item.block.id}
              className={`visual-description ${item.sourceIndex === index ? "current-visual" : ""}`}
              tabIndex={0}
              aria-label={`${item.block.kind === "graph" ? "Graph" : "Diagram"}. Right click or press Shift F10 to hear its visual description.`}
              aria-keyshortcuts="Shift+F10"
              title="Right click to hear this graph description"
              onContextMenu={(event) => { event.preventDefault(); setIndex(item.sourceIndex); setCardRequest({ index: item.sourceIndex, kind: "visual", token: Date.now() }); }}
              onKeyDown={(event) => {
                if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                  event.preventDefault();
                  setIndex(item.sourceIndex);
                  setCardRequest({ index: item.sourceIndex, kind: "visual", token: Date.now() });
                }
              }}
            ><VisualCropImage block={item.block} documentId={note.source.documentId} /><figcaption>{item.block.kind === "graph" ? "Graph" : "Diagram"}</figcaption><p>{item.block.altText ?? item.block.text}</p></figure>;
            const selected = item.sourceIndex === index;
            return <MathFormula
              key={item.block.id}
              math={item.block.math!}
              label={item.label}
              annotations={item.annotations}
              selected={selected}
              onPlay={() => { setIndex(item.sourceIndex); setCardRequest({ index: item.sourceIndex, kind: "formula", token: Date.now() }); }}
            />;
          })}</div>
        </article>
        <ReaderControls note={note} cardRequest={cardRequest} onCardReadHandled={() => setCardRequest(null)} />
      </main>
    </AppShell>
  );
}
