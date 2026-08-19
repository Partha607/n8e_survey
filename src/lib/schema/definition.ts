/**
 * Instrument definition schema (BUILD-PLAN §3.2) — the heart.
 * One Zod schema → TS types + client UX + server authority (FR-QST-02).
 * `schemaVersion` discipline keeps old snapshots parseable forever (NFR-MNT-04).
 */
import { z } from "zod";

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "dropdown",
  "rating",
  "nps",
  "likert_matrix",
  "number",
  "date",
  "email",
  "file",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Stable identity: url-safe, starts with a letter, snake-ish. */
const keySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "keys are lowercase letters, digits and underscores, starting with a letter",
  );

export const optionSchema = z.object({
  key: keySchema,
  label: z.string().min(1).max(500),
});
export type Option = z.infer<typeof optionSchema>;

export const validationSchema = z
  .object({
    min: z.number().optional(), // length for text, value for number/date-epoch
    max: z.number().optional(),
    regex: z.string().max(500).optional(),
    maxFiles: z.number().int().min(1).max(10).optional(),
    maxSizeMb: z.number().min(0.1).max(100).optional(),
    accept: z.array(z.string().max(100)).max(20).optional(), // MIME allowlist
  })
  .strict();
export type ValidationSpec = z.infer<typeof validationSchema>;

export const questionSchema = z
  .object({
    key: keySchema,
    type: z.enum(QUESTION_TYPES),
    label: z.string().min(1).max(1000),
    help: z.string().max(2000).optional(),
    required: z.boolean(),
    options: z.array(optionSchema).max(100).optional(),
    validation: validationSchema.optional(),
    matrix: z
      .object({
        rows: z.array(optionSchema).min(1).max(30),
        scale: z.array(optionSchema).min(2).max(11),
      })
      .optional(),
  })
  .strict();
export type Question = z.infer<typeof questionSchema>;

export const pageSchema = z
  .object({
    key: keySchema,
    title: z.string().max(300).optional(),
    questions: z.array(questionSchema),
  })
  .strict();
export type Page = z.infer<typeof pageSchema>;

export const COMPARATORS = [
  "eq",
  "neq",
  "in",
  "gt",
  "lt",
  "gte",
  "lte",
  "answered",
  "not_answered",
  "contains",
] as const;
export type Comparator = (typeof COMPARATORS)[number];

export const clauseSchema = z
  .object({
    q: keySchema,
    cmp: z.enum(COMPARATORS),
    value: z
      .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
      .optional(),
  })
  .strict();
export type Clause = z.infer<typeof clauseSchema>;

export const conditionSchema = z
  .object({
    op: z.enum(["and", "or"]),
    clauses: z.array(clauseSchema).min(1).max(20),
  })
  .strict();
export type Condition = z.infer<typeof conditionSchema>;

export const ACTION_KINDS = [
  "show_question",
  "hide_question",
  "skip_to_page",
  "disqualify",
  "end",
] as const;

export const actionSchema = z
  .object({
    kind: z.enum(ACTION_KINDS),
    target: keySchema.optional(), // question key or page key depending on kind
  })
  .strict();
export type Action = z.infer<typeof actionSchema>;

export const ruleSchema = z
  .object({
    id: z.string().min(1).max(64),
    when: conditionSchema,
    action: actionSchema,
  })
  .strict();
export type Rule = z.infer<typeof ruleSchema>;

export const scoringSchema = z
  .object({
    /** questionKey → optionKey → points */
    points: z.record(keySchema, z.record(keySchema, z.number())),
    bands: z
      .array(
        z
          .object({
            key: keySchema,
            label: z.string().min(1).max(300),
            min: z.number(),
            max: z.number(),
            description: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type ScoringSpec = z.infer<typeof scoringSchema>;

export const presentationSchema = z
  .object({
    showProgress: z.boolean(),
    welcome: z
      .object({ title: z.string().max(300), body: z.string().max(5000).optional() })
      .optional(),
    thankYou: z
      .object({ title: z.string().max(300), body: z.string().max(5000).optional() })
      .optional(),
    conductedFor: z.string().max(200).optional(),
  })
  .strict();

export const instrumentDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["conversational", "paged"]),
    pages: z.array(pageSchema).min(1).max(100),
    logic: z.array(ruleSchema).max(200),
    scoring: scoringSchema.optional(),
    presentation: presentationSchema,
  })
  .strict();
export type InstrumentDefinition = z.infer<typeof instrumentDefinitionSchema>;

export const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set([
  "single_choice",
  "multi_choice",
  "dropdown",
]);

export function allQuestions(def: InstrumentDefinition): Question[] {
  return def.pages.flatMap((p) => p.questions);
}

export function questionPageIndex(
  def: InstrumentDefinition,
  questionKey: string,
): number {
  return def.pages.findIndex((p) => p.questions.some((q) => q.key === questionKey));
}
