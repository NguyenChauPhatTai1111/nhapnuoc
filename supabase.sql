CREATE TABLE IF NOT EXISTS public.water_households (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id text NOT NULL CHECK (household_id ~ '^[1-9][0-9]*$'),
  household_name text NOT NULL CHECK (char_length(household_name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, household_id)
);

CREATE TABLE IF NOT EXISTS public.water_readings (
  user_id uuid NOT NULL,
  household_id text NOT NULL,
  reading_year integer NOT NULL CHECK (reading_year BETWEEN 1 AND 9999),
  reading_month integer NOT NULL CHECK (reading_month BETWEEN 1 AND 12),
  previous_reading numeric(16,3) NOT NULL CHECK (previous_reading BETWEEN 0 AND 1000000000000),
  current_reading numeric(16,3) NOT NULL CHECK (current_reading BETWEEN 0 AND 1000000000000 AND current_reading >= previous_reading),
  consumption numeric(16,3) GENERATED ALWAYS AS (current_reading - previous_reading) STORED,
  start_period char(7) NULL CHECK (start_period IS NULL OR start_period ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  debt_amount bigint NOT NULL DEFAULT 0 CHECK (debt_amount BETWEEN 0 AND 1000000000000),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, household_id, reading_year, reading_month),
  FOREIGN KEY (user_id, household_id) REFERENCES public.water_households(user_id, household_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS water_readings_period_idx ON public.water_readings(user_id, reading_year, reading_month);

ALTER TABLE public.water_households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_readings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.water_households, public.water_readings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.water_households, public.water_readings TO authenticated;

DROP POLICY IF EXISTS "Quản lý hộ thuộc tài khoản" ON public.water_households;
CREATE POLICY "Quản lý hộ thuộc tài khoản" ON public.water_households
FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Quản lý chỉ số thuộc tài khoản" ON public.water_readings;
CREATE POLICY "Quản lý chỉ số thuộc tài khoản" ON public.water_readings
FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.sync_water_data(p_households jsonb, p_readings jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  owner_id uuid := auth.uid();
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Chưa đăng nhập'; END IF;
  IF jsonb_typeof(p_households) <> 'array' OR jsonb_array_length(p_households) > 5000 THEN RAISE EXCEPTION 'Danh sách hộ không hợp lệ'; END IF;
  IF jsonb_typeof(p_readings) <> 'array' OR jsonb_array_length(p_readings) > 250000 THEN RAISE EXCEPTION 'Danh sách chỉ số không hợp lệ'; END IF;

  DELETE FROM water_readings WHERE user_id = owner_id;
  DELETE FROM water_households WHERE user_id = owner_id;

  INSERT INTO water_households (user_id, household_id, household_name, active, updated_at)
  SELECT owner_id, x.household_id, x.household_name, x.active, now()
  FROM jsonb_to_recordset(p_households) AS x(household_id text, household_name text, active boolean);

  INSERT INTO water_readings (user_id, household_id, reading_year, reading_month, previous_reading, current_reading, start_period, debt_amount, note, updated_at)
  SELECT owner_id, x.household_id, x.reading_year, x.reading_month, x.previous_reading, x.current_reading,
         NULLIF(x.start_period, ''), x.debt_amount, x.note, now()
  FROM jsonb_to_recordset(p_readings) AS x(
    household_id text, reading_year integer, reading_month integer,
    previous_reading numeric, current_reading numeric, start_period text,
    debt_amount bigint, note text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_water_data(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_water_data(jsonb, jsonb) TO authenticated;

-- Bảng JSON cũ được giữ lại làm bản dự phòng trong lúc chuyển đổi. Sau khi
-- kiểm tra các dòng trong hai bảng mới, có thể tự xóa water_app_state.
