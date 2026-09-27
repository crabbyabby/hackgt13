"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Code2, FileText, ListChecks, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { NoteBlockEditor } from "@/components/note-block-editor";
import { DownloadHtmlButton } from "@/components/download-html-button";
import { ReviewDocumentPreview } from "@/components/review-document-preview";
import { createDemoNote } from "@/lib/demo-note";
import { loadDraft, saveDraft } from "@/lib/domain/storage";
import { repairAlignedEquations } from "@/lib/reader/repair-equations";
import type { NoteBlock, SemanticNote } from "@/lib/domain/note";
import { confirmWithUnreviewedContent } from "@/lib/domain/review-confirmation";

type DeletedContent = { index: number; blocks: NoteBlock[]; label: string };

export default function ReviewPage() {
  const [note, setNote] = useState<SemanticNote | null>(null);
  const [undoStack, setUndoStack] = useState<DeletedContent[]>([]);
  const [undoMessage, setUndoMessage] = useState("");
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceZoom, setSourceZoom] = useState(1);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const loaded = loadDraft() ?? createDemoNote();
      const { note: draft, repairedIds } = repairAlignedEquations(loaded);
      if (!active) return;
      setNote(draft);
      setActiveBlockId(draft.blocks[0]?.id ?? null);
      if (repairedIds.length) {
        saveDraft(draft);
        for (const id of repairedIds) {
          const block = draft.blocks.find((item) => item.id === id);
          if (!block?.math) continue;
          const latex = block.math.latex;
          void fetch("/api/mathml", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latex }),
          }).then(async (response) => {
            if (!response.ok) return null;
            return await response.json() as { mathml: string | null; mathmlError: string | null; structureWarning: string | null; needsReview: boolean };
          }).then((compiled) => {
            if (!active || !compiled) return;
            setNote((current) => {
              const currentBlock = current?.blocks.find((item) => item.id === id);
              if (!current || currentBlock?.math?.latex !== latex) return current;
              const next = {
                ...current,
                blocks: current.blocks.map((item) => item.id === id && item.math ? {
                  ...item,
                  needsReview: item.needsReview || compiled.needsReview,
                  math: { ...item.math, mathml: compiled.mathml ?? undefined, mathmlError: compiled.mathmlError ?? undefined, structureWarning: compiled.structureWarning ?? undefined },
                } : item),
              };
              saveDraft(next);
              return next;
            });
          }).catch(() => undefined);
        }
      }
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
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

  function activateBlock(id: string) {
    setActiveBlockId(id);
    const page = note?.blocks.find((block) => block.id === id)?.page;
    if (page) setSourcePage(page);
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
      <main className="review-workspace">
        <div className="review-toolbar">
          <div><p className="overline">Review extracted notes</p><h1>Review and correct</h1><p>Compare the source, refine the live document, then approve it.</p></div>
          <div className="review-actions"><span className="review-count"><i />{reviewCount} {reviewCount === 1 ? "item" : "items"} to review</span><Button variant="outline" onClick={() => router.push("/upload")}>Back to upload</Button><DownloadHtmlButton note={note} includeOriginalPages={false} confirmUnreviewed /><DownloadHtmlButton note={note} confirmUnreviewed /><Button onClick={publish}>Approve &amp; continue</Button></div>
        </div>
        {undoMessage && <div className="review-undo" role="status"><span>{undoMessage}</span>{undoStack.length > 0 && <Button variant="ghost" onClick={undoDeletion}>Undo (Ctrl+Z)</Button>}</div>}
        <div className="review-meta-row">
          <label className="review-document-title">Document title<input value={note.title} onChange={(event) => { const next = { ...note, title: event.target.value }; setNote(next); saveDraft(next); }} /></label>
          <div className="structure-toolbar" aria-label="Section editing tools"><span>{selectedBlockIds.size ? `${selectedBlockIds.size} selected` : "Select sections to merge"}</span><Button type="button" variant="outline" disabled={selectedBlockIds.size < 2} onClick={mergeSelectedBlocks} aria-keyshortcuts="M" title="Merge selected sections (M)">Merge selected <kbd>M</kbd></Button></div>
        </div>
        <div className="review-columns">
          <aside className="source-viewer" aria-label="Original source page">
            <header><div><span className="source-viewer-icon"><FileText size={16} aria-hidden="true" /></span><strong>Original {note.source.kind === "pdf" ? "PDF" : "image"}</strong></div><small>{note.source.name}</small></header>
            <div className="source-page-canvas">
              {note.source.documentId ? <img src={`/api/documents/${encodeURIComponent(note.source.documentId)}/pages/${sourcePage}`} alt={`Original notes, page ${sourcePage}`} style={{ width: `${sourceZoom * 100}%` }} /> : <div className="source-page-placeholder"><span>Original page preview</span><p>Source image preview is available for uploaded documents.</p></div>}
            </div>
            <footer className="source-viewer-controls">
              <div className="source-page-navigation"><Button size="icon" variant="ghost" disabled={sourcePage <= 1} onClick={() => setSourcePage((page) => Math.max(1, page - 1))} aria-label="Previous source page"><ChevronLeft /></Button><span>Page {sourcePage} of {note.source.pageCount}</span><Button size="icon" variant="ghost" disabled={sourcePage >= note.source.pageCount} onClick={() => setSourcePage((page) => Math.min(note.source.pageCount, page + 1))} aria-label="Next source page"><ChevronRight /></Button></div>
              <div className="source-zoom-controls"><Button size="icon" variant="ghost" disabled={sourceZoom <= 1} onClick={() => setSourceZoom((zoom) => Math.max(1, Number((zoom - 0.25).toFixed(2))))} aria-label="Zoom out"><ZoomOut /></Button><span>{Math.round(sourceZoom * 100)}%</span><Button size="icon" variant="ghost" disabled={sourceZoom >= 2.5} onClick={() => setSourceZoom((zoom) => Math.min(2.5, Number((zoom + 0.25).toFixed(2))))} aria-label="Zoom in"><ZoomIn /></Button><Button size="icon" variant="ghost" disabled={sourceZoom === 1} onClick={() => setSourceZoom(1)} aria-label="Reset zoom"><RotateCcw /></Button></div>
            </footer>
          </aside>
          <section className="review-preview-panel" aria-label="Live accessible document preview">
            <header className="preview-panel-header"><div><span className="preview-code-icon"><Code2 size={17} aria-hidden="true" /></span><strong>Accessible HTML</strong><span className="draft-pill">Draft</span></div><p>Live preview · Click an equation to edit its LaTeX</p></header>
            <div className="review-preview-scroll"><ReviewDocumentPreview note={note} activeBlockId={activeBlockId} selectedBlockIds={selectedBlockIds} onSelectBlock={activateBlock} onSelectedChange={selectBlock} onDelete={deleteBlock} draggedBlockId={draggedBlockId} onDrop={moveDraggedBlock} /></div>
            <footer><span>HTML document preview</span><span className="saved-state"><i />Changes saved</span></footer>
          </section>
          <aside className="review-inspector" aria-label="Selected content editor">
            <header><div><span className="inspector-icon"><ListChecks size={17} aria-hidden="true" /></span><strong>Review &amp; edit</strong></div><span className="inspector-count" aria-label={`${reviewCount} items needing review`}>{reviewCount}</span></header>
            <div className="inspector-content">
              {activeBlockId && note.blocks.some((block) => block.id === activeBlockId) ? <>
                <p className="inspector-intro">Selected content</p>
                <NoteBlockEditor key={activeBlockId} block={note.blocks.find((block) => block.id === activeBlockId)!} documentId={note.source.documentId} onChange={updateBlock} onDelete={deleteBlock} selected={selectedBlockIds.has(activeBlockId)} onSelectedChange={selectBlock} dragging={draggedBlockId === activeBlockId} onDragStart={setDraggedBlockId} onDragEnd={() => setDraggedBlockId(null)} onDrop={moveDraggedBlock} />
                <p className="inspector-help">Select more content in the preview to merge sections. Click a formula to bring its LaTeX editor here.</p>
              </> : <p className="inspector-empty">Select a heading, paragraph, or equation in the document preview to review it.</p>}
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
