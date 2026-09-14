CREATE TABLE IF NOT EXISTS public.water_app_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.water_app_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.water_app_state FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_app_state TO authenticated;

DROP POLICY IF EXISTS "Người dùng đọc sổ của mình" ON public.water_app_state;
CREATE POLICY "Người dùng đọc sổ của mình"
ON public.water_app_state FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Người dùng tạo sổ của mình" ON public.water_app_state;
CREATE POLICY "Người dùng tạo sổ của mình"
ON public.water_app_state FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Người dùng cập nhật sổ của mình" ON public.water_app_state;
CREATE POLICY "Người dùng cập nhật sổ của mình"
ON public.water_app_state FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);
