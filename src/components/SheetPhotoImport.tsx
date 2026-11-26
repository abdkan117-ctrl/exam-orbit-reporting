import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Check, ChevronDown, FileImage, LoaderCircle, RotateCcw, Save, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ErrorType, ResultWithId } from "@/lib/data";
import { fullName } from "@/lib/format";
import { calcKiraat, type Student } from "@/lib/scoring";
import { emptyInfo, MARK_KEYS, type SheetInfo } from "@/lib/sheet";
import { analyzeSheetPhoto } from "@/lib/sheet-photo.functions";
import {
  PHOTO_SCORE_KEYS,
  photoReviewProblem,
  photoRowErrors,
  recognizedErrors,
  reviewPhotoRows,
  validPhotoScore,
  type PhotoRead,
  type PhotoScoreKey,
  type ReviewedPhotoRow,
} from "@/lib/sheet-photo";
import { cn } from "@/lib/utils";

const SCORE_LABELS: Record<PhotoScoreKey, string> = { kiraat: "Kırâat", ezber: "Ezber", ilmihal: "İlmihal", siyer: "Siyer" };
const MARK_LABELS: Record<(typeof MARK_KEYS)[number], string> = {
  ezber1: "Ezber 1. kısım", ezber2: "Ezber 2. kısım",
  ilmihal1: "İlmihal 1. sual", ilmihal2: "İlmihal 2. sual",
  siyer1: "Siyer 1. sual", siyer2: "Siyer 2. sual",
};
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 6 * 1024 * 1024;

/** Phone photos can exceed the reader's 6 MB limit; shrink only those, keeping small writing legible. */
async function preparePhoto(file: File): Promise<File> {
  if (!IMAGE_TYPES.has(file.type)) throw new Error("JPEG, PNG veya WebP fotoğraf seçin. Telefon ayarı HEIC ise JPEG olarak çekin.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Fotoğraf 20 MB'den küçük olmalı.");
  if (file.size <= MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  try {
    for (const longest of [2800, 2200, 1700]) {
      const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Fotoğraf hazırlanamadı.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (blob && blob.size <= MAX_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Fotoğraf küçültülemedi. Daha yakından ve yalnız cetvel görünecek şekilde çekin.");
}

function cleanMark(value: string | null) {
  return (value ?? "").replace(/[^0-9.,]/g, "").slice(0, 5);
}

interface Props {
  examId: string;
  examName: string;
  courseId: string;
  courseName: string;
  students: Student[];
  errorTypes: ErrorType[];
  results: ResultWithId[];
  sheet?: SheetInfo;
  disabled?: boolean;
}

export function SheetPhotoImport({ examId, examName, courseId, courseName, students, errorTypes, results, sheet, disabled }: Props) {
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeSheetPhoto);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"photo" | "save" | null>(null);
  const [preview, setPreview] = useState("");
  const [photoId, setPhotoId] = useState("");
  const [read, setRead] = useState<PhotoRead | null>(null);
  const [rows, setRows] = useState<ReviewedPhotoRow[]>([]);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const selectedCount = rows.filter((r) => r.selected).length;
  const matchedCount = rows.filter((r) => r.studentId).length;
  const existingResults = useMemo(() => new Map(results.map((r) => [r.student_id, r])), [results]);

  function reset() {
    setPreview("");
    setPhotoId("");
    setRead(null);
    setRows([]);
    setError("");
    setErrorStatus(null);
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
  }

  async function runAnalysis(id: string, resume = false) {
    setBusy("photo");
    setError("");
    setErrorStatus(null);
    try {
      const response = await analyze({ data: { photoId: id, resume } });
      if (!response.ok) {
        setError(response.error);
        setErrorStatus(response.status);
        return;
      }
      setRead(response.read);
      const reviewed = reviewPhotoRows(response.read, students, errorTypes).map((row) => ({
        ...row,
        selected: !!row.studentId && !row.source.uncertain && PHOTO_SCORE_KEYS.every((key) => validPhotoScore(row.scores[key]) != null),
      }));
      setRows(reviewed);
      if (!reviewed.length) setError("Fotoğrafta okunabilir talebe satırı bulunamadı. Cetveli düz, yakın ve tam görünecek şekilde yeniden çekin.");
    } catch {
      setError("Fotoğraf okunamadı. Bağlantınızı kontrol edip yeni bir fotoğraf deneyin.");
    } finally {
      setBusy(null);
    }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file || busy) return;
    reset();
    setBusy("photo");
    try {
      const prepared = await preparePhoto(file);
      setPreview(URL.createObjectURL(prepared));
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Oturumunuz sona erdi. Yeniden giriş yapın.");
      const id = crypto.randomUUID();
      const extension = prepared.type === "image/png" ? "png" : prepared.type === "image/webp" ? "webp" : "jpg";
      const path = `${auth.user.id}/${examId}/${courseId}/${id}.${extension}`;
      const uploaded = await supabase.storage.from("exam-sheet-photos").upload(path, prepared, { contentType: prepared.type });
      if (uploaded.error) throw new Error("Fotoğraf yüklenemedi. Depolama alanını ve bağlantınızı kontrol edin.");
      const inserted = await supabase.from("exam_sheet_photos").insert({
        id, exam_id: examId, course_id: courseId, uploaded_by: auth.user.id, storage_path: path, file_name: prepared.name.slice(0, 200),
      });
      if (inserted.error) {
        await supabase.storage.from("exam-sheet-photos").remove([path]);
        throw new Error("Fotoğraf kaydı oluşturulamadı. Yönetici yetkinizi kontrol edin.");
      }
      setPhotoId(id);
      await runAnalysis(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fotoğraf yüklenemedi.");
      setBusy(null);
    }
  }

  function patchRow(index: number, patch: Partial<ReviewedPhotoRow>) {
    setRows((old) => old.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  function changeCount(index: number, errorId: string, raw: string) {
    const row = rows[index];
    if (!row) return;
    const count = Math.min(99, Math.max(0, Number.parseInt(raw.replace(/\D/g, "") || "0", 10)));
    const counts = { ...row.counts, [errorId]: count };
    const scores = row.kiraatSource === "counts"
      ? { ...row.scores, kiraat: String(calcKiraat(recognizedErrors(counts, errorTypes))) }
      : row.scores;
    patchRow(index, { counts, scores });
  }

  function selectUsable() {
    setRows((old) => old.map((row) => ({
      ...row,
      selected: !!row.studentId && PHOTO_SCORE_KEYS.every((key) => validPhotoScore(row.scores[key]) != null),
    })));
  }

  async function saveSelected() {
    const problem = photoReviewProblem(rows, students);
    if (problem) { toast.error(problem); return; }
    setBusy("save");
    const selected = rows.filter((r) => r.selected);
    const resultRows = selected.map((row) => {
      const previous = existingResults.get(row.studentId);
      return {
        exam_id: examId,
        student_id: row.studentId,
        course_id: courseId,
        kiraat_errors: photoRowErrors(row, errorTypes, previous?.kiraat_errors ?? []) as unknown as never,
        ezber: validPhotoScore(row.scores.ezber) ?? 0,
        ilmihal: validPhotoScore(row.scores.ilmihal) ?? 0,
        siyer: validPhotoScore(row.scores.siyer) ?? 0,
        sheet_marks: Object.fromEntries(MARK_KEYS.map((key) => [key, cleanMark(row.source[key])])) as unknown as never,
      };
    });
    const info = { ...emptyInfo(), ...sheet };
    const infoPatch: Partial<SheetInfo> = {};
    if (read) {
      for (const key of ["examiner", "kiraat_topic", "ezber_topic_1", "ezber_topic_2", "note_yuzune", "note_ezber", "note_ilmihal", "note_siyer", "note_genel"] as const) {
        const value = read[key]?.trim();
        if (value) infoPatch[key] = value.slice(0, 1000);
      }
      if (read.exam_date && /^\d{4}-\d{2}-\d{2}$/.test(read.exam_date)) infoPatch.exam_date = read.exam_date;
    }
    const hasInfo = Object.keys(infoPatch).length > 0;
    const [savedResults, savedInfo] = await Promise.all([
      supabase.from("exam_results").upsert(resultRows, { onConflict: "exam_id,student_id" }),
      hasInfo
        ? supabase.from("exam_sheets").upsert({ ...info, ...infoPatch, exam_id: examId, course_id: courseId, updated_at: new Date().toISOString() }, { onConflict: "exam_id,course_id" })
        : Promise.resolve({ error: null }),
    ]);
    setBusy(null);
    const saveError = savedResults.error ?? savedInfo.error;
    if (saveError) { toast.error("Aktarılamadı: " + saveError.message); return; }
    toast.success(`${selected.length} talebenin puanı cetvele aktarıldı`);
    await qc.invalidateQueries();
    setOpen(false);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled} title={disabled ? "Önce cetveldeki değişiklikleri kaydedin" : undefined}>
          <Camera /> Fotoğraftan aktar
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[92dvh] w-[calc(100%-1rem)] max-w-6xl flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Cetvel fotoğrafından puan aktar</DialogTitle>
          <DialogDescription>{courseName} · {examName}. Önce fotoğraf okunur, sonra siz kontrol edip kaydedersiniz.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {!read && (
            <div className="rounded-xl border border-dashed bg-secondary/60 p-5 text-center">
              <FileImage className="mx-auto mb-3 size-9 text-primary" />
              <p className="font-semibold">Doldurulmuş cetveli çekin veya seçin</p>
              <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Cetvel tam görünsün, yazılar net olsun ve gölge olmasın. Birden fazla sayfayı ayrı ayrı yükleyin.</p>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label="Cetvel fotoğrafı çek" onChange={(e) => choosePhoto(e.target.files?.[0])} />
              <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Cetvel fotoğrafı yükle" onChange={(e) => choosePhoto(e.target.files?.[0])} />
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button type="button" disabled={!!busy} onClick={() => inputRef.current?.click()}>
                  {busy ? <LoaderCircle className="animate-spin" /> : <Camera />}
                  {busy ? "Okunuyor…" : "Fotoğraf çek"}
                </Button>
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => uploadRef.current?.click()}>
                  {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
                  {busy ? "Yükleniyor…" : "Galeriden yükle"}
                </Button>
              </div>
              {busy && <p className="mt-2 text-xs text-muted-foreground">Fotoğraf yükleniyor ve okunuyor. Netliğe göre biraz sürebilir; sayfayı kapatmayın.</p>}
            </div>
          )}

          {preview && (
            <details className="rounded-xl border bg-card p-3">
              <summary className="cursor-pointer text-sm font-semibold">Yüklenen fotoğrafı göster</summary>
              <img src={preview} alt="Yüklenen imtihan cetveli" className="mx-auto mt-3 max-h-[65vh] w-auto max-w-full rounded-lg border object-contain" />
            </details>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-warning bg-warning-soft p-4 text-sm text-foreground">
              <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" /><p>{error}</p></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {photoId && !read && errorStatus !== 403 && errorStatus !== 402 && (
                  <Button variant="outline" size="sm" disabled={!!busy} onClick={() => runAnalysis(photoId)}><RotateCcw /> Yeniden oku</Button>
                )}
                {photoId && !read && errorStatus === 402 && (
                  <Button variant="outline" size="sm" disabled={!!busy} onClick={() => runAnalysis(photoId, true)}><RotateCcw /> Krediyi ekledim, yeniden dene</Button>
                )}
                {!!busy || read ? null : <Button variant="outline" size="sm" onClick={reset}>Başka fotoğraf seç</Button>}
              </div>
            </div>
          )}

          {read && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-soft p-3">
                <div className="text-sm">
                  <p className="font-semibold">{rows.length} satır okundu · {matchedCount} talebe otomatik eşleşti</p>
                  <p className="text-muted-foreground">Puanları fotoğrafla karşılaştırın. Aktarılacak satırları işaretleyin.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={selectUsable}><Check /> Uygun satırları seç</Button>
                  <Button variant="ghost" size="sm" disabled={!!busy} onClick={reset}>Başka fotoğraf</Button>
                </div>
              </div>

              {read.warnings.length > 0 && (
                <div className="rounded-xl border border-warning bg-warning-soft p-3 text-sm">
                  <p className="mb-1 flex items-center gap-2 font-semibold"><TriangleAlert className="size-4 text-warning" /> Kontrol edilmesi gerekenler</p>
                  <ul className="list-disc space-y-1 pl-7">{read.warnings.map((warning, i) => <li key={`${i}-${warning}`}>{warning}</li>)}</ul>
                </div>
              )}

              <div className="space-y-3">
                {rows.map((row, index) => {
                  const complete = PHOTO_SCORE_KEYS.every((key) => validPhotoScore(row.scores[key]) != null);
                  return (
                    <article key={`${index}-${row.source.name}`} className={cn("rounded-xl border bg-card p-3", row.selected && "border-primary", row.source.uncertain && "border-warning")}>
                      <div className="flex flex-wrap items-start gap-3">
                        <Checkbox aria-label={`${row.source.name} satırını aktar`} checked={row.selected} onCheckedChange={(checked) => patchRow(index, { selected: checked === true })} className="mt-2 size-5" />
                        <div className="min-w-48 flex-1">
                          <p className="text-xs text-muted-foreground">Fotoğraftaki ad {row.source.row_number != null ? `· ${row.source.row_number}. satır` : ""}</p>
                          <p className="font-semibold">{row.source.name || "İsim okunamadı"}</p>
                          {(row.source.uncertain || row.source.note) && <p className="mt-1 text-xs text-warning">{row.source.note || "Bu satırın okunması şüpheli; fotoğrafla karşılaştırın."}</p>}
                        </div>
                        <label className="min-w-52 flex-1 text-xs font-semibold text-muted-foreground">Cetveldeki talebe
                          <Select value={row.studentId} onValueChange={(studentId) => patchRow(index, { studentId })}>
                            <SelectTrigger aria-label={`${row.source.name} için talebe seç`} className="mt-1 bg-card text-foreground"><SelectValue placeholder="Talebe seçin" /></SelectTrigger>
                            <SelectContent>{students.map((student) => <SelectItem key={student.id} value={student.id}>{fullName(student)}</SelectItem>)}</SelectContent>
                          </Select>
                        </label>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {PHOTO_SCORE_KEYS.map((key) => (
                          <label key={key} className="text-xs font-semibold text-muted-foreground">{SCORE_LABELS[key]} puanı
                            <Input aria-label={`${row.source.name} ${SCORE_LABELS[key]} puanı`} inputMode="decimal" value={row.scores[key]} onChange={(e) => patchRow(index, { scores: { ...row.scores, [key]: e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5) } })} className={cn("mt-1 text-center text-base font-bold", validPhotoScore(row.scores[key]) == null && "border-warning")} placeholder="Boş" />
                          </label>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-xs font-semibold text-muted-foreground">Kırâat puanı kaynağı:</span>
                        <Select value={row.kiraatSource} onValueChange={(value: "counts" | "paper") => patchRow(index, {
                          kiraatSource: value,
                          scores: value === "counts" ? { ...row.scores, kiraat: String(calcKiraat(recognizedErrors(row.counts, errorTypes))) } : row.scores,
                        })}>
                          <SelectTrigger aria-label={`${row.source.name} Kırâat kaynağı`} className="w-auto min-w-56 bg-card"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="paper">Kâğıtta yazan puan</SelectItem>
                            <SelectItem value="counts">Hata sayılarından hesapla</SelectItem>
                          </SelectContent>
                        </Select>
                        {!complete && <span className="text-xs text-warning">Dört puan da doldurulmalı.</span>}
                      </div>

                      <details className="mt-3 rounded-lg bg-secondary/70 p-2">
                        <summary className="flex cursor-pointer items-center gap-1 text-xs font-semibold"><ChevronDown className="size-3" /> Hata sayıları ve sual kutuları</summary>
                        <p className="mb-2 mt-2 text-xs font-semibold text-muted-foreground">Kırâat hata sayıları</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {errorTypes.map((type) => <label key={type.id} className="text-xs text-muted-foreground">{type.name}
                            <Input aria-label={`${row.source.name} ${type.name} hata sayısı`} inputMode="numeric" value={row.counts[type.id] ? String(row.counts[type.id]) : ""} onChange={(e) => changeCount(index, type.id, e.target.value)} className="mt-1 h-8 bg-card text-center" placeholder="0" />
                          </label>)}
                        </div>
                        <p className="mb-2 mt-3 text-xs font-semibold text-muted-foreground">Sual ve ezber kutuları</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                          {MARK_KEYS.map((key) => <label key={key} className="text-xs text-muted-foreground">{MARK_LABELS[key]}
                            <Input aria-label={`${row.source.name} ${MARK_LABELS[key]}`} inputMode="decimal" value={row.source[key] ?? ""} onChange={(e) => patchRow(index, { source: { ...row.source, [key]: cleanMark(e.target.value) } })} className="mt-1 h-8 bg-card text-center" />
                          </label>)}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {read && rows.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-sm text-muted-foreground">Kaydetmek, seçilen talebelerin bu aydaki puanlarını günceller.</p>
            <Button onClick={saveSelected} disabled={!!busy || !selectedCount}>
              {busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}
              {busy === "save" ? "Aktarılıyor…" : `${selectedCount} talebeyi cetvele aktar`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
