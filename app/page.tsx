"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpenText, FileText, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDemoNote } from "@/lib/demo-note";
import { saveDraft } from "@/lib/domain/storage";
import { setPendingUpload } from "@/lib/domain/upload-draft";

export default function HomePage() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function chooseFile(file?: File) {
    if (!file) return;
    setPendingUpload(file);
    router.push("/upload");
  }

  function openSampleNote() {
    saveDraft(createDemoNote());
    router.push("/review");
  }

  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link href="/" className="wordmark" aria-label="EigenScribe home">
          <span className="landing-brand-icon"><BookOpenText size={19} aria-hidden="true" /></span>
          EigenScribe
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/upload" className="landing-nav-cta">Open workspace <ArrowRight size={15} aria-hidden="true" /></Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-copy">
            <p className="landing-eyebrow"><span /> Accessible learning, starting with your notes</p>
            <h1 id="hero-title">Your handwritten notes,<br />made <span>clear for everyone.</span></h1>
            <p className="landing-description">Turn lecture notes, equations, and diagrams into structured, accessible course materials that are easier to read, navigate, and hear.</p>
            <div className="landing-benefits" aria-label="What EigenScribe does">
              <span><FileText size={17} aria-hidden="true" /> Keeps the original pages</span>
              <span><BookOpenText size={17} aria-hidden="true" /> Structures text and math</span>
            </div>
          </div>

          <section className="landing-upload-card" aria-labelledby="upload-card-title">
            <div className="landing-card-heading">
              <div className="landing-card-icon"><UploadCloud size={21} aria-hidden="true" /></div>
              <div><h2 id="upload-card-title">Make your notes accessible</h2><p>Start with a PDF or image of your notes.</p></div>
            </div>
            <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/heic,image/heif" className="sr-only" aria-label="Choose notes PDF or image" onChange={(event) => chooseFile(event.target.files?.[0])} />
            <div
              className={`landing-dropzone${dragging ? " is-dragging" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]); }}
            >
              <span className="landing-upload-symbol"><UploadCloud size={25} aria-hidden="true" /></span>
              <strong>Drag and drop your notes here</strong>
              <span className="landing-file-types">PDF or image · up to 20 MB · PDFs up to 25 pages</span>
              <Button size="lg" onClick={() => input.current?.click()}><FileText size={17} aria-hidden="true" /> Choose a file</Button>
              <Button size="lg" variant="ghost" onClick={openSampleNote}>Open Gram-Schmidt sample</Button>
              <span className="landing-upload-hint">Your file opens in the upload workspace before analysis.</span>
            </div>
          </section>
        </section>

        <section className="landing-how" id="how-it-works" aria-labelledby="how-title">
          <div><p className="overline">From page to understanding</p><h2 id="how-title">A clearer way to work with notes</h2></div>
          <div className="landing-steps">
            <article><span>01</span><h3>Upload</h3><p>Add a scan or photo of handwritten notes.</p></article>
            <article><span>02</span><h3>Review</h3><p>Check the structured text, equations, and descriptions.</p></article>
            <article><span>03</span><h3>Read your way</h3><p>Use an accessible document with math and narration support.</p></article>
          </div>
        </section>
      </main>
      <footer className="landing-footer"><span>EigenScribe</span><span>Make knowledge easier to access.</span></footer>
    </div>
  );
}
