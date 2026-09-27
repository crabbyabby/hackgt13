"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
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
    setSelectedBlockIds((ids) => new Set([...ids].filter((id) => !removed.some((block) => block.id === id))));
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

  function selectBlock(id: string, selected: boolean) {
    setSelectedBlockIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id); else next.delete(id);
      return next;
    });
  }

  const mergeSelectedBlocks = useCallback(() => {
    if (!note || selectedBlockIds.size < 2) return;
    const indexed = note.blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => selectedBlockIds.has(block.id));
    if (indexed.length < 2) return;

    const selected = indexed.map(({ block }) => block);
    const base = selected[0];
    const mathBlocks = selected.filter((block) => block.math);
    const sameKind = selected.every((block) => block.kind === base.kind);
    const kind = sameKind && !(base.kind === "equation" && mathBlocks.length > 1)
      ? base.kind
      : "paragraph";
    const paragraphs = selected.map((block) => {
      const parts: string[] = [];
      if (block.title && block.title !== block.text) parts.push(block.title);
      if (block.text.trim()) parts.push(block.text.trim());
      if (block.math && !block.text.includes(block.math.latex) && !block.text.includes(block.math.spoken)) {
        parts.push(`${block.math.spoken} (LaTeX: ${block.math.latex})`);
      }
      if (block.altText) parts.push(`Visual description: ${block.altText}`);
      return parts.join("\n");
    }).filter(Boolean);
    const retainedMath = kind === "equation" && mathBlocks.length === 1 ? mathBlocks[0].math : undefined;
    const merged: NoteBlock = {
      ...base,
      kind,
      title: kind === "heading" ? (base.title ?? paragraphs[0]) : undefined,
      text: paragraphs.join("\n\n"),
      math: retainedMath,
      altText: undefined,
      sourceRegion: undefined,
      confidence: Math.min(...selected.map((block) => block.confidence)),
      needsReview: selected.some((block) => block.needsReview),
      reviewReason: `Merged from ${selected.length} source sections.`,
      interpretations: undefined,
    };
    const insertionIndex = indexed[0].index;
    const remaining = note.blocks.filter((block) => !selectedBlockIds.has(block.id));
    remaining.splice(insertionIndex, 0, merged);
    const next = { ...note, blocks: remaining, updatedAt: new Date().toISOString() };
    setNote(next);
    saveDraft(next);
    setSelectedBlockIds(new Set());
    setUndoMessage(`Merged ${selected.length} sections into one ${kind} block.`);
  }, [note, selectedBlockIds]);

  useEffect(() => {
    function handleMergeShortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "m" || event.ctrlKey || event.metaKey || event.altKey || selectedBlockIds.size < 2) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      mergeSelectedBlocks();
    }
    window.addEventListener("keydown", handleMergeShortcut);
    return () => window.removeEventListener("keydown", handleMergeShortcut);
  }, [mergeSelectedBlocks, selectedBlockIds.size]);

  function moveDraggedBlock(targetId: string, after: boolean) {
    if (!note || !draggedBlockId || draggedBlockId === targetId) return;
    const moved = note.blocks.find((block) => block.id === draggedBlockId);
    if (!moved) return;
    const reordered = note.blocks.filter((block) => block.id !== draggedBlockId);
    const targetIndex = reordered.findIndex((block) => block.id === targetId);
    if (targetIndex < 0) return;
    reordered.splice(targetIndex + (after ? 1 : 0), 0, moved);
    const next = { ...note, blocks: reordered, updatedAt: new Date().toISOString() };
    setNote(next);
    saveDraft(next);
    setDraggedBlockId(null);
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
          <div className="review-toolbar"><div><p className="overline">Semantic document</p><h1>Review and correct</h1><p>Fix uncertain notation and visual descriptions before publishing.</p></div><div className="action-row"><Button variant="outline" onClick={() => router.push("/upload")}>Back</Button><DownloadHtmlButton note={note} includeOriginalPages={false} confirmUnreviewed /><DownloadHtmlButton note={note} confirmUnreviewed /><Button onClick={publish}>Generate reader link</Button></div></div>
          {undoMessage && <div className="review-undo" role="status"><span>{undoMessage}</span>{undoStack.length > 0 && <Button variant="ghost" onClick={undoDeletion}>Undo (Ctrl+Z)</Button>}</div>}
          <label className="title-field">Document title<input value={note.title} onChange={(event) => { const next = { ...note, title: event.target.value }; setNote(next); saveDraft(next); }} /></label>
          <div className="structure-toolbar" aria-label="Section editing tools">
            <span>{selectedBlockIds.size ? `${selectedBlockIds.size} selected` : "Select sections to merge"}</span>
            <Button type="button" variant="outline" disabled={selectedBlockIds.size < 2} onClick={mergeSelectedBlocks} aria-keyshortcuts="M" title="Merge selected sections (M)">Merge selected <kbd>M</kbd></Button>
          </div>
          <div className="editor-stack">{note.blocks.map((block) => <NoteBlockEditor
            key={block.id}
            block={block}
            onChange={updateBlock}
            onDelete={deleteBlock}
            selected={selectedBlockIds.has(block.id)}
            onSelectedChange={selectBlock}
            dragging={draggedBlockId === block.id}
            onDragStart={setDraggedBlockId}
            onDragEnd={() => setDraggedBlockId(null)}
            onDrop={moveDraggedBlock}
          />)}</div>
        </section>
      </main>
    </AppShell>
  );
}
