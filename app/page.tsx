"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { PipelineList } from "@/components/pipeline-list";
import { saveDraft } from "@/lib/domain/storage";
import { createDemoNote } from "@/lib/demo-note";
import type { ExtractionResult } from "@/lib/domain/note";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function analyze() {
    if (!file) return;
    setState("running"); setError("");
    const form = new FormData(); form.append("file", file);
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
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="action-row"><Button size="lg" disabled={!file || state === "running"} onClick={analyze}>{state === "running" ? "Analyzing…" : "Analyze notes"}</Button><Button size="lg" variant="ghost" onClick={openArchitectureDemo}>Open development fixture</Button></div>
        </section>
        <aside className="secondary-panel"><h2>Extraction pipeline</h2><p>Each stage has its own contract and can be replaced independently.</p><PipelineList running={state === "running"} /></aside>
      </main>
    </AppShell>
  );
}
