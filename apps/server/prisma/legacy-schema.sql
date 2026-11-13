-- Pre-M1 legacy structure, exactly as it exists in the production `story`
-- database before migration 20261109000000_init.
--
-- Used to bootstrap a clean database (tests, local dev) so the real init
-- migration can run against a faithful replica. NEVER run this against
-- production — it would collide with the live tables.

CREATE TABLE IF NOT EXISTS public.story_category (
  id      serial PRIMARY KEY,
  name    text NOT NULL,
  sort_id integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.story_main (
  id            serial PRIMARY KEY,
  category_id   integer REFERENCES public.story_category (id),
  title         text NOT NULL,
  category_name text,
  created_at    timestamptz DEFAULT now(),
  excerpt       text,
  length        integer
);

CREATE TABLE IF NOT EXISTS public.story_content (
  id       serial PRIMARY KEY,
  story_id integer REFERENCES public.story_main (id),
  content  text
);

-- Indexes present in production before M1.
CREATE INDEX IF NOT EXISTS story_main_pkey_idx ON public.story_main (id);
