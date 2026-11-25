import { describe, expect, it } from "vitest";
import { sheetErrors, liveScores } from "./sheet";

describe("saved sheet deductions", () => {
  const saved = { id: "harf", name: "Zât-ı Harf", category: "harf" as const, deduction: 2, repeat_deduction: 2, max_deduction: null, count: 3 };
  const changed = { ...saved, deduction: 10, repeat_deduction: 10 };
  it("retains the original 2-point loss on existing results after settings change", () => {
    const errors = sheetErrors([changed], { harf: 3 }, [saved]);
    expect(liveScores(errors, 80, 60, 40)).toMatchObject({ kiraat: 94, total: 68.5 });
  });
  it("applies edited deductions to new results", () => {
    const errors = sheetErrors([changed], { harf: 3 }, []);
    expect(liveScores(errors, 80, 60, 40).kiraat).toBe(70);
  });
  it("keeps deleted error types in historical scores", () => {
    expect(liveScores(sheetErrors([], {}, [saved]), 80, 60, 40).kiraat).toBe(94);
  });
});