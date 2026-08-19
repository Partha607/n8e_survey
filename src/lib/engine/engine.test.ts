import { describe, expect, it } from "vitest";
import { loadVectors, runVector } from "./vectors";

const { definitions, vectors } = loadVectors();

describe("engine golden vectors", () => {
  it(`has at least 30 vectors (${vectors.length})`, () => {
    expect(vectors.length).toBeGreaterThanOrEqual(30);
  });

  for (const vector of vectors) {
    it(vector.name, () => {
      expect(runVector(definitions, vector)).toEqual([]);
    });
  }
});
