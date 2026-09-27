import type { SemanticNote } from "@/lib/domain/note";

export function confirmWithUnreviewedContent(note: SemanticNote, action: string) {
  const count = note.blocks.filter((block) => block.needsReview).length;
  if (!count) return true;
  const noun = count === 1 ? "item is" : "items are";
  return window.confirm(
    `${count} ${noun} still flagged for instructor review. Do you want to ${action} anyway?`,
  );
}
