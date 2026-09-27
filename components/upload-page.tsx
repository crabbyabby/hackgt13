"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { PipelineList } from "@/components/pipeline-list";
import { saveDraft } from "@/lib/domain/storage";
import { createDemoNote } from "@/lib/demo-note";
import { takePendingUpload } from "@/lib/domain/upload-draft";
import type { ExtractionResult } from "@/lib/domain/note";

type PdfModel = {
  provider: "openai" | "google" | "xai" | "development";
  id: string;
  label: string;
  description: string;
  recommendedFor: string;
  available: boolean;
};

// Upload directly to the Python service so an intermediate Worker/proxy body limit
// cannot reject files before the backend's configured 20 MiB validation runs.
const PYTHON_BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL ?? "http://127.0.0.1:8000";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(() => takePendingUpload());
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [processingStage, setProcessingStage] = useState("idle");
  const [models, setModels] = useState<PdfModel[]>([]);
  const [selection, setSelection] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/pdf-models")
      .then((response) => response.ok ? response.json() as Promise<PdfModel[]> : Promise.reject())
      .then((options) => {
        const productionOptions = options.filter((option) => option.provider !== "development");
        setModels(productionOptions);
        const firstAvailable = productionOptions.find((option) => option.available);
        setSelection(firstAvailable ? `${firstAvailable.provider}:${firstAvailable.id}` : "");
      })
      .catch(() => setModels([]));
  }, []);

  async function analyze() {
    if (!file) return;
    setState("running"); setError(""); setProgress("Uploading source document…"); setProcessingStage("queued");
    let elapsedTimer: number | undefined;
    const [provider, model] = selection.split(":", 2);
    const form = new FormData(); form.append("file", file); form.append("provider", provider); form.append("model", model);
    try {
      const uploadResponse = await fetch(`${PYTHON_BACKEND_URL}/documents`, { method: "POST", body: form });
      const uploadText = await uploadResponse.text();
      let accepted: { id?: string; error?: string };
      try {
        accepted = JSON.parse(uploadText);
      } catch {
        throw new Error(uploadText || "The upload service returned an unreadable response.");
      }
      if (!uploadResponse.ok || !accepted.id) throw new Error(accepted.error ?? "Upload failed");
      console.info(`[EigenScribe] Document accepted: ${accepted.id}`);
      const processingStartedAt = Date.now();
      let currentStage = "queued";
      const updateProgress = () => {
        const elapsed = Math.floor((Date.now() - processingStartedAt) / 1000);
        setProgress(`AI processing: ${currentStage} · ${elapsed}s elapsed…`);
      };
      updateProgress();
      elapsedTimer = window.setInterval(updateProgress, 1000);

      for (let attempt = 1; attempt <= 450; attempt += 1) {
        const statusResponse = await fetch(`/api/documents/${encodeURIComponent(accepted.id)}`, { cache: "no-store" });
        const document = await statusResponse.json() as { status?: string; processingStage?: string; error?: string; blocks?: unknown[] };
        if (!statusResponse.ok) throw new Error(document.error ?? "Could not read processing status.");
        const rawStage = document.processingStage ?? document.status ?? "unknown";
        if (rawStage !== "failed") setProcessingStage(rawStage);
        const stage = rawStage.replaceAll("_", " ");
        currentStage = stage.toLowerCase() === "ai conversion" ? "AI conversion" : stage;
        const elapsed = Math.floor((Date.now() - processingStartedAt) / 1000);
        if (attempt === 1 || attempt % 5 === 0) console.info(`[EigenScribe] Poll ${attempt}: status=${document.status} stage=${currentStage} elapsed=${elapsed}s`);
        updateProgress();
        if (document.status === "failed") throw new Error(document.error ?? "Document processing failed.");
        if (document.status === "needs_review" || document.status === "ready") {
          setProcessingStage("complete");
          setProgress(`Extraction complete. Preparing ${document.blocks?.length ?? 0} blocks for review…`);
          const noteResponse = await fetch(`/api/documents/${encodeURIComponent(accepted.id)}/semantic-note`, { cache: "no-store" });
          const notePayload = await noteResponse.json() as ExtractionResult["note"] | { error: string };
          if (!noteResponse.ok || "error" in notePayload) throw new Error("error" in notePayload ? notePayload.error : "Could not compile the semantic note.");
          console.info(`[EigenScribe] Processing complete: ${notePayload.blocks.length} semantic blocks`);
          saveDraft(notePayload);
          router.push("/review");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error(`Processing exceeded 15 minutes. Document ${accepted.id} can be resumed from the backend.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The note could not be analyzed.");
      setState("error");
    } finally {
      if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
    }
  }

  function openArchitectureDemo() {
    saveDraft(createDemoNote());
    router.push("/review");
  }

  return (
    <AppShell step="upload">
      <main className="page-grid">
        <section className="primary-panel">
          <div className="page-heading"><p className="overline">New note</p><h1>Upload course notes</h1><p>Start with a PDF or image. The extraction pipeline produces one semantic document for review, publishing, speech, navigation, and download.</p></div>
          <div className="upload-card">
            <input ref={input} type="file" accept="application/pdf,image/*" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <FileUp size={28} />
            <div><strong>{file?.name ?? "Choose a PDF or image"}</strong><p>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB selected` : "PDF (up to 25 pages), PNG, JPG, or HEIC · maximum 20 MB"}</p></div>
            <Button variant="outline" onClick={() => input.current?.click()}>{file ? "Replace" : "Choose file"}</Button>
          </div>
          <label className="model-picker">Processing Model
            <select value={selection} onChange={(event) => setSelection(event.target.value)}>
              {!models.length && <option value="">No processing models configured</option>}
              {(["openai", "google", "xai"] as const).map((provider) => {
                const providerModels = models.filter((option) => option.provider === provider);
                if (!providerModels.length) return null;
                return <optgroup key={provider} label={provider === "google" ? "Google Gemini" : provider === "xai" ? "xAI Grok" : "OpenAI"}>{providerModels.map((option) => <option key={`${option.provider}:${option.id}`} value={`${option.provider}:${option.id}`} disabled={!option.available}>{option.label}{option.available ? "" : " — API key required"}</option>)}</optgroup>;
              })}
            </select>
            <small>{models.find((option) => `${option.provider}:${option.id}` === selection)?.description}</small>
          </label>
          {error && <p className="error-message" role="alert">{error}</p>}
          {state === "running" && <p className="processing-message" aria-live="polite">{progress}</p>}
          <div className="action-row"><Button size="lg" disabled={!file || !selection || state === "running"} onClick={analyze}>{state === "running" ? "Analyzing…" : "Analyze notes"}</Button><Button size="lg" variant="ghost" onClick={openArchitectureDemo}>View sample</Button></div>
        </section>
        <aside className="secondary-panel"><h2>Extraction pipeline</h2><PipelineList processingStage={processingStage} failed={state === "error"} /></aside>
      </main>
    </AppShell>
  );
}
