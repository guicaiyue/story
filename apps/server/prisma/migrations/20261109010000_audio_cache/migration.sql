-- M4: server-side TTS synthesis cache (owner decision c-mw99xnkq-2ehou).
--
-- Audio is synthesised on demand by the API and cached on disk; this table is
-- the index so a second request for the same story never re-synthesises.
-- MP3 bytes live under AUDIO_CACHE_DIR (default: apps/server/.audio-cache),
-- NOT in Postgres — keeping large blobs out of the database that pREST reads.
--
-- Idempotent: safe to re-run. Additive only; no legacy table is touched.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------------
-- app.audio_cache — one row per synthesised story.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.audio_cache (
  story_id     integer PRIMARY KEY,
  -- Relative path inside AUDIO_CACHE_DIR. Stored relative so the cache dir can
  -- move (dev -> container -> prod) without rewriting rows.
  file_path    text        NOT NULL,
  mime_type    text        NOT NULL DEFAULT 'audio/mpeg',
  byte_size    integer     NOT NULL,
  -- Measured from the MP3 itself, so this is real playback duration.
  duration_sec integer     NOT NULL,
  -- Which voice/format produced it; lets us invalidate after a voice change.
  voice        text        NOT NULL,
  char_count   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Set when the row is reused, so we can see what is actually hot.
  last_hit_at  timestamptz NOT NULL DEFAULT now(),
  hit_count    integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS audio_cache_last_hit_idx ON app.audio_cache (last_hit_at DESC);

-- ---------------------------------------------------------------------------
-- app.audio_job — synthesis queue/audit for batch backfill.
--    Lets a batch run resume after a crash and shows which stories failed
--    (and why) without digging through logs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.audio_job (
  id          text PRIMARY KEY,
  story_id    integer     NOT NULL,
  state       text        NOT NULL DEFAULT 'pending', -- pending | running | done | failed | skipped
  attempts    integer     NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audio_job_state_idx  ON app.audio_job (state);
CREATE INDEX IF NOT EXISTS audio_job_story_idx  ON app.audio_job (story_id);

-- ---------------------------------------------------------------------------
-- Grants: `app` is service-only. pREST and other legacy read roles must not
-- reach it (same closure as the M1 init migration).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  owner_role text := current_user;
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC',
    owner_role
  );

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prest_story') THEN
    REVOKE ALL ON app.audio_cache FROM prest_story;
    REVOKE ALL ON app.audio_job   FROM prest_story;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.audio_cache FROM anon;
    REVOKE ALL ON app.audio_job   FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lingxibi') THEN
    REVOKE ALL ON app.audio_cache FROM lingxibi;
    REVOKE ALL ON app.audio_job   FROM lingxibi;
  END IF;
END
$$;

COMMIT;
