"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { NoteBlockEditor } from "@/components/note-block-editor";
import { DownloadHtmlButton } from "@/components/download-html-button";
import { createDemoNote } from "@/lib/demo-note";
import { loadDraft, saveDraft } from "@/lib/domain/storage";
import type { NoteBlock, SemanticNote } from "@/lib/domain/note";
import { confirmWithUnreviewedContent } from "@/lib/domain/review-confirmation";

type DeletedContent = { index: number; blocks: NoteBlock[]; label: string };

export default function ReviewPage() {
  const [note, setNote] = useState<SemanticNote | null>(null);
  const [undoStack, setUndoStack] = useState<DeletedContent[]>([]);
  const [undoMessage, setUndoMessage] = useState("");
  const router = useRouter();
  useEffect(() => {
    const timer = window.setTimeout(() => setNote(loadDraft() ?? createDemoNote()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const reviewCount = useMemo(() => note?.blocks.filter((block) => block.needsReview).length ?? 0, [note]);

  function deleteBlock(id: string) {
    if (!note) return;
    const start = note.blocks.findIndex((block) => block.id === id);
    if (start < 0) return;
    const selected = note.blocks[start];
    let end = start + 1;
    if (selected.kind === "heading") {
      while (end < note.blocks.length && note.blocks[end].kind !== "heading") end += 1;
    }
    const removed = note.blocks.slice(start, end);
    const label = selected.title || selected.text || selected.kind;
    setUndoStack((stack) => [...stack, { index: start, blocks: removed, label }]);
    const next = { ...note, blocks: [...note.blocks.slice(0, start), ...note.blocks.slice(end)], updatedAt: new Date().toISOString() };
    setNote(next);
    saveDraft(next);
    setUndoMessage(`Removed ${selected.kind === "heading" ? "section" : "block"}: ${label}. Press Ctrl+Z to undo.`);
  }

  function undoDeletion() {
    if (!note || !undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    const restored = [...note.blocks.slice(0, last.index), ...last.blocks, ...note.blocks.slice(last.index)];
    const next = { ...note, blocks: restored, updatedAt: new Date().toISOString() };
    setNote(next);
    saveDraft(next);
    setUndoStack((stack) => stack.slice(0, -1));
    setUndoMessage(`Restored: ${last.label}.`);
  }

  useEffect(() => {
    function handleUndo(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey || !undoStack.length) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      undoDeletion();
    }
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [note, undoStack]);

  function updateBlock(updated: NoteBlock) {
    if (!note) return;
    const next = { ...note, blocks: note.blocks.map((block) => block.id === updated.id ? updated : block), updatedAt: new Date().toISOString() };
    setNote(next); saveDraft(next);
  }

  function publish() {
    if (!note) return;
    if (!confirmWithUnreviewedContent(note, "generate the reader link")) return;
    const published = { ...note, status: "published" as const, updatedAt: new Date().toISOString() };
    saveDraft(published);
    router.push(`/notes/${published.slug}`);
  }

  if (!note) return <AppShell step="review"><main className="single-column"><p>Loading draft…</p></main></AppShell>;

  return (
    <AppShell step="review">
      <main className="review-layout">
        <aside className="review-summary">
          <p className="overline">Source</p><h2>{note.source.name}</h2><dl><div><dt>Pages</dt><dd>{note.source.pageCount}</dd></div><div><dt>Blocks</dt><dd>{note.blocks.length}</dd></div><div><dt>Needs review</dt><dd>{reviewCount}</dd></div></dl>
          <div className="source-placeholder" aria-label="Source preview placeholder"><span>Page regions</span>{note.blocks.map((block) => <i key={block.id} className={block.needsReview ? "region-review" : ""} />)}</div>
        </aside>
        <section className="review-main">
          <div className="review-toolbar"><div><p className="overline">Semantic document</p><h1>Review and correct</h1><p>Fix uncertain notation and visual descriptions before publishing.</p></div><div className="action-row"><Button variant="outline" onClick={() => router.push("/")}>Back</Button><DownloadHtmlButton note={note} includeOriginalPages={false} confirmUnreviewed /><DownloadHtmlButton note={note} confirmUnreviewed /><Button onClick={publish}>Generate reader link</Button></div></div>
          {undoMessage && <div className="review-undo" role="status"><span>{undoMessage}</span>{undoStack.length > 0 && <Button variant="ghost" onClick={undoDeletion}>Undo (Ctrl+Z)</Button>}</div>}
          <label className="title-field">Document title<input value={note.title} onChange={(event) => { const next = { ...note, title: event.target.value }; setNote(next); saveDraft(next); }} /></label>
          <div className="editor-stack">{note.blocks.map((block) => <NoteBlockEditor key={block.id} block={block} onChange={updateBlock} onDelete={deleteBlock} />)}</div>
        </section>
      </main>
    </AppShell>
  );
}
