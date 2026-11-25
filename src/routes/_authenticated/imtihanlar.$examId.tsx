import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FileDown, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Card, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { coursesQuery, errorTypesQuery, examResultsQuery, examSheetsQuery, examsQuery, sheetSettingsQuery, studentsQuery, useMe } from "@/lib/data";
import { courseColorVar, examLabel, fmt, fullName } from "@/lib/format";
import { type KiraatError } from "@/lib/scoring";
import { cn } from "@/lib/utils";
import { sheetPdfInputs } from "@/lib/reports";
import {
  emptyInfo, sheetErrors, kiraatColumns, liveScores, mergeLabels, sheetTitle, toMarks,
  type SheetInfo, type SheetMarks,
} from "@/lib/sheet";
import { compareTr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/imtihanlar/$examId")({
  head: () => ({
    meta: [
      { title: "İmtihan Cetveli — Mıntıka İmtihan Sistemi" },
      { name: "description", content: "Kâğıt cetvelin aynısı: Kıraat hataları, Ezber, İlmihal ve Siyer-i Nebi puan girişi." },
      { property: "og:title", content: "İmtihan Cetveli — Mıntıka İmtihan Sistemi" },
      { property: "og:description", content: "Kâğıt cetvelin aynısı: Kıraat hataları, Ezber, İlmihal ve Siyer-i Nebi puan girişi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExamSheet,
});

interface Draft {
  counts: Record<string, number>;
  oldErrors: KiraatError[];
  ezber: string;
  ilmihal: string;
  siyer: string;
  marks: SheetMarks;
  dirty: boolean;
  exists: boolean;
}

const toNum = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};
const numIn = (v: string, max = 5) => v.replace(/[^0-9.,]/g, "").slice(0, max);

function ExamSheet() {
  const { examId } = Route.useParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = !!me?.isAdmin;
  const { data: exams = [] } = useQuery(examsQuery);
  const { data: courses = [] } = useQuery(coursesQuery);
  const { data: students = [] } = useQuery(studentsQuery);
  const { data: errorTypes = [] } = useQuery(errorTypesQuery);
  const { data: results, isSuccess } = useQuery(examResultsQuery(examId));
  const { data: sheets = [], isSuccess: sheetsOk } = useQuery(examSheetsQuery(examId));
  const { data: sheetSettings } = useQuery(sheetSettingsQuery);
  const exam = exams.find((e) => e.id === examId);
  const labels = mergeLabels(sheetSettings?.labels);
  const { harf, tecvid } = kiraatColumns(errorTypes);
  const cols = [...harf, ...tecvid];
  const [courseId, setCourseId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [infos, setInfos] = useState<Record<string, SheetInfo & { dirty?: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const activeCourse = courseId ?? courses[0]?.id ?? null;
  const course = courses.find((c) => c.id === activeCourse);
  const ids = courses.map((c) => c.id);

  useEffect(() => {
    if (!isSuccess) return;
    const next: Record<string, Draft> = {};
    for (const s of students) {
      const r = results.find((x) => x.student_id === s.id);
      const counts: Record<string, number> = {};
      const errs = (r?.kiraat_errors ?? []) as KiraatError[];
      for (const e of errs) counts[e.id] = (counts[e.id] ?? 0) + (Number(e.count) || 0);
      next[s.id] = {
        counts, oldErrors: errs,
        ezber: r ? String(r.ezber) : "", ilmihal: r ? String(r.ilmihal) : "", siyer: r ? String(r.siyer) : "",
        marks: toMarks((r as { sheet_marks?: unknown } | undefined)?.sheet_marks),
        dirty: false, exists: !!r,
      };
    }
    setDrafts(next);
  }, [isSuccess, results, students]);

  useEffect(() => {
    if (!sheetsOk) return;
    const next: Record<string, SheetInfo> = {};
    for (const c of courses) {
      const s = sheets.find((x) => x.course_id === c.id);
      next[c.id] = s ? { ...emptyInfo(), ...s } : emptyInfo();
    }
    setInfos(next);
  }, [sheetsOk, sheets, courses]);

  const list = useMemo(
    () => students.filter((s) => s.course_id === activeCourse).sort((a, b) => compareTr(fullName(a), fullName(b))),
    [students, activeCourse],
  );
  const dirtyCount = Object.values(drafts).filter((d) => d.dirty).length + Object.values(infos).filter((i) => i.dirty).length;

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => {
      const current = d[id];
      return current ? { ...d, [id]: { ...current, ...patch, dirty: true } } : d;
    });
  const updateInfo = (patch: Partial<SheetInfo>) => {
    if (!activeCourse) return;
    setInfos((i) => ({ ...i, [activeCourse]: { ...(i[activeCourse] ?? emptyInfo()), ...patch, dirty: true } }));
  };

  /** Current types use today's deductions; errors of deleted types keep their saved snapshot. */
  function errorsOf(d: Draft): KiraatError[] {
    return sheetErrors(cols, d.counts, d.oldErrors);
  }

  async function saveAll() {
    if (!isAdmin) return;
    const rows = Object.entries(drafts).filter(([, d]) => d.dirty).flatMap(([sid, d]) => {
      const st = students.find((s) => s.id === sid);
      if (!st) return [];
      return [{
        exam_id: examId, student_id: sid, course_id: st.course_id,
        kiraat_errors: errorsOf(d) as unknown as never,
        ezber: toNum(d.ezber), ilmihal: toNum(d.ilmihal), siyer: toNum(d.siyer),
        sheet_marks: d.marks as unknown as never,
      }];
    });
    const sheetRows = Object.entries(infos).filter(([, i]) => i.dirty).map(([cid, i]) => {
      const { dirty: _d, ...rest } = i;
      return { ...rest, exam_date: rest.exam_date || null, exam_id: examId, course_id: cid, updated_at: new Date().toISOString() };
    });
    if (!rows.length && !sheetRows.length) return;
    setSaving(true);
    const [a, b] = await Promise.all([
      rows.length ? supabase.from("exam_results").upsert(rows, { onConflict: "exam_id,student_id" }) : Promise.resolve({ error: null }),
      sheetRows.length ? supabase.from("exam_sheets").upsert(sheetRows, { onConflict: "exam_id,course_id" }) : Promise.resolve({ error: null }),
    ]);
    setSaving(false);
    const err = a.error ?? b.error;
    if (err) { toast.error("Kaydedilemedi: " + err.message); return; }
    toast.success("Cetvel kaydedildi");
    qc.invalidateQueries();
  }

  async function downloadPdf(blank = false) {
    if (!exam || !sheetSettings) return;
    if (dirtyCount) { toast.error("PDF indirmeden önce değişiklikleri kaydedin."); return; }
    const { examSheetPdf, savePdf } = await import("@/lib/pdf");
    const inputs = sheetPdfInputs({ exam, courses, students, results: results ?? [], errorTypes, sheets, settings: sheetSettings, blank });
    if (!inputs.length) { toast.error("Önce öğrenci ekleyin."); return; }
    savePdf(await examSheetPdf(inputs), `${blank ? "bos-" : ""}imtihan-cetveli-${examLabel(exam).replace(" ", "-")}.pdf`);
  }

  if (!exam) return <AppShell><EmptyState>İmtihan bulunamadı.</EmptyState></AppShell>;
  const info = (activeCourse && infos[activeCourse]) || emptyInfo();
  const ro = !isAdmin;

  const field = (label: string, value: string, onChange?: (v: string) => void, type = "text") => (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      {onChange && !ro ? (
        <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} className="h-9 bg-card text-sm text-foreground" />
      ) : (
        <span className="flex h-9 items-center rounded-md border bg-secondary px-3 text-sm text-foreground">{value || "—"}</span>
      )}
    </label>
  );

  const cell = (value: string, onChange: (v: string) => void, label: string) =>
    ro ? <span className="block px-1 py-2">{value}</span> : (
      <input aria-label={label} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="sheet-input" />
    );

  return (
    <AppShell
      title={`${examLabel(exam)} İmtihan Cetveli`}
      actions={
        <>
          <Button variant="outline" onClick={() => downloadPdf()}><FileDown /> Cetvel PDF</Button>
          <Button variant="outline" onClick={() => downloadPdf(true)}><FileDown /> Boş cetvel</Button>
          {isAdmin && <Button onClick={saveAll} disabled={!dirtyCount || saving}><Save /> {saving ? "Kaydediliyor…" : `Kaydet${dirtyCount ? ` (${dirtyCount})` : ""}`}</Button>}
        </>
      }
    >
      <Link to="/imtihanlar" className="-mt-4 mb-4 inline-block text-sm text-muted-foreground hover:underline">← İmtihanlar</Link>
      {courses.length === 0 ? (
        <EmptyState>Önce kurs ve öğrenci ekleyin.</EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {courses.map((c) => (
              <Button variant="outline" key={c.id} onClick={() => setCourseId(c.id)} style={courseColorVar(ids, c.id)}
                className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                  activeCourse === c.id ? "course-tint border-transparent course-text" : "bg-card hover:bg-secondary")}>
                <span className="course-dot size-2 rounded-full" />{c.name}
              </Button>
            ))}
          </div>

          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-center font-display text-lg font-bold tracking-wide">{sheetTitle(exam.exam_month, labels)}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {field(labels.bolge, sheetSettings?.bolgeName ?? "")}
              {field(labels.mintika, sheetSettings?.regionName ?? "")}
              {field(labels.kurum, course?.name ?? "")}
              {field(labels.grupMesulu, course?.group_leader ?? "")}
              {field(labels.grupSeviyesi, course?.group_level ?? "")}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              {field(`${labels.kiraatTitle} konusu`, info.kiraat_topic, (v) => updateInfo({ kiraat_topic: v }))}
              {field(`${labels.ezberTitle} — ${labels.ezberPart1}`, info.ezber_topic_1, (v) => updateInfo({ ezber_topic_1: v }))}
              {field(`${labels.ezberTitle} — ${labels.ezberPart2}`, info.ezber_topic_2, (v) => updateInfo({ ezber_topic_2: v }))}
            </div>
            {isAdmin && <p className="mt-2 text-xs text-muted-foreground">Bölge, Mıntıka, Grup Mesulü ve Grup Seviyesi Ayarlar'dan değiştirilir.</p>}
          </Card>

          {list.length === 0 ? (
            <EmptyState>Bu kursta öğrenci yok.</EmptyState>
          ) : (
            <Card className="mb-4 overflow-x-auto p-0">
              <table className="sheet-table w-full">
                <thead>
                  <tr>
                    <th rowSpan={3}>{labels.sira}</th>
                    <th rowSpan={3} className="min-w-40 text-left">{labels.adiSoyadi}</th>
                    <th colSpan={cols.length + 1}>{labels.kiraatTitle}<span className="mt-1 block text-[10px] font-normal">{labels.kiraatLine}</span></th>
                    <th colSpan={3}>{labels.ezberTitle}<span className="mt-1 block text-[10px] font-normal">{labels.ezberLine1}<br />{labels.ezberLine2}</span></th>
                    <th colSpan={3}>{labels.ilmihalTitle}</th>
                    <th colSpan={3}>{labels.siyerTitle}</th>
                    <th rowSpan={3}>Ortalama</th>
                  </tr>
                  <tr>
                    {harf.length > 0 && <th colSpan={harf.length} className="font-normal">{labels.harfNote}</th>}
                    {tecvid.length > 0 && <th colSpan={tecvid.length} className="font-normal">{labels.tecvidNote}</th>}
                    <th rowSpan={2}>{labels.kiraatPuan}<br />{labels.kiraatMax}</th>
                    <th rowSpan={2}>{labels.ezberPart1}</th>
                    <th rowSpan={2}>{labels.ezberPart2}</th>
                    <th rowSpan={2}>{labels.ezberPuan}<br />{labels.ezberMax}</th>
                    <th rowSpan={2}>{labels.ilmihalSual1}<br />{labels.ilmihalSualMax1}</th>
                    <th rowSpan={2}>{labels.ilmihalSual2}<br />{labels.ilmihalSualMax2}</th>
                    <th rowSpan={2}>{labels.ilmihalPuan}<br />{labels.ilmihalMax}</th>
                    <th rowSpan={2}>{labels.siyerSual1}<br />{labels.siyerSualMax1}</th>
                    <th rowSpan={2}>{labels.siyerSual2}<br />{labels.siyerSualMax2}</th>
                    <th rowSpan={2}>{labels.siyerPuan}<br />{labels.siyerMax}</th>
                  </tr>
                  <tr>
                    {cols.map((t) => (
                      <th key={t.id} className="h-28 align-bottom font-normal">
                        <span className="inline-block max-h-28 [writing-mode:vertical-rl] rotate-180 text-[11px] leading-tight">{t.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((s, i) => {
                    const d = drafts[s.id];
                    if (!d) return null;
                    const sc = liveScores(errorsOf(d), toNum(d.ezber), toNum(d.ilmihal), toNum(d.siyer));
                    const filled = d.exists || d.dirty;
                    const mark = (k: keyof SheetMarks) => cell(d.marks[k], (v) => update(s.id, { marks: { ...d.marks, [k]: numIn(v) } }), k);
                    return (
                      <tr key={s.id} className={cn(d.dirty && "bg-gold-soft")}>
                        <td className="px-1">{i + 1}</td>
                        <td className="whitespace-nowrap px-2 text-left font-semibold">{fullName(s)}</td>
                        {cols.map((t) => <td key={t.id}>{cell(String(d.counts[t.id] || ""), (v) => {
                          const n = Math.min(99, Math.max(0, parseInt(v.replace(/\D/g, "") || "0", 10)));
                          update(s.id, { counts: { ...d.counts, [t.id]: n } });
                        }, `${t.name} hata sayısı`)}</td>)}
                        <td className="sheet-score">{filled ? fmt(sc.kiraat) : ""}</td>
                        <td>{mark("ezber1")}</td>
                        <td>{mark("ezber2")}</td>
                        <td className="sheet-score">{cell(d.ezber, (v) => update(s.id, { ezber: numIn(v) }), "Ezber puanı")}</td>
                        <td>{mark("ilmihal1")}</td>
                        <td>{mark("ilmihal2")}</td>
                        <td className="sheet-score">{cell(d.ilmihal, (v) => update(s.id, { ilmihal: numIn(v) }), "İlmihal puanı")}</td>
                        <td>{mark("siyer1")}</td>
                        <td>{mark("siyer2")}</td>
                        <td className="sheet-score">{cell(d.siyer, (v) => update(s.id, { siyer: numIn(v) }), "Siyer puanı")}</td>
                        <td className="sheet-score text-primary">{filled ? fmt(sc.total) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          <Card className="p-4">
            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {field(labels.examiner, info.examiner, (v) => updateInfo({ examiner: v }))}
              {field(labels.examDate, info.exam_date ?? "", (v) => updateInfo({ exam_date: v || null }), "date")}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {([
                ["note_yuzune", labels.noteYuzune], ["note_ezber", labels.noteEzber],
                ["note_ilmihal", labels.noteIlmihal], ["note_siyer", labels.noteSiyer], ["note_genel", labels.noteGenel],
              ] as const).map(([k, l]) => (
                <label key={k} className={cn("flex flex-col gap-1 text-xs font-semibold text-muted-foreground", k === "note_genel" && "md:col-span-2")}>
                  {l}
                  {ro ? <span className="min-h-9 rounded-md border bg-secondary px-3 py-2 text-sm text-foreground">{info[k] || "—"}</span>
                    : <Textarea value={info[k]} onChange={(e) => updateInfo({ [k]: e.target.value.slice(0, 1000) })} rows={2} className="bg-card text-sm text-foreground" />}
                </label>
              ))}
            </div>
          </Card>

          {isAdmin && dirtyCount > 0 && (
            <div className="sticky bottom-4 mt-4 flex justify-end">
              <Button size="lg" onClick={saveAll} disabled={saving} className="shadow-lift"><Save /> {saving ? "Kaydediliyor…" : `${dirtyCount} değişikliği kaydet`}</Button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

