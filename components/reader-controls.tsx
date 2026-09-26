"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { AudioLines, Download, Headphones, Mic, PhoneOff, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NoteBlock, SemanticNote } from "@/lib/domain/note";

export type FormulaReadRequest = { index: number; token: number } | null;

type ReaderControlsProps = {
  note: SemanticNote;
  formulaRequest: FormulaReadRequest;
  onFormulaReadHandled: () => void;
};

function documentContext(note: SemanticNote) {
  return note.blocks.map((block, index) => {
    const fields = [`Item ${index + 1}; type: ${block.kind}`, block.title, block.text];
    if (block.math) fields.push(`Formula LaTeX: ${block.math.latex}`, `Spoken form: ${block.math.spoken}`);
    if (block.altText) fields.push(`Visual description: ${block.altText}`);
    return fields.filter(Boolean).join("\n");
  }).join("\n\n");
}

function browserSpeechChunks(script: string) {
  const withPauses = script.replace(/<break[^>]*\/>/gi, "[pause]");
  return withPauses
    .split(/\[pause\]|\n{2,}/i)
    .flatMap((section) => section.match(/[^.!?;]+[.!?;]?/g) ?? [])
    .map((chunk) => chunk.replace(/\[[^\]]+\]/g, "").trim())
    .filter(Boolean);
}

function ReaderControlsInner({ note, formulaRequest, onFormulaReadHandled }: ReaderControlsProps) {
  const [speaking, setSpeaking] = useState(false);
  const [loadingNarration, setLoadingNarration] = useState<"full" | "formula" | null>(null);
  const [agentStarting, setAgentStarting] = useState(false);
  const [message, setMessage] = useState("Choose a listening mode.");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const browserSpeechRunRef = useRef(0);
  const browserPauseRef = useRef<number | null>(null);
  const context = useMemo(() => documentContext(note), [note]);
  const conversation = useConversation({
    onConnect: () => { setAgentStarting(false); setMessage("Voice conversation connected."); },
    onDisconnect: () => { setAgentStarting(false); setMessage("Voice conversation ended."); },
    onError: (error) => { setAgentStarting(false); setMessage(`Voice agent error: ${String(error)}`); },
  });

  useEffect(() => () => {
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    browserSpeechRunRef.current += 1;
    if (browserPauseRef.current !== null) window.clearTimeout(browserPauseRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!formulaRequest) return;
    void generateNarration(formulaRequest.index);
    onFormulaReadHandled();
    // The token represents a deliberate formula click; callbacks are intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulaRequest?.token]);

  function stopNarration(updateMessage = true) {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    browserSpeechRunRef.current += 1;
    if (browserPauseRef.current !== null) window.clearTimeout(browserPauseRef.current);
    browserPauseRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    if (updateMessage) setMessage("Narration stopped.");
  }

  function speakWithBrowser(script: string, mode: "full" | "formula") {
    if (!("speechSynthesis" in window)) {
      throw new Error("Neither ElevenLabs nor browser speech is available.");
    }
    const chunks = browserSpeechChunks(script);
    if (!chunks.length) throw new Error("The narration script is empty.");
    const run = ++browserSpeechRunRef.current;
    let position = 0;

    const speakNext = () => {
      if (run !== browserSpeechRunRef.current) return;
      if (position >= chunks.length) {
        setSpeaking(false);
        setMessage("Browser narration finished.");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[position]);
      utterance.rate = mode === "formula" ? 0.78 : 0.9;
      utterance.onend = () => {
        position += 1;
        browserPauseRef.current = window.setTimeout(speakNext, mode === "formula" ? 450 : 280);
      };
      utterance.onerror = () => {
        if (run !== browserSpeechRunRef.current) return;
        setSpeaking(false);
        setMessage("Browser speech stopped before finishing.");
      };
      window.speechSynthesis.speak(utterance);
    };

    setSpeaking(true);
    setMessage("ElevenLabs is unavailable — using the default browser voice.");
    speakNext();
  }

  async function generateNarration(blockIndex?: number) {
    stopNarration(false);
    const mode = blockIndex === undefined ? "full" : "formula";
    setLoadingNarration(mode);
    setMessage(mode === "full" ? "Writing the full math narration…" : "Preparing this formula for speech…");
    try {
      const scriptResponse = await fetch("/api/voice/narration-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, blockIndex }),
      });
      const scriptPayload = await scriptResponse.json() as { script?: string; error?: string };
      if (!scriptResponse.ok || !scriptPayload.script) {
        throw new Error(scriptPayload.error ?? "Narration script generation failed.");
      }
      setMessage("Generating ElevenLabs MP3…");
      let fallbackStarted = false;
      const runBrowserFallback = () => {
        if (fallbackStarted) return;
        fallbackStarted = true;
        stopNarration(false);
        speakWithBrowser(scriptPayload.script!, mode);
      };
      try {
        const speechResponse = await fetch("/api/voice/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: scriptPayload.script }),
        });
        if (!speechResponse.ok) throw new Error("ElevenLabs is unavailable.");
        const audioUrl = URL.createObjectURL(await speechResponse.blob());
        audioUrlRef.current = audioUrl;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onended = () => {
          setSpeaking(false);
          setMessage("Narration finished.");
          URL.revokeObjectURL(audioUrl);
          audioUrlRef.current = null;
        };
        audio.onerror = runBrowserFallback;
        await audio.play();
        setSpeaking(true);
        setMessage(mode === "full" ? "Reading the full notes." : "Reading the selected formula.");
      } catch {
        runBrowserFallback();
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Narration generation failed.");
    } finally {
      setLoadingNarration(null);
    }
  }

  async function startConversation() {
    setAgentStarting(true);
    setMessage("Connecting the note-aware voice agent…");
    try {
      const response = await fetch("/api/voice/agent", { cache: "no-store" });
      const payload = await response.json() as { signedUrl?: string; error?: string };
      if (!response.ok || !payload.signedUrl) {
        throw new Error(payload.error ?? "Voice agent is not configured.");
      }
      conversation.startSession({
        signedUrl: payload.signedUrl,
        connectionType: "websocket",
        overrides: {
          agent: {
            firstMessage: "I have the complete notes. What would you like me to explain or read?",
            prompt: {
              prompt: `You are EigenScribe, an accessible math notes voice guide. Use only the supplied document context. Answer questions about any part of the document and follow navigation requests such as “read the numerator” or “go back to the last formula.” Speak notation explicitly: multiplication as “times,” exponents as “to the power of,” and grouping as “open parenthesis” and “close parenthesis.” Pause naturally at formula boundaries. Never invent missing content.\n\nCOMPLETE DOCUMENT CONTEXT\nTitle: ${note.title}\n${context}`,
            },
          },
        },
      });
    } catch (reason) {
      setAgentStarting(false);
      setMessage(reason instanceof Error ? reason.message : "Could not connect the voice agent.");
    }
  }

  function download() {
    // Note content is author text, not markup: escaping keeps a stray "<" or "&" from
    // producing an invalid document (WCAG 2.1 SC 4.1.1) or injecting markup.
    const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] as string));
    // Equations ship as MathML so the downloaded file is readable by assistive technology
    // on its own. Unverified notation degrades to labelled source rather than silent LaTeX.
    const formula = (math: NonNullable<NoteBlock["math"]>) =>
      math.mathml && math.mathml.trim().startsWith("<math")
        ? `<figure>${math.mathml}<figcaption class="sr-only">${escape(math.spoken)}</figcaption></figure>`
        : `<p><code>${escape(math.latex)}</code> <em>(unverified notation: ${escape(math.spoken)})</em></p>`;
    const body = note.blocks.map((block) => `<section><h2>${escape(block.title ?? block.kind)}</h2><p>${escape(block.text)}</p>${block.math ? formula(block.math) : ""}${block.altText ? `<p><strong>Visual description:</strong> ${escape(block.altText)}</p>` : ""}</section>`).join("");
    const blob = new Blob([`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(note.title)}</title><style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body><main><h1>${escape(note.title)}</h1>${body}</main></body></html>`], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${note.slug}.html`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Downloaded accessible HTML.");
  }

  const connected = conversation.status === "connected";
  const conversationLabel = connected
    ? (conversation.isSpeaking ? "Agent is speaking" : "Agent is listening")
    : "Start real-time voice interaction";

  return (
    <aside className="reader-controls" aria-label="Reader controls">
      <p className="overline">Listen and interact</p>
      <section className="voice-mode">
        <span className="mode-number">1</span>
        <div><h2>Read full notes</h2><p>Generates one paced MP3, with automatic browser-voice fallback. Longer notes can take a moment.</p></div>
        <Button onClick={() => speaking ? stopNarration() : void generateNarration()} disabled={loadingNarration !== null || connected}>
          {loadingNarration === "full" ? <AudioLines className="spin" /> : speaking ? <Square /> : <Headphones />}
          {loadingNarration === "full" ? "Generating…" : speaking ? "Stop" : "Generate and read"}
        </Button>
      </section>

      <section className="voice-mode">
        <span className="mode-number">2</span>
        <div><h2>Read one formula</h2><p>Click any blue formula. The math LLM adds explicit operators, grouping, powers, and pauses; development mode uses your browser voice.</p></div>
        {loadingNarration === "formula" && <span className="inline-loading"><AudioLines className="spin" /> Preparing formula…</span>}
      </section>

      <section className="voice-mode">
        <span className="mode-number">3</span>
        <div><h2>Talk about the notes</h2><p>The live ElevenLabs agent listens and answers with the entire document as context.</p></div>
        {connected ? (
          <Button variant="outline" onClick={() => conversation.endSession()}><PhoneOff /> End conversation</Button>
        ) : (
          <Button variant="outline" onClick={() => void startConversation()} disabled={agentStarting || loadingNarration !== null}>
            <Mic /> {agentStarting ? "Connecting…" : "Start conversation"}
          </Button>
        )}
        {connected && <span className={`conversation-state ${conversation.isSpeaking ? "speaking" : "listening"}`}>{conversationLabel}</span>}
      </section>

      <p className="reader-status" aria-live="polite">{message}</p>
      <Button variant="ghost" onClick={download}><Download /> Download HTML</Button>
    </aside>
  );
}

export function ReaderControls(props: ReaderControlsProps) {
  return <ConversationProvider><ReaderControlsInner {...props} /></ConversationProvider>;
}
