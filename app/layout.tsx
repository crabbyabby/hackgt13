import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "EigenScribe",
  description: "Accessible, semantic, interactive math notes.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    // Bump this content-derived URL whenever the public favicon changes so browsers
    // cannot keep displaying an older cached version after deployment.
    icon: "/favicon.svg?v=63b5f910",
    shortcut: "/favicon.svg?v=63b5f910",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
