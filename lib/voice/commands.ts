export type ReaderCommand =
  | { type: "read-current" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "read-again" }
  | { type: "describe-visual" }
  | { type: "download" }
  | { type: "unknown"; transcript: string };

export function parseReaderCommand(transcript: string): ReaderCommand {
  const value = transcript.toLowerCase().trim();
  if (/\b(next|continue|move forward)\b/.test(value)) return { type: "next" };
  if (/\b(previous|go back|move back)\b/.test(value)) return { type: "previous" };
  if (/\b(again|repeat)\b/.test(value)) return { type: "read-again" };
  if (/\b(describe|diagram|graph|visual)\b/.test(value)) return { type: "describe-visual" };
  if (/\b(download|save)\b/.test(value)) return { type: "download" };
  if (/\b(read|listen|speak)\b/.test(value)) return { type: "read-current" };
  return { type: "unknown", transcript };
}
