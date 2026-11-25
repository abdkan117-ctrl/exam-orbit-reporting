CREATE TABLE public.exam_sheet_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
 course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
 uploaded_by uuid NOT NULL,
 storage_path text NOT NULL UNIQUE,
 file_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.exam_sheet_photos TO authenticated;
GRANT ALL ON public.exam_sheet_photos TO service_role;
ALTER TABLE public.exam_sheet_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read sheet photos" ON public.exam_sheet_photos FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins add own sheet photos" ON public.exam_sheet_photos FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND uploaded_by = auth.uid() AND storage_path LIKE auth.uid()::text || '/' || exam_id::text || '/' || course_id::text || '/%');
CREATE POLICY "Admins remove sheet photos" ON public.exam_sheet_photos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TABLE public.ai_feature_state (
 feature text PRIMARY KEY,
 blocked_status integer NOT NULL,
 message text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_feature_state TO authenticated;
GRANT ALL ON public.ai_feature_state TO service_role;
ALTER TABLE public.ai_feature_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage AI feature state" ON public.ai_feature_state FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upload own sheet images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'exam-sheet-photos' AND (storage.foldername(name))[1] = auth.uid()::text AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read sheet images" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'exam-sheet-photos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins remove own sheet images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'exam-sheet-photos' AND (storage.foldername(name))[1] = auth.uid()::text AND public.has_role(auth.uid(), 'admin'));