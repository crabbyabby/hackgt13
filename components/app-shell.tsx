import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children, step }: { children: ReactNode; step?: "upload" | "review" | "reader" }) {
  const steps = [
    ["upload", "1. Upload"],
    ["review", "2. Review"],
    ["reader", "3. Reader"],
  ] as const;

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link href="/" className="wordmark">EigenScribe</Link>
        <nav aria-label="Workflow">
          {steps.map(([id, label]) => <span key={id} className={step === id ? "active-step" : ""}>{label}</span>)}
        </nav>
      </header>
      {children}
    </div>
  );
}
