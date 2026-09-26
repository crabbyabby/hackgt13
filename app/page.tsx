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
    setState("running"); setError("");
    const [provider, model] = selection.split(":", 2);
    const form = new FormData(); form.append("file", file); form.append("provider", provider); form.append("model", model);
    try {
      const response = await fetch("/api/extract", { method: "POST", body: form });
      const payload = await response.json() as ExtractionResult | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Analysis failed");
      saveDraft(payload.note);
      router.push("/review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The note could not be analyzed.");
      setState("error");
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
          <div className="action-row"><Button size="lg" disabled={!file || state === "running"} onClick={analyze}>{state === "running" ? "Analyzing…" : "Analyze notes"}</Button><Button size="lg" variant="ghost" onClick={openArchitectureDemo}>Open development fixture</Button></div>
        </section>
        <aside className="secondary-panel"><h2>Extraction pipeline</h2><p>Each stage has its own contract and can be replaced independently.</p><PipelineList running={state === "running"} /></aside>
      </main>
    </AppShell>
  );
}
