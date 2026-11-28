BEGIN;
CREATE TABLE IF NOT EXISTS public.friday_staff_profile (
  user_id integer PRIMARY KEY REFERENCES public."user"(id),
  payload text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.friday_owner_settings (
  user_id integer PRIMARY KEY REFERENCES public."user"(id),
  payload text NOT NULL,
  version integer NOT NULL DEFAULT 1
);
ALTER TABLE public.friday_staff_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friday_owner_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.friday_staff_profile, public.friday_owner_settings FROM PUBLIC, anon, authenticated;
COMMIT;
