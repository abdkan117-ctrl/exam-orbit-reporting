import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AddStudentForm, StudentRow, sortStudents } from "@/components/StudentManager";
import { coursesQuery, studentsQuery } from "@/lib/data";
import { fullName } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ogrenciler")({
  head: () => ({
    meta: [
      { title: "Öğrenciler — Mıntıka İmtihan Sistemi" },
      { name: "description", content: "Kurslara göre öğrenci listesi; ekleme, silme ve isim değiştirme." },
      { property: "og:title", content: "Öğrenciler — Mıntıka İmtihan Sistemi" },
      { property: "og:description", content: "Kurslara göre öğrenci listesi; ekleme, silme ve isim değiştirme." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudentsPage,
});

function StudentsPage() {
  const { data: courses = [] } = useQuery(coursesQuery);
  const { data: students = [] } = useQuery(studentsQuery);
  const [q, setQ] = useState("");
  const needle = q.trim().toLocaleLowerCase("tr");
  const filtered = needle ? students.filter((s) => fullName(s).toLocaleLowerCase("tr").includes(needle)) : students;

  return (
    <AppShell title="Öğrenciler" actions={courses.length > 0 && <Dialog>
      <DialogTrigger asChild><Button><Plus /> Öğrenci ekle</Button></DialogTrigger>
      <DialogContent className="rounded-lg"><DialogHeader><DialogTitle>Yeni öğrenci</DialogTitle></DialogHeader><AddStudentForm courses={courses} /></DialogContent>
    </Dialog>}>
      {courses.length === 0 ? (
        <EmptyState>Önce Kurslar sayfasından kurs ekleyin.</EmptyState>
      ) : (
        <>
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
          <p className="text-sm text-muted-foreground">{students.length} öğrenci · {courses.length} kurs</p>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Öğrenci ara" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Öğrenci ara" className="h-11 rounded-md bg-card pl-9 shadow-none" />
          </div>
          </div>
          {needle && filtered.length === 0 && <EmptyState>Aramanızla eşleşen öğrenci bulunamadı.</EmptyState>}
          <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-2">
            {courses.map((c) => {
              const list = sortStudents(filtered.filter((s) => s.course_id === c.id));
              if (needle && !list.length) return null;
              return (
                <section key={c.id}>
                  <div className="flex items-baseline justify-between gap-3 border-b pb-4">
                    <h2 className="break-words text-xl font-semibold">{c.name}</h2>
                    <span className="shrink-0 text-xs text-muted-foreground">{list.length} öğrenci</span>
                  </div>
                  <div className="divide-y">
                    {list.length === 0 && <p className="py-5 text-sm text-muted-foreground">Öğrenci yok.</p>}
                    {list.map((s) => <StudentRow key={s.id} student={s} editable />)}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
