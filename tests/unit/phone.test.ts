import { describe, expect, it } from "vitest";

import { normalizeUzPhone, validateUzPhone } from "../../src/lib/phone";

describe("phone helpers", () => {
  it("normalizes Uzbek phone without plus to E.164", () => {
    expect(normalizeUzPhone("998901234567")).toBe("+998901234567");
    expect(normalizeUzPhone("+998901234567")).toBe("+998901234567");
    expect(normalizeUzPhone("998 90 123-45-67")).toBe("+998901234567");
  });

  it("rejects old short local input without country code", () => {
    expect(() => normalizeUzPhone("901234567")).toThrowError();
  });

  it("validates Uzbek phone format", () => {
    expect(validateUzPhone("998901234567")).toBe(true);
    expect(validateUzPhone("+998901234567")).toBe(true);
    expect(validateUzPhone("901234567")).toBe(false);
    expect(validateUzPhone("123")).toBe(false);
  });
});
