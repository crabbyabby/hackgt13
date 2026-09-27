"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SemanticNote } from "@/lib/domain/note";
import { downloadStandaloneHtml } from "@/lib/export/html";
import { confirmWithUnreviewedContent } from "@/lib/domain/review-confirmation";

export function DownloadHtmlButton({ note, includeOriginalPages = true, confirmUnreviewed = true }: {
  note: SemanticNote;
  includeOriginalPages?: boolean;
  confirmUnreviewed?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    if (confirmUnreviewed && !confirmWithUnreviewedContent(note, "download the HTML")) return;
    setBusy(true);
    setError("");
    try {
      await downloadStandaloneHtml(note, { includeOriginalPages });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the HTML download.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Button variant="outline" onClick={() => void download()} disabled={busy}>
      <Download /> {busy ? "Preparing download…" : includeOriginalPages ? "Download HTML + original pages" : "Download HTML"}
    </Button>
    {error && <p className="error-message" role="alert">{error}</p>}
  </>;
}
