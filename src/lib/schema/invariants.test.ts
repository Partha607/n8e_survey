import { describe, expect, it } from "vitest";
import type { InstrumentDefinition } from "./definition";
import { instrumentDefinitionSchema } from "./definition";
import { diffDefinitions } from "./diff";
import { validatePublishInvariants } from "./invariants";
import { INSTRUMENT_TYPES, presetFor } from "./presets";

const minimal = (over: Partial<InstrumentDefinition> = {}): InstrumentDefinition => ({
  schemaVersion: 1,
  mode: "conversational",
  pages: [
    {
      key: "page_1",
      questions: [
        {
          key: "q_color",
          type: "single_choice",
          label: "Favourite colour?",
          required: true,
          options: [
            { key: "opt_red", label: "Red" },
            { key: "opt_blue", label: "Blue" },
          ],
        },
        { key: "q_why", type: "long_text", label: "Why?", required: false },
      ],
    },
    {
      key: "page_2",
      questions: [{ key: "q_age", type: "number", label: "Your age", required: false }],
    },
  ],
  logic: [],
  presentation: { showProgress: true },
  ...over,
});

describe("presets", () => {
  it("every type preset parses and passes invariants", () => {
    for (const type of INSTRUMENT_TYPES) {
      const def = presetFor(type);
      expect(instrumentDefinitionSchema.parse(def)).toBeTruthy();
      expect(validatePublishInvariants(def)).toEqual({ ok: true });
    }
  });
});

describe("publish invariants", () => {
  it("accepts a valid definition", () => {
    expect(validatePublishInvariants(minimal())).toEqual({ ok: true });
  });

  it("rejects duplicate question keys with field-level errors", () => {
    const def = minimal();
    def.pages[1].questions.push({
      key: "q_color",
      type: "short_text",
      label: "dup",
      required: false,
    });
    const result = validatePublishInvariants(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors["pages[1].questions[1].key"]).toContain("duplicate");
    }
  });

  it("rejects an empty instrument", () => {
    const def = minimal({ pages: [{ key: "page_1", questions: [] }] });
    const result = validatePublishInvariants(def);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["pages"]).toBeTruthy();
  });

  it("rejects dangling logic references", () => {
    const def = minimal({
      logic: [
        {
          id: "r1",
          when: { op: "and", clauses: [{ q: "q_missing", cmp: "answered" }] },
          action: { kind: "hide_question", target: "q_ghost" },
        },
      ],
    });
    const result = validatePublishInvariants(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors["logic[0].when.clauses[0].q"]).toContain("q_missing");
      expect(result.fieldErrors["logic[0].action.target"]).toContain("q_ghost");
    }
  });

  it("rejects backward skip targets", () => {
    const def = minimal({
      logic: [
        {
          id: "r1",
          when: { op: "and", clauses: [{ q: "q_age", cmp: "gt", value: 10 }] },
          action: { kind: "skip_to_page", target: "page_1" },
        },
      ],
    });
    const result = validatePublishInvariants(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors["logic[0].action.target"]).toContain("backward");
    }
  });

  it("rejects show/hide cycles", () => {
    const def = minimal({
      logic: [
        {
          id: "r1",
          when: { op: "and", clauses: [{ q: "q_color", cmp: "answered" }] },
          action: { kind: "show_question", target: "q_why" },
        },
        {
          id: "r2",
          when: { op: "and", clauses: [{ q: "q_why", cmp: "answered" }] },
          action: { kind: "hide_question", target: "q_color" },
        },
        {
          id: "r3",
          when: { op: "and", clauses: [{ q: "q_age", cmp: "answered" }] },
          action: { kind: "show_question", target: "q_age" },
        },
      ],
    });
    // add a real cycle: q_color → q_why → q_color
    const result = validatePublishInvariants(def);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["logic"]).toContain("cycle");
  });

  it("rejects choice questions without options and likert without matrix", () => {
    const def = minimal();
    def.pages[0].questions[0].options = [];
    def.pages[1].questions.push({
      key: "q_matrix",
      type: "likert_matrix",
      label: "Rate these",
      required: false,
    });
    const result = validatePublishInvariants(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors["pages[0].questions[0].options"]).toBeTruthy();
      expect(result.fieldErrors["pages[1].questions[1].matrix"]).toBeTruthy();
    }
  });

  it("rejects scoring that references unknown keys", () => {
    const def = minimal({
      scoring: {
        points: { q_color: { opt_red: 2, opt_ghost: 1 }, q_ghost: { opt_x: 1 } },
        bands: [{ key: "band_all", label: "All", min: 0, max: 10 }],
      },
    });
    const result = validatePublishInvariants(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors["scoring.points.q_ghost"]).toBeTruthy();
      expect(result.fieldErrors["scoring.points.q_color.opt_ghost"]).toBeTruthy();
    }
  });

  it("detects key renames against the previous version (FR-INST-03)", () => {
    const prev = minimal();
    const next = minimal();
    // same label + type, different key = rename → rejected
    next.pages[0].questions[0] = {
      ...next.pages[0].questions[0],
      key: "q_colour_uk",
    };
    const result = validatePublishInvariants(next, prev);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors["questions.q_colour_uk"]).toContain("stable identity");
    }
    // a genuinely NEW question (different label) is fine
    const next2 = minimal();
    next2.pages[0].questions[0] = {
      key: "q_shade",
      type: "single_choice",
      label: "Preferred shade?",
      required: true,
      options: [{ key: "opt_dark", label: "Dark" }],
    };
    expect(validatePublishInvariants(next2, prev).ok).toBe(true);
  });
});

describe("diff", () => {
  it("summarizes added/removed/relabeled questions and option changes", () => {
    const prev = minimal();
    const next = minimal();
    next.pages[0].questions[0].label = "Favourite color?"; // relabel keeps key
    next.pages[0].questions[0].options!.push({ key: "opt_green", label: "Green" });
    next.pages[1].questions = [
      { key: "q_city", type: "short_text", label: "Your city", required: false },
    ];
    const diff = diffDefinitions(prev, next);
    expect(diff.hasChanges).toBe(true);
    expect(diff.addedQuestions.map((q) => q.key)).toEqual(["q_city"]);
    expect(diff.removedQuestions.map((q) => q.key)).toEqual(["q_age"]);
    expect(diff.relabeledQuestions[0]).toMatchObject({ key: "q_color" });
    expect(diff.optionChanges[0]).toMatchObject({ key: "q_color", added: ["opt_green"] });
  });

  it("reports no changes for identical definitions", () => {
    expect(diffDefinitions(minimal(), minimal()).hasChanges).toBe(false);
  });
});
