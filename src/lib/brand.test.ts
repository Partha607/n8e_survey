import { describe, expect, it } from "vitest";
import { BRAND_URL, MOTTO, TAGLINE, TRANSPARENCY_LINE } from "./brand";

describe("brand constants", () => {
  it("keeps fixed strings verbatim", () => {
    expect(MOTTO).toBe("IN DATA VERITAS");
    expect(TAGLINE).toBe("FOR INDIA, BY NORTHEASTERN INDIA.");
    expect(TRANSPARENCY_LINE).toBe("Your responses go to N8E Labs");
  });

  it("links to n8elabs.com over https", () => {
    expect(BRAND_URL).toBe("https://n8elabs.com");
  });
});
