import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { SheetPhotoImport } from "@/components/SheetPhotoImport";
import { Button } from "@/components/ui/button";
import { coursesQuery, errorTypesQuery, examResultsQuery, examSheetsQuery, examsQuery, sheetSettingsQuery, studentsQuery, useMe } from "@/lib/data";
import { compareTr, examLabel, fullName } from "@/lib/format";
import { sheetPdfInputs } from "@/lib/reports";
import { emptyInfo } from "@/lib/sheet";

export const Route = createFileRoute("/_authenticated/imtihanlar/$examId")({
  head: () => ({
    meta: [
      { title: "Cetvel Fotoğrafı — Mıntıka İmtihan Sistemi" },
      { name: "description", content: "İmtihan cetveli fotoğrafını yükleyin, okunan talebeleri ve puanları kontrol ederek aktarın." },
      { property: "og:title", content: "Cetvel Fotoğrafı — Mıntıka İmtihan Sistemi" },
      { property: "og:description", content: "İmtihan cetveli fotoğrafını yükleyin, okunan talebeleri ve puanları kontrol ederek aktarın." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExamSheet,
});

function ExamSheet() {
  const { examId } = Route.useParams();
  const { data: me } = useMe();
  const { data: exams = [], isPending: examsPending } = useQuery(examsQuery);
  const { data: courses = [] } = useQuery(coursesQuery);
  const { data: students = [], isPending: studentsPending } = useQuery(studentsQuery);
  const { data: errorTypes = [], isPending: errorsPending } = useQuery(errorTypesQuery);
  const { data: results = [], isPending: resultsPending } = useQuery(examResultsQuery(examId));
  const { data: sheets = [], isPending: sheetsPending } = useQuery(examSheetsQuery(examId));
  const { data: sheetSettings } = useQuery(sheetSettingsQuery);
  const [courseId, setCourseId] = useState<string | null>(null);
  const exam = exams.find((e) => e.id === examId);
  const course = courses.find((c) => c.id === courseId) ?? courses[0];
  const list = useMemo(
    () => students.filter((s) => s.course_id === course?.id).sort((a, b) => compareTr(fullName(a), fullName(b))),
    [students, course?.id],
  );
  const info = sheets.find((s) => s.course_id === course?.id) ?? emptyInfo();
  const courseResults = results.filter((r) => r.course_id === course?.id);
  const importPending = studentsPending || errorsPending || resultsPending || sheetsPending;

  async function downloadPdf(blank = false) {
    if (!exam || !sheetSettings) return;
    const { examSheetPdf, savePdf } = await import("@/lib/pdf");
    const inputs = sheetPdfInputs({ exam, courses, students, results, errorTypes, sheets, settings: sheetSettings, blank });
    if (!inputs.length) { toast.error("Önce öğrenci ekleyin."); return; }
    savePdf(await examSheetPdf(inputs), `${blank ? "bos-" : ""}imtihan-cetveli-${examLabel(exam).replace(" ", "-")}.pdf`);
  }

  if (examsPending) return <AppShell><EmptyState>İmtihan yükleniyor…</EmptyState></AppShell>;
  if (!exam) return <AppShell><EmptyState>İmtihan bulunamadı.</EmptyState></AppShell>;

  return (
    <AppShell
      title={`${examLabel(exam)} · Cetvel Fotoğrafı`}
      actions={
        <>
          <Button variant="outline" disabled={!sheetSettings || importPending} onClick={() => downloadPdf()}><FileDown /> Cetvel PDF</Button>
          <Button variant="outline" disabled={!sheetSettings || importPending} onClick={() => downloadPdf(true)}><FileDown /> Boş cetvel</Button>
        </>
      }
    >
      <Link to="/imtihanlar" className="-mt-4 mb-4 inline-block text-sm text-muted-foreground hover:underline">← İmtihanlar</Link>
      {course ? (
        <>
          <div className="mb-6 flex flex-wrap gap-2" aria-label="Kurslar">
            {courses.map((c) => (
              <Button variant={course.id === c.id ? "default" : "outline"} key={c.id} onClick={() => setCourseId(c.id)} aria-pressed={course.id === c.id}>
                {c.name}
              </Button>
            ))}
          </div>
          <section className="border-y py-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{course.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{list.length} talebe · {courseResults.length} talebenin puanı kayıtlı</p>
              </div>
              {me?.isAdmin && <SheetPhotoImport
                key={course.id}
                examId={examId}
                examName={examLabel(exam)}
                courseId={course.id}
                courseName={course.name}
                students={list}
                errorTypes={errorTypes}
                results={courseResults}
                sheet={info}
                disabled={importPending}
              />}
            </div>
          </section>
        </>
      ) : <EmptyState>Önce kurs ve öğrenci ekleyin.</EmptyState>}
    </AppShell>
  );
}
