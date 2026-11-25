import { z } from "zod";
import { fullName } from "./format";
import { calcKiraat, photoKiraatErrors, type Student } from "./scoring";
import { errorSnapshot, type SheetErrorType } from "./sheet";

const scoreSchema = z.number().nullable();
export const photoReadSchema = z.object({
  course_name: z.string().nullable(),
  month: z.number().nullable(),
  year: z.number().nullable(),
  warnings: z.array(z.string()),
  rows: z.array(z.object({
    row_number: z.number().nullable(),
    name: z.string(),
    kiraat: scoreSchema,
    ezber: scoreSchema,
    ilmihal: scoreSchema,
    siyer: scoreSchema,
    errors: z.array(z.object({ error_id: z.string(), count: z.number().nullable() })),
    ezber1: z.string().nullable(), ezber2: z.string().nullable(),
    ilmihal1: z.string().nullable(), ilmihal2: z.string().nullable(),
    siyer1: z.string().nullable(), siyer2: z.string().nullable(),
    uncertain: z.boolean(),
    note: z.string(),
  })),
  examiner: z.string().nullable(),
  exam_date: z.string().nullable(),
  kiraat_topic: z.string().nullable(),
  ezber_topic_1: z.string().nullable(),
  ezber_topic_2: z.string().nullable(),
  note_yuzune: z.string().nullable(),
  note_ezber: z.string().nullable(),
  note_ilmihal: z.string().nullable(),
  note_siyer: z.string().nullable(),
  note_genel: z.string().nullable(),
});

export type PhotoRead = z.infer<typeof photoReadSchema>;
export type PhotoRow = PhotoRead["rows"][number];
export const PHOTO_SCORE_KEYS = ["kiraat", "ezber", "ilmihal", "siyer"] as const;
export type PhotoScoreKey = typeof PHOTO_SCORE_KEYS[number];
export interface ReviewedPhotoRow {
  source: PhotoRow;
  studentId: string;
  selected: boolean;
  scores: Record<PhotoScoreKey, string>;
  counts: Record<string, number>;
  kiraatSource: "counts" | "paper";
}

const nameKey = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

/** Never match by row position or approximate name: ambiguous names require a human selection. */
export function matchPhotoStudent(name: string, students: Student[]): string {
  const key = nameKey(name);
  if (!key) return "";
  const matches = students.filter((s) => nameKey(fullName(s)) === key);
  return matches.length === 1 ? matches[0]?.id ?? "" : "";
}

export function validPhotoScore(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export function recognizedErrors(counts: Record<string, number>, types: SheetErrorType[]) {
  return types.flatMap((t) => {
    const n = counts[t.id];
    return n != null && Number.isInteger(n) && n > 0 && n <= 99 ? [errorSnapshot(t, n)] : [];
  });
}

export function photoRowErrors(row: ReviewedPhotoRow, types: SheetErrorType[]) {
  const errors = recognizedErrors(row.counts, types);
  return row.kiraatSource === "counts" ? errors : photoKiraatErrors(validPhotoScore(row.scores.kiraat) ?? 100, errors);
}

export function reviewPhotoRows(read: PhotoRead, students: Student[], types: SheetErrorType[]): ReviewedPhotoRow[] {
  return read.rows.map((source) => {
    const counts: Record<string, number> = {};
    for (const e of source.errors) if (e.count != null && Number.isInteger(e.count) && e.count >= 0 && e.count <= 99 && types.some((t) => t.id === e.error_id)) counts[e.error_id] = e.count;
    const hasCounts = source.errors.some((e) => e.count != null && types.some((t) => t.id === e.error_id));
    const scores = Object.fromEntries(PHOTO_SCORE_KEYS.map((key) => [key, source[key] == null ? "" : String(source[key])])) as Record<PhotoScoreKey, string>;
    if (hasCounts && source.kiraat == null) scores.kiraat = String(calcKiraat(recognizedErrors(counts, types)));
    return { source, studentId: matchPhotoStudent(source.name, students), selected: false, scores, counts, kiraatSource: hasCounts ? "counts" : "paper" };
  });
}

export function photoReviewProblem(rows: ReviewedPhotoRow[], students: Student[]): string | null {
  const selected = rows.filter((r) => r.selected);
  if (!selected.length) return "Aktarılacak talebeleri işaretleyin.";
  const ids = new Set<string>();
  for (const row of selected) {
    if (!students.some((s) => s.id === row.studentId)) return "Her satır için bu kurstan bir talebe seçin.";
    if (ids.has(row.studentId)) return "Aynı talebe iki satırda seçilemez.";
    ids.add(row.studentId);
    if (PHOTO_SCORE_KEYS.some((key) => validPhotoScore(row.scores[key]) == null)) return "Seçilen talebelerin dört puanı da 0–100 arasında olmalı.";
  }
  return null;
}