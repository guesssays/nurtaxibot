import { expect } from "vitest";

const MOJIBAKE_FRAGMENTS = ["Р’", "Рџ", "РЎ", "Рќ", "СЃ", "С‚", "Рё", "СЏ", "�"] as const;

export function expectNoMojibake(text: string): void {
  for (const fragment of MOJIBAKE_FRAGMENTS) {
    expect(text).not.toContain(fragment);
  }
}
