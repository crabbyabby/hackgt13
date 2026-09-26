"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseReaderCommand } from "@/lib/voice/commands";
import type { NoteBlock, SemanticNote } from "@/lib/domain/note";

function speechFor(block: NoteBlock) { return block.math?.spoken ?? block.altText ?? block.text; }

export function ReaderControls({ note, index, setIndex }: { note: SemanticNote; index: number; setIndex: (index: number) => void }) {
  const [speaking, setSpeaking] = useState(false);
  const [command, setCommand] = useState("");
  const [message, setMessage] = useState("Ready");
  const current = note.blocks[index];

  function speak(block = current) {
    if (!("speechSynthesis" in window)) { setMessage("Speech is unavailable in this browser."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechFor(block));
    utterance.rate = 0.88; utterance.onend = () => setSpeaking(false);
    setSpeaking(true); setMessage(`Reading ${block.kind}`); window.speechSynthesis.speak(utterance);
  }

  function stop() { window.speechSynthesis?.cancel(); setSpeaking(false); setMessage("Stopped"); }
  function move(delta: number) { const next = Math.max(0, Math.min(note.blocks.length - 1, index + delta)); setIndex(next); setMessage(`Moved to item ${next + 1}`); }
  function download() {
    const body = note.blocks.map((block) => `<section><h2>${block.title ?? block.kind}</h2><p>${block.text}</p>${block.math ? `<p aria-label="${block.math.spoken}">${block.math.latex}</p>` : ""}${block.altText ? `<p><strong>Visual description:</strong> ${block.altText}</p>` : ""}</section>`).join("");
    const blob = new Blob([`<!doctype html><html lang="en"><meta charset="utf-8"><title>${note.title}</title><main><h1>${note.title}</h1>${body}</main></html>`], { type: "text/html" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${note.slug}.html`; link.click(); URL.revokeObjectURL(url); setMessage("Downloaded accessible HTML");
  }

  function runCommand() {
    const parsed = parseReaderCommand(command);
    if (parsed.type === "next") move(1);
    else if (parsed.type === "previous") move(-1);
    else if (parsed.type === "read-current" || parsed.type === "read-again") speak();
    else if (parsed.type === "describe-visual") { const visual = note.blocks.findIndex((block) => block.kind === "graph" || block.kind === "diagram"); if (visual >= 0) { setIndex(visual); speak(note.blocks[visual]); } else setMessage("No visual found"); }
    else if (parsed.type === "download") download();
    else setMessage(`Command not recognized: ${parsed.transcript}`);
    setCommand("");
  }

  return (
    <aside className="reader-controls" aria-label="Reader controls">
      <p className="overline">Listening controls</p><h2>Item {index + 1} of {note.blocks.length}</h2>
      <div className="control-row"><Button size="icon" variant="outline" onClick={() => move(-1)} disabled={index === 0} aria-label="Previous item"><ChevronLeft /></Button><Button size="icon" onClick={() => speaking ? stop() : speak()} aria-label={speaking ? "Stop" : "Read current item"}>{speaking ? <Square /> : <Play />}</Button><Button size="icon" variant="outline" onClick={() => move(1)} disabled={index === note.blocks.length - 1} aria-label="Next item"><ChevronRight /></Button></div>
      <p className="reader-status" aria-live="polite">{message}</p>
      <label>Command<input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runCommand(); }} placeholder="Try “describe the graph”" /></label>
      <Button variant="outline" onClick={runCommand} disabled={!command}>Run command</Button>
      <Button variant="ghost" onClick={download}><Download /> Download HTML</Button>
      <p className="architecture-note">This command surface and the future realtime voice agent use the same navigation actions.</p>
    </aside>
  );
}
