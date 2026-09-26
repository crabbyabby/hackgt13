"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { NoteBlockEditor } from "@/components/note-block-editor";
import { createDemoNote } from "@/lib/demo-note";
import { loadDraft, saveDraft } from "@/lib/domain/storage";
import type { NoteBlock, SemanticNote } from "@/lib/domain/note";

export default function ReviewPage() {
  const [note, setNote] = useState<SemanticNote | null>(null);
  const router = useRouter();
  useEffect(() => {
    const timer = window.setTimeout(() => setNote(loadDraft() ?? createDemoNote()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const reviewCount = useMemo(() => note?.blocks.filter((block) => block.needsReview).length ?? 0, [note]);

  function updateBlock(updated: NoteBlock) {
    if (!note) return;
    const next = { ...note, blocks: note.blocks.map((block) => block.id === updated.id ? updated : block), updatedAt: new Date().toISOString() };
    setNote(next); saveDraft(next);
  }

  function publish() {
    if (!note) return;
    const published = { ...note, status: "published" as const, updatedAt: new Date().toISOString() };
    saveDraft(published);
    router.push(`/notes/${published.slug}`);
  }

  if (!note) return <AppShell step="review"><main className="single-column"><p>Loading draft…</p></main></AppShell>;

  return (
    <AppShell step="review">
      <main className="review-layout">
        <aside className="review-summary">
          <p className="overline">Source</p><h2>{note.source.name}</h2><dl><div><dt>Pages</dt><dd>{note.source.pageCount}</dd></div><div><dt>Blocks</dt><dd>{note.blocks.length}</dd></div><div><dt>Needs review</dt><dd>{reviewCount}</dd></div>{note.source.aiProvider && <div><dt>AI provider</dt><dd>{note.source.aiProvider}</dd></div>}{note.source.aiModel && <div><dt>Model</dt><dd>{note.source.aiModel}</dd></div>}</dl>
          <div className="source-placeholder" aria-label="Source preview placeholder"><span>Page regions</span>{note.blocks.map((block) => <i key={block.id} className={block.needsReview ? "region-review" : ""} />)}</div>
        </aside>
        <section className="review-main">
          <div className="review-toolbar"><div><p className="overline">Semantic document</p><h1>Review and correct</h1><p>Fix uncertain notation and visual descriptions before publishing.</p></div><div className="action-row"><Button variant="outline" onClick={() => router.push("/")}>Back</Button><Button onClick={publish}>Generate reader link</Button></div></div>
          <label className="title-field">Document title<input value={note.title} onChange={(event) => { const next = { ...note, title: event.target.value }; setNote(next); saveDraft(next); }} /></label>
          <div className="editor-stack">{note.blocks.map((block) => <NoteBlockEditor key={block.id} block={block} onChange={updateBlock} />)}</div>
        </section>
      </main>
    </AppShell>
  );
}
