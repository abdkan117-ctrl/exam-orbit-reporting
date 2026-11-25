import { describe, expect, it } from "vitest";
import { matchPhotoStudent, validPhotoScore, photoReviewProblem, photoRowErrors, type ReviewedPhotoRow } from "./sheet-photo";
import { calcKiraat, calcTotal } from "./scoring";
const student = { id: "s1", course_id: "c1", first_name: "İsmail", last_name: "Şen" };
const row: ReviewedPhotoRow = {
  source: { row_number: 1, name: "İsmail Şen", kiraat: 92, ezber: 80, ilmihal: 60, siyer: 40, errors: [], ezber1: null, ezber2: null, ilmihal1: null, ilmihal2: null, siyer1: null, siyer2: null, uncertain: false, note: "" },
  studentId: "s1", selected: true, scores: { kiraat: "92", ezber: "80", ilmihal: "60", siyer: "40" }, counts: {}, kiraatSource: "paper",
};
describe("photo import accuracy", () => {
  it("matches an unambiguous full Turkish name only", () => {
    expect(matchPhotoStudent("İSMAİL  ŞEN", [student])).toBe("s1");
    expect(matchPhotoStudent("İsmail", [student])).toBe("");
    expect(matchPhotoStudent("İsmail Şen", [student, { ...student, id: "s2" }])).toBe("");
  });
  it("does not turn blank or unreadable scores into zero", () => {
    expect(validPhotoScore("")).toBeNull();
    expect(validPhotoScore("?")).toBeNull();
    expect(validPhotoScore("101")).toBeNull();
    expect(validPhotoScore("0")).toBe(0);
    expect(validPhotoScore("89,5")).toBe(89.5);
  });
  it("requires complete scores before import", () => {
    expect(photoReviewProblem([{ ...row, scores: { ...row.scores, ilmihal: "" } }], [student])).not.toBeNull();
    expect(photoReviewProblem([row], [student])).toBeNull();
  });
  it("rejects duplicate student and other-course matches", () => {
    expect(photoReviewProblem([row, row], [student])).not.toBeNull();
    expect(photoReviewProblem([{ ...row, studentId: "other" }], [student])).not.toBeNull();
  });
  it("preserves the approved paper Kiraat score and uses the four-section average", () => {
    const kiraat = calcKiraat(photoRowErrors(row, []));
    expect(kiraat).toBe(92);
    expect(calcTotal({ kiraat, ezber: 80, ilmihal: 60, siyer: 40 })).toBe(68);
  });
  it("uses configured error deductions when count source is chosen", () => {
    const errors = photoRowErrors({ ...row, counts: { harf: 3 }, kiraatSource: "counts" }, [{ id: "harf", name: "Zât-ı Harf", category: "harf", deduction: 2, repeat_deduction: 2, max_deduction: null }]);
    expect(calcKiraat(errors)).toBe(94);
  });
});