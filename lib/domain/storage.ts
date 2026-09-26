import type { SemanticNote } from "./note";

export const DRAFT_STORAGE_KEY = "eigenscribe.current-draft";

export function saveDraft(note: SemanticNote) {
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(note));
}

export function loadDraft(): SemanticNote | null {
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SemanticNote; } catch { return null; }
}
