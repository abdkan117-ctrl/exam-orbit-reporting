import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { defaultPeriod, periodLabel } from "@/components/PeriodSelect";
import { useRankings } from "@/components/RankingsView";
import { coursesQuery, rankingsQuery } from "@/lib/data";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/kurslar/")({
  head: () => ({
    meta: [
      { title: "Kurslar — Mıntıka İmtihan Sistemi" },
      { name: "description", content: "Mıntıkadaki kurslar, öğrenci sayıları ve başarı ortalamaları." },
      { property: "og:title", content: "Kurslar — Mıntıka İmtihan Sistemi" },
      { property: "og:description", content: "Mıntıkadaki kurslar, öğrenci sayıları ve başarı ortalamaları." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CoursesPage,
});

function CoursesPage() {
  const qc = useQueryClient();
  const { data: courses = [] } = useQuery(coursesQuery);
  const { data: rk } = useQuery(rankingsQuery);
  const period = rk ? defaultPeriod(rk.exams) : null;
  const r = useRankings(rk ?? { courses: [], students: [], exams: [], results: [] }, period);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("courses").insert({ name: name.trim() });
    if (error) { toast.error("Kurs eklenemedi"); return; }
    setName("");
    setAdding(false);
    toast.success("Kurs eklendi");
    qc.invalidateQueries();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("courses").delete().eq("id", id);
    if (error) { toast.error("Kurs silinemedi"); return; }
    toast.success("Kurs silindi");
    qc.invalidateQueries();
  }

  return (
    <AppShell title="Kurslar" actions={
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogTrigger asChild><Button><Plus /> Kurs ekle</Button></DialogTrigger>
        <DialogContent className="rounded-lg">
          <DialogHeader><DialogTitle>Yeni kurs</DialogTitle></DialogHeader>
          <form onSubmit={add} className="flex flex-col gap-4">
            <Input aria-label="Kurs adı" placeholder="Kurs adı" value={name} onChange={(e) => setName(e.target.value)} className="h-11 text-base" maxLength={80} required />
            <Button type="submit" className="self-end"><Plus /> Kurs ekle</Button>
          </form>
        </DialogContent>
      </Dialog>
    }>

      {period && <p className="mb-3 text-sm text-muted-foreground">Sıra ve ortalama: {periodLabel(period, rk?.exams ?? [])}</p>}

      {courses.length === 0 ? (
        <EmptyState>Henüz kurs yok. Yukarıdan ilk kursu ekleyin.</EmptyState>
      ) : (
        <div className="border-t">
          {courses.map((c) => {
            const st = r.courses.find((x) => x.course_id === c.id);
            const count = rk?.students.filter((s) => s.course_id === c.id).length ?? 0;
            return (
              <div key={c.id} className="group flex items-center gap-3 border-b py-6 sm:gap-6 sm:py-7">
                <Link to="/kurslar/$courseId" params={{ courseId: c.id }} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="break-words text-xl font-semibold group-hover:text-primary">{c.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{count} öğrenci</p>
                  </div>
                  <div className="flex items-center gap-6 sm:gap-10">
                    {st && <><div><p className="text-xs text-muted-foreground">Ortalama</p><p className="mt-1 text-lg font-semibold tabular-nums">{fmt(st.average)}</p></div><div><p className="text-xs text-muted-foreground">Sıra</p><p className="mt-1 text-lg font-semibold tabular-nums">{st.rank}.</p></div></>}
                    <ArrowUpRight className="size-5 text-muted-foreground" />
                  </div>
                </Link>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Kursu sil" title="Kursu sil" className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"><Trash2 className="size-4" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{c.name} silinsin mi?</AlertDialogTitle>
                      <AlertDialogDescription>Kursun öğrencileri ve bütün imtihan sonuçları da silinir. Bu işlem geri alınamaz.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(c.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Sil</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
