/**
 * Golden vector runner — shared by the unit suite here and the API parity
 * suite (Phase 2.4), so client and server provably run the same engine
 * (FR-LOG-02). Every field bug becomes a new vector before its fix merges
 * (NFR-MNT-02).
 */
import {
  clauseSchema,
  instrumentDefinitionSchema,
  type InstrumentDefinition,
} from "../schema/definition";
import {
  computeScore,
  evaluate,
  evaluateCondition,
  stripHiddenAnswers,
  type Answers,
} from "./index";
import rawVectors from "./vectors.json";

export type Vector = {
  name: string;
  def: string;
  answers: Answers;
  expect: {
    visibleIncludes?: string[];
    hiddenIncludes?: string[];
    unreachablePages?: string[];
    disqualified?: boolean;
    ended?: boolean;
    fired?: string[];
    clause?: unknown;
    result?: boolean;
    strippedAnswers?: Answers;
    strippedKeys?: string[];
    score?: {
      total: number;
      band: string | null;
      perQuestion?: Record<string, number>;
    };
  };
};

export function loadVectors(): {
  definitions: Record<string, InstrumentDefinition>;
  vectors: Vector[];
} {
  const definitions: Record<string, InstrumentDefinition> = {};
  for (const [name, def] of Object.entries(rawVectors.definitions)) {
    definitions[name] = instrumentDefinitionSchema.parse(def);
  }
  return { definitions, vectors: rawVectors.vectors as Vector[] };
}

export type VectorFailure = { vector: string; problem: string };

/** Runs one vector; returns failures (empty = pass). Pure — usable client & server. */
export function runVector(
  definitions: Record<string, InstrumentDefinition>,
  vector: Vector,
): VectorFailure[] {
  const failures: VectorFailure[] = [];
  const fail = (problem: string) => failures.push({ vector: vector.name, problem });
  const def = definitions[vector.def];
  if (!def) return [{ vector: vector.name, problem: `unknown definition ${vector.def}` }];
  const expect = vector.expect;

  if (expect.clause) {
    const clause = clauseSchema.parse(expect.clause);
    const got = evaluateCondition({ op: "and", clauses: [clause] }, vector.answers);
    if (got !== expect.result) fail(`clause result ${got}, expected ${expect.result}`);
    return failures;
  }

  const result = evaluate(def, vector.answers);
  for (const key of expect.visibleIncludes ?? []) {
    if (!result.visible.includes(key)) fail(`expected ${key} visible`);
  }
  for (const key of expect.hiddenIncludes ?? []) {
    if (!result.hidden.includes(key)) fail(`expected ${key} hidden`);
  }
  if (expect.unreachablePages) {
    const got = [...result.unreachablePages].sort();
    const want = [...expect.unreachablePages].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`unreachable pages ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
  if (expect.disqualified !== undefined && result.disqualified !== expect.disqualified) {
    fail(`disqualified ${result.disqualified}, expected ${expect.disqualified}`);
  }
  if (expect.ended !== undefined && result.ended !== expect.ended) {
    fail(`ended ${result.ended}, expected ${expect.ended}`);
  }
  if (expect.fired) {
    if (JSON.stringify(result.firedRules) !== JSON.stringify(expect.fired)) {
      fail(
        `fired ${JSON.stringify(result.firedRules)}, expected ${JSON.stringify(expect.fired)}`,
      );
    }
  }
  if (expect.strippedAnswers || expect.strippedKeys) {
    const stripped = stripHiddenAnswers(def, vector.answers);
    if (
      expect.strippedAnswers &&
      JSON.stringify(stripped.answers) !== JSON.stringify(expect.strippedAnswers)
    ) {
      fail(
        `stripped answers ${JSON.stringify(stripped.answers)}, expected ${JSON.stringify(expect.strippedAnswers)}`,
      );
    }
    if (expect.strippedKeys) {
      const got = [...stripped.stripped].sort();
      const want = [...expect.strippedKeys].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fail(`stripped keys ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      }
    }
  }
  if (expect.score) {
    const score = computeScore(def, vector.answers);
    if (!score) {
      fail("expected a score, got null");
    } else {
      if (score.total !== expect.score.total) {
        fail(`score total ${score.total}, expected ${expect.score.total}`);
      }
      const bandKey = score.band?.key ?? null;
      if (bandKey !== expect.score.band) {
        fail(`band ${bandKey}, expected ${expect.score.band}`);
      }
      for (const [q, pts] of Object.entries(expect.score.perQuestion ?? {})) {
        if (score.perQuestion[q] !== pts) {
          fail(`perQuestion ${q}=${score.perQuestion[q]}, expected ${pts}`);
        }
      }
    }
  }
  return failures;
}
