import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, RefreshCw, Save, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Card, EmptyState } from "@/components/AppShell";
import { ShareDialog } from "@/components/ShareDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { createManager, deleteManager, regenerateShareToken } from "@/lib/app.functions";
import { coursesQuery, errorTypesQuery, managersQuery, settingsQuery, useMe, type ErrorType } from "@/lib/data";
import { CATEGORY_LABELS, type ErrorCategory } from "@/lib/scoring";
import { mergeLabels, type SheetLabelKey, type SheetLabels } from "@/lib/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CourseRow } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/ayarlar")({
  head: () => ({
    meta: [
      { title: "Ayarlar — Mıntıka İmtihan Sistemi" },
      { name: "description", content: "Mıntıka adı, Kıraat hata türleri ve puan kesintileri, kurs sorumluları." },
      { property: "og:title", content: "Ayarlar — Mıntıka İmtihan Sistemi" },
      { property: "og:description", content: "Mıntıka adı, Kıraat hata türleri ve puan kesintileri, kurs sorumluları." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const toNum = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

function Section({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      {text && <p className="mb-4 mt-1 text-sm text-muted-foreground">{text}</p>}
      {children}
    </Card>
  );
}

function ConfirmDelete({ label, onConfirm, description }: { label: string; description: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${label} sil`}><Trash2 className="text-destructive" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label} silinsin mi?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Vazgeç</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Sil</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SettingsPage() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <AppShell title="Ayarlar"><EmptyState>Yükleniyor…</EmptyState></AppShell>;
  if (!me?.isAdmin) return <AppShell title="Ayarlar"><EmptyState>Bu sayfayı sadece yönetici açabilir.</EmptyState></AppShell>;
  return (
    <AppShell title="Ayarlar">
      <div className="space-y-6">
        <RegionSettings />
        <CourseSheetSettings />
        <SheetTextSettings />
        <ErrorTypeSettings />
        <ManagerSettings />
        <ShareSettings />
      </div>
    </AppShell>
  );
}

function RegionSettings() {
  const qc = useQueryClient();
  const { data } = useQuery(settingsQuery);
  const [name, setName] = useState("");
  const [bolge, setBolge] = useState("");
  useEffect(() => { if (data?.region_name) setName(data.region_name); }, [data?.region_name]);
  useEffect(() => { setBolge(data?.bolge_name ?? ""); }, [data?.bolge_name]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim().replace(/\s+/g, " ");
    if (!v) return;
    const { error } = await supabase.from("app_settings").update({ region_name: v, bolge_name: bolge.trim(), updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { toast.error("Kaydedilemedi"); return; }
    toast.success("Bölge ve mıntıka kaydedildi");
    qc.invalidateQueries();
  }

  return (
    <Section title="Bölge ve Mıntıka">
      <form onSubmit={save} className="flex flex-wrap gap-2">
        <label className="min-w-0 flex-1 space-y-1">Bölge<Input aria-label="Bölge adı" value={bolge} onChange={(e) => setBolge(e.target.value)} maxLength={80} className="h-11 text-base" /></label>
        <label className="min-w-0 flex-1 space-y-1">Mıntıka<Input aria-label="Mıntıka adı" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-11 text-base" /></label>
        <Button type="submit" className="h-11 self-end" disabled={!name.trim() || (name.trim() === data?.region_name && bolge.trim() === data?.bolge_name)}><Save /> Kaydet</Button>
      </form>
    </Section>
  );
}

function CourseSheetRow({ course }: { course: CourseRow }) {
  const qc = useQueryClient();
  const [leader, setLeader] = useState(course.group_leader);
  const [level, setLevel] = useState(course.group_level);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("courses").update({ group_leader: leader.trim(), group_level: level.trim() }).eq("id", course.id);
    setBusy(false);
    if (error) { toast.error("Kaydedilemedi"); return; }
    toast.success("Grup bilgileri kaydedildi");
    qc.invalidateQueries({ queryKey: ["courses"] });
  }
  return <form onSubmit={save} className="grid items-end gap-3 border-b py-4 sm:grid-cols-3">
    <h3 className="font-semibold sm:col-span-3">{course.name}</h3>
    <label className="space-y-1 text-sm">Grup Mesulü<Input aria-label={`${course.name} Grup Mesulü`} value={leader} onChange={(e) => setLeader(e.target.value)} maxLength={100} /></label>
    <label className="space-y-1 text-sm">Grup Seviyesi<Input aria-label={`${course.name} Grup Seviyesi`} value={level} onChange={(e) => setLevel(e.target.value)} maxLength={100} /></label>
    <Button type="submit" variant="outline" disabled={busy || (leader.trim() === course.group_leader && level.trim() === course.group_level)}><Save /> Kaydet</Button>
  </form>;
}

function CourseSheetSettings() {
  const { data: courses = [] } = useQuery(coursesQuery);
  return <Section title="Grup bilgileri">{courses.length ? courses.map((c) => <CourseSheetRow key={`${c.id}:${c.group_leader}:${c.group_level}`} course={c} />) : <p className="mt-3 text-muted-foreground">Henüz kurs yok.</p>}</Section>;
}

function SheetTextSettings() {
  const qc = useQueryClient();
  const { data } = useQuery(settingsQuery);
  const [labels, setLabels] = useState<SheetLabels>(() => mergeLabels(null));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setLabels(mergeLabels(data?.sheet_labels)); }, [data?.sheet_labels]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("app_settings").update({ sheet_labels: mergeLabels(labels), updated_at: new Date().toISOString() }).eq("id", 1);
    setBusy(false);
    if (error) { toast.error("Cetvel yazıları kaydedilemedi"); return; }
    toast.success("Cetvel yazıları kaydedildi");
    qc.invalidateQueries();
  }
  const groups: { title: string; keys: SheetLabelKey[] }[] = [
    { title: "Başlık ve üst bilgiler", keys: ["titleSuffix", "bolge", "mintika", "kurum", "grupMesulu", "grupSeviyesi", "sira", "adiSoyadi"] },
    { title: "Kırâat", keys: ["kiraatTitle", "kiraatLine", "harfNote", "tecvidNote", "kiraatPuan", "kiraatMax"] },
    { title: "Ezber", keys: ["ezberTitle", "ezberLine1", "ezberLine2", "ezberPart1", "ezberPart2", "ezberPuan", "ezberMax"] },
    { title: "İlmihal", keys: ["ilmihalTitle", "ilmihalSual1", "ilmihalSual2", "ilmihalSualMax1", "ilmihalSualMax2", "ilmihalPuan", "ilmihalMax"] },
    { title: "Siyer-i Nebi", keys: ["siyerTitle", "siyerSual1", "siyerSual2", "siyerSualMax1", "siyerSualMax2", "siyerPuan", "siyerMax"] },
    { title: "Alt bilgiler ve değerlendirmeler", keys: ["examiner", "examDate", "noteYuzune", "noteEzber", "noteIlmihal", "noteSiyer", "noteGenel"] },
  ];
  return <Section title="Cetvel yazıları"><form onSubmit={save} className="mt-4 space-y-3">
    {groups.map((group) => <details key={group.title} className="border-b pb-3"><summary className="cursor-pointer py-2 font-semibold">{group.title}</summary>
      <div className="grid gap-3 py-3 sm:grid-cols-2">{group.keys.map((key) => <label key={key} className="min-w-0 space-y-1 text-sm">
        <span className="block break-words text-muted-foreground">{mergeLabels(null)[key]}</span>
        <Textarea aria-label={`Cetvel yazısı: ${mergeLabels(null)[key]}`} value={labels[key]} maxLength={600} rows={2} onChange={(e) => setLabels((old) => ({ ...old, [key]: e.target.value }))} />
      </label>)}</div>
    </details>)}
    <Button type="submit" disabled={busy || JSON.stringify(mergeLabels(labels)) === JSON.stringify(mergeLabels(data?.sheet_labels))}><Save /> Cetvel yazılarını kaydet</Button>
  </form></Section>;
}

function ErrorTypeRow({ t }: { t: ErrorType }) {
  const qc = useQueryClient();
  const [name, setName] = useState(t.name);
  const [ded, setDed] = useState(String(t.deduction));
  const [repeat, setRepeat] = useState(t.repeat_deduction == null ? "" : String(t.repeat_deduction));
  const [cap, setCap] = useState(t.max_deduction == null ? "" : String(t.max_deduction));
  const changed = name.trim() !== t.name || toNum(ded) !== t.deduction || (repeat === "" ? null : toNum(repeat)) !== t.repeat_deduction || (cap === "" ? null : toNum(cap)) !== t.max_deduction;

  async function save() {
    const d = toNum(ded);
    const r = repeat === "" ? null : toNum(repeat);
    const m = cap === "" ? null : toNum(cap);
    if (!name.trim() || d === null || (repeat !== "" && r === null) || (cap !== "" && m === null)) { toast.error("Kesinti 0 ile 100 arasında olmalı"); return; }
    const { error } = await supabase.from("error_types").update({ name: name.trim(), deduction: d, repeat_deduction: r, max_deduction: m }).eq("id", t.id);
    if (error) { toast.error("Kaydedilemedi"); return; }
    toast.success("Kaydedildi");
    qc.invalidateQueries({ queryKey: ["error_types"] });
  }

  async function remove() {
    const { error } = await supabase.from("error_types").delete().eq("id", t.id);
    if (error) { toast.error("Silinemedi"); return; }
    toast.success("Hata türü silindi");
    qc.invalidateQueries({ queryKey: ["error_types"] });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-10 min-w-40 flex-1 font-semibold" aria-label="Hata adı" />
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">−</span>
        <Input value={ded} onChange={(e) => setDed(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5))} inputMode="decimal" className="h-10 w-20 text-center" aria-label="Kesinti" />
        <span className="text-sm text-muted-foreground">puan</span>
      </div>
      <label className="text-xs text-muted-foreground">Mükerrer hata<Input aria-label={`${t.name} mükerrer kesinti`} value={repeat} onChange={(e) => setRepeat(e.target.value)} inputMode="decimal" placeholder="Aynı" className="h-10 w-24" /></label>
      <label className="text-xs text-muted-foreground">En fazla kesinti<Input aria-label={`${t.name} en fazla kesinti`} value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="Sınırsız" className="h-10 w-24" /></label>
      <Button variant="outline" size="sm" onClick={save} disabled={!changed}><Save /> Kaydet</Button>
      <ConfirmDelete label={t.name} description="Daha önce girilmiş puanlar değişmez; bu hata sadece yeni girişlerde görünmez." onConfirm={remove} />
    </div>
  );
}

function ErrorTypeSettings() {
  const qc = useQueryClient();
  const { data: types = [] } = useQuery(errorTypesQuery);
  const [name, setName] = useState("");
  const [cat, setCat] = useState<ErrorCategory>("tecvid");
  const [ded, setDed] = useState("1");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const d = toNum(ded);
    if (!name.trim() || d === null) { toast.error("Ad ve 0–100 arası kesinti girin"); return; }
    const sort = Math.max(0, ...types.map((t) => t.sort_order)) + 1;
    const { error } = await supabase.from("error_types").insert({ name: name.trim(), category: cat, deduction: d, repeat_deduction: cat === "tecvid" ? 1 : null, max_deduction: cat === "tecvid" ? 2 : null, sort_order: sort });
    if (error) { toast.error("Eklenemedi"); return; }
    setName("");
    toast.success("Hata türü eklendi");
    qc.invalidateQueries({ queryKey: ["error_types"] });
  }

  return (
    <Section title="Kıraat hata türleri" text="Kıraat 100 puandan başlar; her hata için burada yazan puan düşülür. Değişiklik sadece bundan sonraki girişleri etkiler.">
      <div className="space-y-4">
        {(["tecvid", "harf", "diger"] as const).map((c) => {
          const list = types.filter((t) => t.category === c);
          return (
            <div key={c}>
              <p className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[c]} hataları</p>
              {list.length ? (
                <div className="divide-y rounded-xl border">{list.map((t) => <ErrorTypeRow key={`${t.id}:${t.name}:${t.deduction}:${t.repeat_deduction}:${t.max_deduction}`} t={t} />)}</div>
              ) : (
                <p className="text-sm text-muted-foreground">Bu grupta hata türü yok.</p>
              )}
            </div>
          );
        })}
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary p-3">
          <Input placeholder="Yeni hata adı (ör. İdğam)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-10 min-w-48 flex-1 bg-card" />
          <Select value={cat} onValueChange={(v) => setCat(v as ErrorCategory)}>
            <SelectTrigger className="h-10 w-36 bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["tecvid", "harf", "diger"] as const).map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">−</span>
            <Input value={ded} onChange={(e) => setDed(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5))} inputMode="decimal" className="h-10 w-20 bg-card text-center" aria-label="Yeni kesinti" />
            <span className="text-sm text-muted-foreground">puan</span>
          </div>
          <Button type="submit" className="h-10"><Plus /> Ekle</Button>
        </form>
      </div>
    </Section>
  );
}

function ManagerSettings() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: courses = [] } = useQuery(coursesQuery);
  const { data: managers = [] } = useQuery(managersQuery);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [courseId, setCourseId] = useState("");
  const [busy, setBusy] = useState(false);
  const courseName = new Map(courses.map((c) => [c.id, c.name]));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Şifre en az 8 karakter olmalı"); return; }
    setBusy(true);
    try {
      const res = await createManager({ data: { email: email.trim(), password, courseId } });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Kurs sorumlusu hesabı açıldı");
      setEmail("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["managers"] });
    } catch {
      toast.error("Hesap açılamadı. E-posta adresini kontrol edin.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    try {
      await deleteManager({ data: { userId } });
      toast.success("Hesap silindi");
      qc.invalidateQueries({ queryKey: ["managers"] });
    } catch {
      toast.error("Silinemedi");
    }
  }

  return (
    <Section title="Kurs sorumluları" text="Kurs sorumlusu sadece kendi kursunun öğrencilerini, sonuçlarını ve raporlarını görür; puan giremez.">
      {managers.length > 0 ? (
        <div className="mb-4 divide-y rounded-xl border">
          {managers.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.email}</p>
                <p className="text-sm text-muted-foreground">{courseName.get(m.course_id) ?? "Kurs silinmiş"}</p>
              </div>
              {m.user_id !== me?.userId && (
                <ConfirmDelete label={m.email} description="Bu kişi artık giriş yapamaz." onConfirm={() => remove(m.user_id)} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">Henüz kurs sorumlusu yok.</p>
      )}
      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sorumlu eklemek için önce kurs ekleyin.</p>
      ) : (
        <form onSubmit={add} className="flex flex-wrap gap-2 rounded-xl bg-secondary p-3">
          <Input type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} className="h-10 min-w-52 flex-1 bg-card" />
          <Input type="text" placeholder="Şifre (en az 8 karakter)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={100} className="h-10 min-w-44 flex-1 bg-card" />
          <Select value={courseId} onValueChange={setCourseId}>
            <SelectTrigger className="h-10 min-w-44 flex-1 bg-card"><SelectValue placeholder="Kurs seçin" /></SelectTrigger>
            <SelectContent>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="submit" className="h-10" disabled={busy || !courseId}><UserPlus /> {busy ? "Açılıyor…" : "Hesap aç"}</Button>
        </form>
      )}
      <p className="mt-2 text-xs text-muted-foreground">E-posta ve şifreyi sorumluya siz iletin; giriş sayfasından bu bilgilerle girer.</p>
    </Section>
  );
}

function ShareSettings() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function regenerate() {
    setBusy(true);
    try {
      await regenerateShareToken();
      toast.success("Yeni bağlantı oluşturuldu. Eski bağlantı artık açılmaz.");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch {
      toast.error("Yenilenemedi");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Paylaşım bağlantısı" text="Sıralamaları WhatsApp ile paylaşmak için. Bağlantı yanlış kişilere gittiyse yenileyin; eski bağlantı çalışmaz.">
      <div className="flex flex-wrap gap-2">
        <ShareDialog />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={busy}><RefreshCw /> Bağlantıyı yenile</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Bağlantı yenilensin mi?</AlertDialogTitle>
              <AlertDialogDescription>Daha önce gönderdiğiniz bağlantı artık açılmaz. Yeni bağlantıyı tekrar göndermeniz gerekir.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Vazgeç</AlertDialogCancel>
              <AlertDialogAction onClick={regenerate}>Yenile</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Section>
  );
}
