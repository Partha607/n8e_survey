/**
 * Publish-time invariants (BUILD-PLAN §3.2, FR-INST-03) — server-enforced,
 * rejected with field-level errors. Never weaken these (CLAUDE.md rule 4).
 */
import {
  CHOICE_TYPES,
  allQuestions,
  questionPageIndex,
  type InstrumentDefinition,
} from "./definition";

export type FieldErrors = Record<string, string>;

export type InvariantResult = { ok: true } | { ok: false; fieldErrors: FieldErrors };

export function validatePublishInvariants(
  def: InstrumentDefinition,
  previous?: InstrumentDefinition | null,
): InvariantResult {
  const errors: FieldErrors = {};

  // ≥1 page with ≥1 question
  if (!def.pages.some((p) => p.questions.length > 0)) {
    errors["pages"] = "an instrument needs at least one page with one question";
  }

  // unique page keys
  const pageKeys = new Set<string>();
  def.pages.forEach((p, pi) => {
    if (pageKeys.has(p.key)) errors[`pages[${pi}].key`] = `duplicate page key "${p.key}"`;
    pageKeys.add(p.key);
  });

  // unique question keys across the instrument; option keys within a question;
  // choice questions need options; likert needs matrix
  const questionKeys = new Set<string>();
  def.pages.forEach((p, pi) => {
    p.questions.forEach((q, qi) => {
      const path = `pages[${pi}].questions[${qi}]`;
      if (questionKeys.has(q.key)) errors[`${path}.key`] = `duplicate key "${q.key}"`;
      questionKeys.add(q.key);
      if (pageKeys.has(q.key)) {
        errors[`${path}.key`] = `key "${q.key}" collides with a page key`;
      }

      if (CHOICE_TYPES.has(q.type)) {
        if (!q.options || q.options.length < 1) {
          errors[`${path}.options`] = "choice questions need at least one option";
        } else {
          const optKeys = new Set<string>();
          q.options.forEach((o, oi) => {
            if (optKeys.has(o.key))
              errors[`${path}.options[${oi}].key`] = `duplicate option key "${o.key}"`;
            optKeys.add(o.key);
          });
        }
      }
      if (q.type === "likert_matrix" && !q.matrix) {
        errors[`${path}.matrix`] = "likert questions need matrix rows and scale";
      }
    });
  });

  // logic references resolve; skip targets jump forward; show/hide graph acyclic
  const showHideEdges = new Map<string, Set<string>>(); // condition q → target q
  def.logic.forEach((rule, ri) => {
    const path = `logic[${ri}]`;
    rule.when.clauses.forEach((c, ci) => {
      if (!questionKeys.has(c.q)) {
        errors[`${path}.when.clauses[${ci}].q`] = `unknown question key "${c.q}"`;
      }
    });
    const { kind, target } = rule.action;
    if (kind === "show_question" || kind === "hide_question") {
      if (!target || !questionKeys.has(target)) {
        errors[`${path}.action.target`] = `unknown question key "${target ?? ""}"`;
      } else {
        for (const c of rule.when.clauses) {
          if (!questionKeys.has(c.q)) continue;
          if (!showHideEdges.has(c.q)) showHideEdges.set(c.q, new Set());
          showHideEdges.get(c.q)!.add(target);
        }
      }
    } else if (kind === "skip_to_page") {
      if (!target || !pageKeys.has(target)) {
        errors[`${path}.action.target`] = `unknown page key "${target ?? ""}"`;
      } else {
        const targetIdx = def.pages.findIndex((p) => p.key === target);
        const anchorIdx = Math.max(
          0,
          ...rule.when.clauses.map((c) => questionPageIndex(def, c.q)),
        );
        if (targetIdx <= anchorIdx) {
          errors[`${path}.action.target`] =
            "skip must target a page after the questions it depends on (no backward jumps)";
        }
      }
    }
  });

  // cycle detection over show/hide dependency edges
  const visiting = new Set<string>();
  const done = new Set<string>();
  const findCycle = (node: string): boolean => {
    if (done.has(node)) return false;
    if (visiting.has(node)) return true;
    visiting.add(node);
    for (const next of showHideEdges.get(node) ?? []) {
      if (findCycle(next)) return true;
    }
    visiting.delete(node);
    done.add(node);
    return false;
  };
  for (const node of showHideEdges.keys()) {
    if (findCycle(node)) {
      errors["logic"] = `visibility rules form a cycle involving "${node}"`;
      break;
    }
  }

  // scoring references resolve
  if (def.scoring) {
    const byKey = new Map(allQuestions(def).map((q) => [q.key, q]));
    for (const [qKey, optPoints] of Object.entries(def.scoring.points)) {
      const q = byKey.get(qKey);
      if (!q) {
        errors[`scoring.points.${qKey}`] = `unknown question key "${qKey}"`;
        continue;
      }
      const optKeys = new Set((q.options ?? []).map((o) => o.key));
      for (const oKey of Object.keys(optPoints)) {
        if (!optKeys.has(oKey)) {
          errors[`scoring.points.${qKey}.${oKey}`] = `unknown option key "${oKey}"`;
        }
      }
    }
  }

  // key-rename detection vs the previous published version (FR-INST-03):
  // a question that keeps label+type but changes key is a rename — keys are
  // stable identity, so this is rejected, not warned.
  if (previous) {
    const prevByKey = new Map(allQuestions(previous).map((q) => [q.key, q]));
    const nextKeys = new Set(allQuestions(def).map((q) => q.key));
    const removed = [...prevByKey.values()].filter((q) => !nextKeys.has(q.key));
    for (const gone of removed) {
      const reincarnated = allQuestions(def).find(
        (q) => !prevByKey.has(q.key) && q.label === gone.label && q.type === gone.type,
      );
      if (reincarnated) {
        errors[`questions.${reincarnated.key}`] =
          `"${gone.label}" appears renamed from key "${gone.key}" to "${reincarnated.key}" — keys are stable identity; keep the key, or change the question's meaning under a new key`;
      }
    }
  }

  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : { ok: true };
}
