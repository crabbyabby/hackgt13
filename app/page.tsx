"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { PipelineList } from "@/components/pipeline-list";
import { saveDraft } from "@/lib/domain/storage";
import { createDemoNote } from "@/lib/demo-note";
import type { ExtractionResult } from "@/lib/domain/note";

type PdfModel = {
  provider: "openai" | "google" | "xai" | "development";
  id: string;
  label: string;
  description: string;
  recommendedFor: string;
  available: boolean;
};

const fallbackModel: PdfModel = { provider: "development", id: "development-fixture", label: "Development fixture — no API call", description: "Local example output", recommendedFor: "local UI development", available: true };

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [models, setModels] = useState<PdfModel[]>([fallbackModel]);
  const [selection, setSelection] = useState("development:development-fixture");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/pdf-models")
      .then((response) => response.ok ? response.json() as Promise<PdfModel[]> : Promise.reject())
      .then((options) => {
        setModels(options);
        const firstAvailable = options.find((option) => option.available && option.provider !== "development") ?? options.find((option) => option.available) ?? fallbackModel;
        setSelection(`${firstAvailable.provider}:${firstAvailable.id}`);
      })
      .catch(() => setModels([fallbackModel]));
  }, []);

  async function analyze() {
    if (!file) return;
    setState("running"); setError(""); setProgress("Uploading source document…");
    const [provider, model] = selection.split(":", 2);
    const form = new FormData(); form.append("file", file); form.append("provider", provider); form.append("model", model);
    try {
      const uploadResponse = await fetch("/api/documents", { method: "POST", body: form });
      const accepted = await uploadResponse.json() as { id?: string; error?: string };
      if (!uploadResponse.ok || !accepted.id) throw new Error(accepted.error ?? "Upload failed");
      console.info(`[EigenScribe] Document accepted: ${accepted.id}`);
      setProgress(`Document accepted. Waiting for ${model} to inspect the pages…`);

      for (let attempt = 1; attempt <= 450; attempt += 1) {
        const statusResponse = await fetch(`/api/documents/${encodeURIComponent(accepted.id)}`, { cache: "no-store" });
        const document = await statusResponse.json() as { status?: string; processingStage?: string; error?: string; blocks?: unknown[] };
        if (!statusResponse.ok) throw new Error(document.error ?? "Could not read processing status.");
        if (attempt === 1 || attempt % 5 === 0) {
          const elapsed = (attempt - 1) * 2;
          const stage = document.processingStage?.replaceAll("_", " ") ?? document.status ?? "unknown";
          console.info(`[EigenScribe] Poll ${attempt}: status=${document.status} stage=${stage} elapsed≈${elapsed}s`);
          setProgress(`AI processing: ${stage} · ${elapsed}s elapsed…`);
        }
        if (document.status === "failed") throw new Error(document.error ?? "Document processing failed.");
        if (document.status === "needs_review" || document.status === "ready") {
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
    }
  }

  function openSampleNote() {
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
            <div><strong>{file?.name ?? "Choose a PDF or image"}</strong><p>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB selected` : "PDF, PNG, JPG, or HEIC · maximum 20 MB"}</p></div>
            <Button variant="outline" onClick={() => input.current?.click()}>{file ? "Replace" : "Choose file"}</Button>
          </div>
          <label className="model-picker">PDF handwriting model
            <select value={selection} onChange={(event) => setSelection(event.target.value)}>
              {(["openai", "google", "xai", "development"] as const).map((provider) => {
                const providerModels = models.filter((option) => option.provider === provider);
                if (!providerModels.length) return null;
                return <optgroup key={provider} label={provider === "google" ? "Google Gemini" : provider === "xai" ? "xAI Grok" : provider === "openai" ? "OpenAI" : "Local development"}>{providerModels.map((option) => <option key={`${option.provider}:${option.id}`} value={`${option.provider}:${option.id}`} disabled={!option.available}>{option.label}{option.available ? "" : " — API key required"}</option>)}</optgroup>;
              })}
            </select>
            <small>{models.find((option) => `${option.provider}:${option.id}` === selection)?.description}</small>
          </label>
          {error && <p className="error-message" role="alert">{error}</p>}
          {state === "running" && <p className="processing-message" aria-live="polite">{progress}</p>}
          <div className="action-row"><Button size="lg" disabled={!file || state === "running"} onClick={analyze}>{state === "running" ? "Analyzing…" : "Analyze notes"}</Button><Button size="lg" variant="ghost" onClick={openSampleNote}>Open Gram-Schmidt sample</Button></div>
        </section>
        <aside className="secondary-panel"><h2>Extraction pipeline</h2><p>Each stage has its own contract and can be replaced independently.</p><PipelineList running={state === "running"} /></aside>
      </main>
    </AppShell>
  );
}
