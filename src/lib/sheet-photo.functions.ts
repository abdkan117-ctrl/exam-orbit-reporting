import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const analyzeSheetPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ photoId: z.string().uuid(), resume: z.boolean().default(false) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: allowed } = await db.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!allowed) { setResponseStatus(403); return { ok: false as const, status: 403, error: "Fotoğraf aktarımı için yönetici olmalısınız." }; }
    const { data: blocked, error: stateError } = await db.from("ai_feature_state").select("blocked_status,message").eq("feature", "sheet-photo").maybeSingle();
    if (stateError) return { ok: false as const, status: 500, error: "Fotoğraf hizmetinin durumu kontrol edilemedi." };
    if (blocked && !(blocked.blocked_status === 402 && data.resume)) {
      setResponseStatus(blocked.blocked_status);
      return { ok: false as const, status: blocked.blocked_status, error: blocked.message };
    }
    if (blocked && data.resume) await db.from("ai_feature_state").delete().eq("feature", "sheet-photo").eq("blocked_status", 402);
    const { data: photo } = await db.from("exam_sheet_photos").select("*").eq("id", data.photoId).maybeSingle();
    if (!photo) return { ok: false as const, status: 404, error: "Cetvel fotoğrafı bulunamadı." };
    const [course, exam, students, errors, settings] = await Promise.all([
      db.from("courses").select("id,name").eq("id", photo.course_id).single(),
      db.from("exams").select("exam_month,exam_year").eq("id", photo.exam_id).single(),
      db.from("students").select("first_name,last_name").eq("course_id", photo.course_id),
      db.from("error_types").select("id,name,category").order("sort_order"),
      db.from("app_settings").select("sheet_labels").eq("id", 1).single(),
    ]);
    if (course.error || exam.error || students.error || errors.error || settings.error) return { ok: false as const, status: 500, error: "Talebe ve cetvel bilgileri okunamadı." };
    const { data: blob, error: downloadError } = await db.storage.from("exam-sheet-photos").download(photo.storage_path);
    if (downloadError || !blob || blob.size > 6 * 1024 * 1024) return { ok: false as const, status: 400, error: "Fotoğraf okunamadı veya 6 MB sınırını aşıyor." };
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { ok: false as const, status: 503, error: "Lovable AI bağlantısı yapılandırılmamış." };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const { readSheetPhoto, PhotoAIError } = await import("./sheet-photo.server");
    try {
      const result = await readSheetPhoto(key, `data:${blob.type};base64,${btoa(binary)}`, JSON.stringify({ course: course.data, exam: exam.data, roster: students.data, columns: errors.data, labels: settings.data.sheet_labels }), getRequest().signal);
      return { ok: true as const, read: result.output, runId: result.runId };
    } catch (error) {
      const status = error instanceof PhotoAIError ? error.status : 502;
      const message = error instanceof PhotoAIError ? error.message : "Fotoğraf okunamadı.";
      if (status === 402 || status === 403) await db.from("ai_feature_state").upsert({ feature: "sheet-photo", blocked_status: status, message, updated_at: new Date().toISOString() });
      setResponseStatus(status);
      return { ok: false as const, status, error: message };
    }
  });