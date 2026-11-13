-- M1 init: additive columns on legacy story_main + isolated `app` schema.
-- Per docs/product/03-decisions.md D1/D2/D3: no data migration, no legacyId,
-- old tables stay in `public`, new tables go to schema `app`.
-- Idempotent: safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. app schema — new tables. Legacy `public` tables are untouched.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. legacy public.story_main — additive columns only (D3).
--    content stays in public.story_content; nothing is moved or copied.
-- ---------------------------------------------------------------------------
ALTER TABLE public.story_main
  ADD COLUMN IF NOT EXISTS age_band     text        NOT NULL DEFAULT '3-6',
  ADD COLUMN IF NOT EXISTS tags         text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status       text        NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS duration_sec integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cover_url    text,
  ADD COLUMN IF NOT EXISTS audio_url    text,
  ADD COLUMN IF NOT EXISTS featured     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

-- The 2197 existing rows are live production content.
UPDATE public.story_main SET status = 'published' WHERE status IS NULL;
-- Legacy rows are already live, so treat their creation time as publication time.
UPDATE public.story_main SET published_at = created_at WHERE published_at IS NULL;

-- 00-research P1: 怪谈/恐怖/推理 (category 15/16/17) must not surface to children.
UPDATE public.story_main SET age_band = '9+' WHERE category_id IN (15, 16, 17);

CREATE INDEX IF NOT EXISTS story_main_status_age_band_idx ON public.story_main (status, age_band);
CREATE INDEX IF NOT EXISTS story_main_category_id_idx     ON public.story_main (category_id);

-- ---------------------------------------------------------------------------
-- 3. app schema tables (02-architecture §3.2–3.4)
-- ---------------------------------------------------------------------------
-- Account.phone is nullable + unique: guest upgrade rules are deliberately
-- undecided in M1 (03-decisions D6), so child data must hang off accountId.
CREATE TABLE IF NOT EXISTS app.account (
  id         text PRIMARY KEY,
  phone      text UNIQUE,
  nickname   text        NOT NULL DEFAULT '',
  role       text        NOT NULL DEFAULT 'parent', -- parent | admin | editor
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.family (
  id         text PRIMARY KEY,
  account_id text        NOT NULL UNIQUE REFERENCES app.account (id) ON DELETE CASCADE,
  name       text        NOT NULL DEFAULT '我的家',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.child (
  id         text PRIMARY KEY,
  account_id text        NOT NULL REFERENCES app.account (id) ON DELETE CASCADE,
  nickname   text        NOT NULL,
  birthday   timestamptz,
  age_band   text        NOT NULL DEFAULT '3-6',
  avatar     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS child_account_id_idx ON app.child (account_id);

CREATE TABLE IF NOT EXISTS app.progress (
  id           text PRIMARY KEY,
  account_id   text        NOT NULL,
  story_id     integer     NOT NULL,
  position_sec integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT progress_account_id_story_id_key UNIQUE (account_id, story_id)
);
CREATE INDEX IF NOT EXISTS progress_account_id_idx ON app.progress (account_id);

CREATE TABLE IF NOT EXISTS app.favorite (
  id         text PRIMARY KEY,
  account_id text        NOT NULL,
  story_id   integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorite_account_id_story_id_key UNIQUE (account_id, story_id)
);
CREATE INDEX IF NOT EXISTS favorite_account_id_idx ON app.favorite (account_id);

CREATE TABLE IF NOT EXISTS app.play_event (
  id           text PRIMARY KEY,
  account_id   text,
  child_id     text,
  story_id     integer     NOT NULL,
  event        text        NOT NULL, -- start | pause | complete | stop
  position_sec integer     NOT NULL DEFAULT 0,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS play_event_at_idx ON app.play_event (at);

CREATE TABLE IF NOT EXISTS app.setting (
  id              text PRIMARY KEY,
  account_id      text    NOT NULL UNIQUE,
  daily_limit_min integer NOT NULL DEFAULT 0,  -- 0 = 不限
  sleep_timer_min integer NOT NULL DEFAULT 30,
  age_filter      text    NOT NULL DEFAULT '3-6',
  parent_gate     boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS app.banner (
  id          serial PRIMARY KEY,
  title       text    NOT NULL,
  image_url   text    NOT NULL,
  target_type text    NOT NULL DEFAULT 'story', -- story | category | url
  target_id   text,
  sort        integer NOT NULL DEFAULT 0,
  status      text    NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS app.audit_log (
  id       text PRIMARY KEY,
  actor_id text        NOT NULL,
  action   text        NOT NULL,
  target   text        NOT NULL,
  detail   jsonb,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON app.audit_log (at);

-- ---------------------------------------------------------------------------
-- 4. Lock the new schema down.
--
-- The pre-M1 legacy tables in `public` keep whatever grants already exist
-- (03-decisions D2: pREST's read channel is unchanged). This section only
-- concerns the NEW `app` schema.
--
-- NOTE: the publicly-routed pREST container (story-api.xirizhi.cn) connects as
-- the `postgres` SUPERUSER, which bypasses these grants entirely — see
-- 03-decisions §6. Treat this as defence-in-depth for non-superuser roles.
--
-- ALTER DEFAULT PRIVILEGES is scoped to the CURRENT_USER rather than a
-- hard-coded `postgres`, so the migration also runs on the dev database
-- (03-decisions D7), whose owner role has a different name.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;

DO $$
DECLARE
  owner_role text := current_user;
BEGIN
  -- Applies to objects this role creates later in the schema.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC',
    owner_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC',
    owner_role
  );

  -- Revoke from any legacy read roles that happen to exist in this database.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prest_story') THEN
    REVOKE ALL ON SCHEMA app FROM prest_story;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM prest_story;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA app FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lingxibi') THEN
    REVOKE ALL ON SCHEMA app FROM lingxibi;
  END IF;
END
$$;

COMMIT;
