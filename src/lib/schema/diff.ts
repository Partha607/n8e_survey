/**
 * Human-readable definition diff (FR-INST-05, FR-INST-09): shown before
 * publishing over collected responses and in version history.
 */
import { allQuestions, type InstrumentDefinition } from "./definition";

export type DefinitionDiff = {
  addedQuestions: { key: string; label: string }[];
  removedQuestions: { key: string; label: string }[];
  relabeledQuestions: { key: string; from: string; to: string }[];
  optionChanges: { key: string; added: string[]; removed: string[] }[];
  modeChanged?: { from: string; to: string };
  pageCountChanged?: { from: number; to: number };
  hasChanges: boolean;
};

export function diffDefinitions(
  prev: InstrumentDefinition,
  next: InstrumentDefinition,
): DefinitionDiff {
  const prevQ = new Map(allQuestions(prev).map((q) => [q.key, q]));
  const nextQ = new Map(allQuestions(next).map((q) => [q.key, q]));

  const addedQuestions = [...nextQ.values()]
    .filter((q) => !prevQ.has(q.key))
    .map((q) => ({ key: q.key, label: q.label }));
  const removedQuestions = [...prevQ.values()]
    .filter((q) => !nextQ.has(q.key))
    .map((q) => ({ key: q.key, label: q.label }));

  const relabeledQuestions: DefinitionDiff["relabeledQuestions"] = [];
  const optionChanges: DefinitionDiff["optionChanges"] = [];
  for (const [key, q] of nextQ) {
    const old = prevQ.get(key);
    if (!old) continue;
    if (old.label !== q.label) {
      relabeledQuestions.push({ key, from: old.label, to: q.label });
    }
    const oldOpts = new Set((old.options ?? []).map((o) => o.key));
    const newOpts = new Set((q.options ?? []).map((o) => o.key));
    const added = [...newOpts].filter((k) => !oldOpts.has(k));
    const removed = [...oldOpts].filter((k) => !newOpts.has(k));
    if (added.length || removed.length) optionChanges.push({ key, added, removed });
  }

  const diff: DefinitionDiff = {
    addedQuestions,
    removedQuestions,
    relabeledQuestions,
    optionChanges,
    hasChanges: false,
  };
  if (prev.mode !== next.mode) diff.modeChanged = { from: prev.mode, to: next.mode };
  if (prev.pages.length !== next.pages.length) {
    diff.pageCountChanged = { from: prev.pages.length, to: next.pages.length };
  }
  diff.hasChanges =
    addedQuestions.length > 0 ||
    removedQuestions.length > 0 ||
    relabeledQuestions.length > 0 ||
    optionChanges.length > 0 ||
    !!diff.modeChanged ||
    !!diff.pageCountChanged;
  return diff;
}
