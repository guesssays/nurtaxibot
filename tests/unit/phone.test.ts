import { describe, expect, it } from "vitest";

import { normalizeUzPhone, validateUzPhone } from "../../src/lib/phone";

describe("phone helpers", () => {
  it("normalizes local Uzbek phone to E.164", () => {
    expect(normalizeUzPhone("901234567")).toBe("+998901234567");
    expect(normalizeUzPhone("+998901234567")).toBe("+998901234567");
    expect(normalizeUzPhone("998901234567")).toBe("+998901234567");
  });

  it("validates Uzbek phone format", () => {
    expect(validateUzPhone("901234567")).toBe(true);
    expect(validateUzPhone("123")).toBe(false);
  });
});
