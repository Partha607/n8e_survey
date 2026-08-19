/**
 * The engine (BUILD-PLAN §3.3) — pure, isomorphic. Zero DOM/DB imports.
 * One implementation serves respondent client, builder preview, and the API
 * (FR-LOG-02). Semantics locked here — do not improvise:
 *
 * - Rules evaluate IN ORDER after every answer change.
 * - A question targeted by any show_question rule is hidden by default;
 *   otherwise visible by default. Show/hide apply in rule order; last wins.
 * - disqualify/end: processing stops at the first fired disqualify/end rule
 *   (later rules do not apply).
 * - skip_to_page: pages strictly between the rule's anchor page (the last
 *   page its condition references) and the target page become unreachable;
 *   their questions are treated as hidden.
 * - Hidden answers are STRIPPED server-side to a fixpoint: a stored response
 *   never contains an answer to a question invisible under its own answers
 *   (FR-LOG-03).
 * - Scoring runs at completion only, server-side (FR-LOG-05).
 */
import {
  questionPageIndex,
  type Clause,
  type Condition,
  type InstrumentDefinition,
} from "../schema/definition";

export type AnswerValue = string | number | string[] | null;
export type Answers = Record<string, AnswerValue>;

export type EvaluationResult = {
  /** question keys visible under `answers` (shown ∧ reachable) */
  visible: string[];
  /** question keys hidden by rules or unreachable via skips */
  hidden: string[];
  /** page keys made unreachable by fired skip rules */
  unreachablePages: string[];
  disqualified: boolean;
  ended: boolean;
  /** rule ids that fired, in evaluation order (builder logic trace, FR-BLD-03) */
  firedRules: string[];
};

export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true; // numbers (including 0) count as answered
}

function evaluateClause(clause: Clause, answers: Answers): boolean {
  const value = answers[clause.q];
  switch (clause.cmp) {
    case "answered":
      return isAnswered(value);
    case "not_answered":
      return !isAnswered(value);
    case "eq":
      if (Array.isArray(value)) return value.includes(String(clause.value));
      // loose across string/number so "5" (UI) matches 5 (schema) deliberately
      return isAnswered(value) && String(value) === String(clause.value);
    case "neq":
      if (Array.isArray(value)) return !value.includes(String(clause.value));
      return !isAnswered(value) || String(value) !== String(clause.value);
    case "in": {
      const list = Array.isArray(clause.value) ? clause.value.map(String) : [];
      if (Array.isArray(value)) return value.some((v) => list.includes(String(v)));
      return isAnswered(value) && list.includes(String(value));
    }
    case "contains":
      if (Array.isArray(value)) return value.includes(String(clause.value));
      return (
        typeof value === "string" &&
        value.toLowerCase().includes(String(clause.value).toLowerCase())
      );
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const n = typeof value === "number" ? value : Number(value);
      const target = Number(clause.value);
      if (!isAnswered(value) || Number.isNaN(n) || Number.isNaN(target)) return false;
      if (clause.cmp === "gt") return n > target;
      if (clause.cmp === "lt") return n < target;
      if (clause.cmp === "gte") return n >= target;
      return n <= target;
    }
  }
}

export function evaluateCondition(cond: Condition, answers: Answers): boolean {
  return cond.op === "and"
    ? cond.clauses.every((c) => evaluateClause(c, answers))
    : cond.clauses.some((c) => evaluateClause(c, answers));
}

export function evaluate(def: InstrumentDefinition, answers: Answers): EvaluationResult {
  // defaults: show-targets start hidden
  const showTargets = new Set(
    def.logic
      .filter((r) => r.action.kind === "show_question" && r.action.target)
      .map((r) => r.action.target!),
  );
  const shown = new Map<string, boolean>();
  for (const page of def.pages) {
    for (const q of page.questions) {
      shown.set(q.key, !showTargets.has(q.key));
    }
  }

  const unreachablePages = new Set<string>();
  const firedRules: string[] = [];
  let disqualified = false;
  let ended = false;

  for (const rule of def.logic) {
    if (!evaluateCondition(rule.when, answers)) continue;
    firedRules.push(rule.id);
    const { kind, target } = rule.action;
    if (kind === "show_question" && target) shown.set(target, true);
    else if (kind === "hide_question" && target) shown.set(target, false);
    else if (kind === "skip_to_page" && target) {
      const anchorIdx = Math.max(
        0,
        ...rule.when.clauses.map((c) => questionPageIndex(def, c.q)),
      );
      const targetIdx = def.pages.findIndex((p) => p.key === target);
      for (let i = anchorIdx + 1; i < targetIdx; i++) {
        unreachablePages.add(def.pages[i].key);
      }
    } else if (kind === "disqualify") {
      disqualified = true;
      break; // stop processing further rules
    } else if (kind === "end") {
      ended = true;
      break;
    }
  }

  const visible: string[] = [];
  const hidden: string[] = [];
  for (const page of def.pages) {
    const pageUnreachable = unreachablePages.has(page.key);
    for (const q of page.questions) {
      if (!pageUnreachable && shown.get(q.key)) visible.push(q.key);
      else hidden.push(q.key);
    }
  }

  return {
    visible,
    hidden,
    unreachablePages: [...unreachablePages],
    disqualified,
    ended,
    firedRules,
  };
}

/**
 * Strip answers of hidden questions to a FIXPOINT (FR-LOG-03): removing an
 * answer can change visibility, so re-evaluate until stable. Bounded by the
 * number of answers. Returns the cleaned answers and the keys removed.
 */
export function stripHiddenAnswers(
  def: InstrumentDefinition,
  answers: Answers,
): { answers: Answers; stripped: string[] } {
  const cleaned: Answers = { ...answers };
  const strippedKeys = new Set<string>();
  for (let i = 0; i <= Object.keys(answers).length; i++) {
    const evaluation = evaluate(def, cleaned);
    const hiddenSet = new Set(evaluation.hidden);
    const toStrip = Object.keys(cleaned).filter((k) => hiddenSet.has(k));
    if (toStrip.length === 0) break;
    for (const key of toStrip) {
      delete cleaned[key];
      strippedKeys.add(key);
    }
  }
  return { answers: cleaned, stripped: [...strippedKeys] };
}

export type Score = {
  total: number;
  perQuestion: Record<string, number>;
  band: { key: string; label: string; description?: string } | null;
};

/** Quiz scoring — completion-time only, server-side (FR-LOG-05). */
export function computeScore(def: InstrumentDefinition, answers: Answers): Score | null {
  if (!def.scoring) return null;
  const perQuestion: Record<string, number> = {};
  let total = 0;
  for (const [qKey, optPoints] of Object.entries(def.scoring.points)) {
    const answer = answers[qKey];
    let points = 0;
    if (Array.isArray(answer)) {
      for (const opt of answer) points += optPoints[opt] ?? 0;
    } else if (isAnswered(answer)) {
      points = optPoints[String(answer)] ?? 0;
    }
    perQuestion[qKey] = points;
    total += points;
  }
  const band = def.scoring.bands.find((b) => total >= b.min && total <= b.max) ?? null;
  return {
    total,
    perQuestion,
    band: band
      ? { key: band.key, label: band.label, description: band.description }
      : null,
  };
}

/**
 * Ordered list of visible questions (navigation source of truth for both
 * shells — component logic never decides targets, BUILD-PLAN §6.1).
 */
export function visibleQuestionOrder(
  def: InstrumentDefinition,
  answers: Answers,
): string[] {
  return evaluate(def, answers).visible;
}
