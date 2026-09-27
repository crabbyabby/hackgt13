"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Headphones, Mic, Minimize2, PhoneOff, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SemanticNote } from "@/lib/domain/note";
import { useGrokConversation } from "@/lib/voice/grok-realtime";
import { DownloadHtmlButton } from "@/components/download-html-button";

export type CardReadRequest = { index: number; kind: "formula" | "visual"; token: number } | null;

type ReaderControlsProps = {
  note: SemanticNote;
  cardRequest: CardReadRequest;
  onCardReadHandled: () => void;
};

const READER_INTRO_KEY = "eigenscribe.reader-context-menu-intro.v1";
const READER_INTRO_MESSAGE = "Right click on any card to hear it!";

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

function browserFullNarration(note: SemanticNote) {
  const parts = [note.title];
  for (const block of note.blocks) {
    if (block.title) parts.push(block.title);
    if (block.text && (!block.math || block.text.trim() !== block.math.latex.trim())) parts.push(block.text);
    if (block.math) parts.push(block.math.spoken);
    if (block.altText) parts.push(`Visual description. ${block.altText}`);
  }
  return parts.join("\n\n[pause]\n\n");
}

function ReaderControlsInner({ note, cardRequest, onCardReadHandled }: ReaderControlsProps) {
  const [speaking, setSpeaking] = useState(false);
  const [loadingNarration, setLoadingNarration] = useState<"full" | "formula" | "visual" | null>(null);
  const [agentStarting, setAgentStarting] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [message, setMessage] = useState("Choose a listening mode.");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const browserSpeechRunRef = useRef(0);
  const browserPauseRef = useRef<number | null>(null);
  const context = useMemo(() => documentContext(note), [note]);
  const conversation = useGrokConversation({
    onConnect: () => { setAgentStarting(false); setMessage("Grok voice connected."); },
    onDisconnect: () => { setAgentStarting(false); setMessage("Voice conversation ended."); },
    onError: (error) => { setAgentStarting(false); setMessage(`Grok voice error: ${error}`); },
  });

  useEffect(() => () => {
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    browserSpeechRunRef.current += 1;
    if (browserPauseRef.current !== null) window.clearTimeout(browserPauseRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!cardRequest) return;
    acknowledgeCardRequest(cardRequest.index, cardRequest.kind);
    onCardReadHandled();
    // The token represents a deliberate card context-click; callbacks are intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardRequest?.token]);

  function acknowledgeCardRequest(index: number, kind: "formula" | "visual") {
    if (!("speechSynthesis" in window)) {
      void generateNarration(index, kind);
      return;
    }
    browserSpeechRunRef.current += 1;
    window.speechSynthesis.cancel();
    setMessage("Just a second…");
    const acknowledgment = new SpeechSynthesisUtterance("Just a second");
    acknowledgment.rate = 1.04;
    let continued = false;
    const continueToCard = () => {
      if (continued) return;
      continued = true;
      void generateNarration(index, kind);
    };
    acknowledgment.onend = continueToCard;
    acknowledgment.onerror = continueToCard;
    browserPauseRef.current = window.setTimeout(continueToCard, 1400);
    window.speechSynthesis.speak(acknowledgment);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (window.localStorage.getItem(READER_INTRO_KEY)) return;
      window.localStorage.setItem(READER_INTRO_KEY, "played");
      void (async () => {
        try {
          const response = await fetch("/api/voice/onboarding", { cache: "no-store" });
          if (!response.ok) throw new Error("Grok onboarding is unavailable.");
          await playAudio(await response.blob(), "Right-click listening is ready.");
        } catch {
          try { speakWithBrowser(READER_INTRO_MESSAGE, "onboarding"); } catch { /* No speech output is available. */ }
        }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
    // This welcome is deliberately checked once per browser, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function speakWithBrowser(script: string, mode: "full" | "formula" | "visual" | "onboarding") {
    if (!("speechSynthesis" in window)) {
      throw new Error("Neither Grok voice nor browser speech is available.");
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
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        const voiceIndex = mode === "formula" ? 1 : mode === "visual" ? 2 : 0;
        utterance.voice = voices[Math.min(voiceIndex, voices.length - 1)];
      }
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
    setMessage("Grok voice is unavailable — using the default browser voice.");
    speakNext();
  }

  async function playAudio(blob: Blob, playingMessage: string) {
    stopNarration(false);
    const audioUrl = URL.createObjectURL(blob);
    audioUrlRef.current = audioUrl;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.onended = () => {
      setSpeaking(false);
      setMessage("Narration finished.");
      URL.revokeObjectURL(audioUrl);
      audioUrlRef.current = null;
    };
    await audio.play();
    setSpeaking(true);
    setMessage(playingMessage);
  }

  async function generateNarration(blockIndex?: number, cardKind: "formula" | "visual" = "formula") {
    stopNarration(false);
    const mode = blockIndex === undefined ? "full" : cardKind;
    setLoadingNarration(mode);
    setMessage(mode === "full" ? "Writing the full math narration…" : mode === "visual" ? "Preparing this graph description…" : "Preparing this formula for speech…");
    try {
      if (mode === "full") {
        setMessage("Loading the cached multi-voice reading…");
        const runFullBrowserFallback = () => {
          stopNarration(false);
          speakWithBrowser(browserFullNarration(note), "full");
        };
        const narrationResponse = await fetch("/api/voice/narration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        });
        if (!narrationResponse.ok) {
          runFullBrowserFallback();
          return;
        }
        try {
          await playAudio(await narrationResponse.blob(), "Reading notes in the notes voice and mathematics in the formula voice.");
          if (audioRef.current) audioRef.current.onerror = runFullBrowserFallback;
        } catch {
          runFullBrowserFallback();
        }
        return;
      }
      const narrationResponse = await fetch("/api/voice/narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, blockIndex, mode }),
      });
      if (narrationResponse.ok) {
        await playAudio(
          await narrationResponse.blob(),
          mode === "visual" ? "Describing this graph in the visual-description voice." : "Reading the selected formula.",
        );
        return;
      }
      let fallbackScript = mode === "visual"
        ? `Graph description. ${note.blocks[blockIndex!]?.altText ?? note.blocks[blockIndex!]?.text ?? ""}`
        : "";
      if (mode === "formula") {
        const scriptResponse = await fetch("/api/voice/narration-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note, blockIndex, mode }),
        });
        const scriptPayload = await scriptResponse.json() as { script?: string; error?: string };
        fallbackScript = scriptPayload.script ?? "";
      }
      if (!fallbackScript) throw new Error("Narration generation failed.");
      speakWithBrowser(fallbackScript, mode);
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
      const payload = await response.json() as { token?: string; url?: string; voice?: string; error?: string };
      if (!response.ok || !payload.token || !payload.url || !payload.voice) {
        throw new Error(payload.error ?? "Grok voice is not configured. Add XAI_API_KEY to .env.local.");
      }
      await conversation.startSession({
        token: payload.token,
        url: payload.url,
        voice: payload.voice,
        instructions: `You are EigenScribe, an accessible math notes voice guide. Use only the supplied document context. Answer questions about any part of the document and follow navigation requests such as “read the numerator” or “go back to the last formula.” Speak notation explicitly: multiplication as “times,” exponents as “to the power of,” and grouping as “open parenthesis” and “close parenthesis.” Pause naturally at formula boundaries. Never invent missing content.\n\nCOMPLETE DOCUMENT CONTEXT\nTitle: ${note.title}\n${context}`,
      });
    } catch (reason) {
      setAgentStarting(false);
      setMessage(reason instanceof Error ? reason.message : "Could not connect the voice agent.");
    }
  }

  const connected = conversation.status === "connected";
  const conversationLabel = connected
    ? (conversation.isSpeaking ? "Agent is speaking" : "Agent is listening")
    : "Start real-time voice interaction";

  if (collapsed) {
    return (
      <aside className="reader-controls reader-controls-collapsed" aria-label="Listening controls">
        <DownloadHtmlButton note={note} />
        <DownloadHtmlButton note={note} includeOriginalPages={false} />
        <Button onClick={() => setCollapsed(false)} aria-expanded="false">
          <Headphones /> Listen &amp; interact
          {connected && <span className="live-dot" aria-label="Voice conversation connected" />}
        </Button>
      </aside>
    );
  }

  return (
    <aside className="reader-controls" aria-label="Reader controls">
      <div className="reader-controls-header">
        <p className="overline">Listen and interact</p>
        <Button size="icon" variant="ghost" onClick={() => setCollapsed(true)} aria-label="Collapse listening controls" aria-expanded="true"><Minimize2 /></Button>
      </div>
      <section className="voice-mode">
        <span className="mode-number">1</span>
        <div><h2>Read full notes</h2><p>Reads all prose in the notes voice and switches to a distinct formula voice for mathematics. The completed reading is stored for instant replay.</p></div>
        <Button onClick={() => speaking ? stopNarration() : void generateNarration()} disabled={loadingNarration !== null || connected}>
          {loadingNarration === "full" ? <AudioLines className="spin" /> : speaking ? <Square /> : <Headphones />}
          {loadingNarration === "full" ? "Generating…" : speaking ? "Stop" : "Generate and read"}
        </Button>
      </section>

      <section className="voice-mode">
        <span className="mode-number">2</span>
        <div><h2>Read one card</h2><p>Right click a yellow math card to hear the formula, or a green graph card to hear its visual description in a third voice.</p></div>
        {loadingNarration === "formula" && <span className="inline-loading"><AudioLines className="spin" /> Preparing formula…</span>}
        {loadingNarration === "visual" && <span className="inline-loading"><AudioLines className="spin" /> Preparing graph description…</span>}
      </section>

      <section className="voice-mode">
        <span className="mode-number">3</span>
        <div><h2>Talk about the notes</h2><p>Grok voice listens and answers with the entire document as context.</p></div>
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
      <DownloadHtmlButton note={note} />
      <DownloadHtmlButton note={note} includeOriginalPages={false} />
    </aside>
  );
}

export function ReaderControls(props: ReaderControlsProps) {
  return <ReaderControlsInner {...props} />;
}
