/**
 * Type presets (FR-INST-01): each of the five instrument types initializes
 * from a preset over the single instrument schema.
 */
import type { InstrumentDefinition } from "./definition";

export const INSTRUMENT_TYPES = ["poll", "survey", "quiz", "feedback", "intake"] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

const base = (
  overrides: Partial<InstrumentDefinition> & Pick<InstrumentDefinition, "pages">,
): InstrumentDefinition => ({
  schemaVersion: 1,
  mode: "conversational",
  logic: [],
  presentation: { showProgress: true },
  ...overrides,
});

export function presetFor(type: InstrumentType): InstrumentDefinition {
  switch (type) {
    case "poll":
      return base({
        presentation: { showProgress: false },
        pages: [
          {
            key: "page_1",
            questions: [
              {
                key: "q_poll",
                type: "single_choice",
                label: "Your question here",
                required: true,
                options: [
                  { key: "opt_a", label: "Option A" },
                  { key: "opt_b", label: "Option B" },
                ],
              },
            ],
          },
        ],
      });
    case "survey":
      return base({
        pages: [
          {
            key: "page_1",
            title: "Page 1",
            questions: [
              {
                key: "q_1",
                type: "short_text",
                label: "First question",
                required: false,
              },
            ],
          },
        ],
      });
    case "quiz":
      return base({
        pages: [
          {
            key: "page_1",
            questions: [
              {
                key: "q_1",
                type: "single_choice",
                label: "First quiz question",
                required: true,
                options: [
                  { key: "opt_right", label: "Correct answer" },
                  { key: "opt_wrong", label: "Wrong answer" },
                ],
              },
            ],
          },
        ],
        scoring: {
          points: { q_1: { opt_right: 1, opt_wrong: 0 } },
          bands: [
            { key: "band_low", label: "Keep practicing", min: 0, max: 0 },
            { key: "band_high", label: "Well done", min: 1, max: 1 },
          ],
        },
      });
    case "feedback":
      return base({
        pages: [
          {
            key: "page_1",
            questions: [
              {
                key: "q_nps",
                type: "nps",
                label: "How likely are you to recommend us?",
                required: true,
              },
              {
                key: "q_comment",
                type: "long_text",
                label: "What could we do better?",
                required: false,
              },
            ],
          },
        ],
      });
    case "intake":
      return base({
        mode: "paged",
        pages: [
          {
            key: "page_1",
            title: "Your details",
            questions: [
              { key: "q_name", type: "short_text", label: "Full name", required: true },
              { key: "q_email", type: "email", label: "Email address", required: true },
            ],
          },
        ],
      });
  }
}
