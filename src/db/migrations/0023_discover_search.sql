-- Custom SQL migration file, put your code below! --

-- Bilingual (EN/TH) search for the anonymous Discover grid (US-DISC-02):
-- "matching works consistently for both languages, with or without accents/tone
-- marks".
--
-- `normalize(t, NFD)` splits every character into its base plus any combining
-- marks; stripping those mark ranges then makes "café" match "cafe" and Thai text
-- match whether or not its vowel/tone marks were typed. Lowercasing finishes the
-- job for Latin (Thai has no case). Declared IMMUTABLE so it can back an index —
-- `normalize`, `regexp_replace` and `lower` are all immutable themselves.
--
--   ̀-ͯ  Latin/Greek/Cyrillic combining diacritics
--   ั, ิ-ฺ, ็-๎  Thai combining vowels and tone marks
CREATE OR REPLACE FUNCTION public.search_norm(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT lower(
    regexp_replace(
      normalize(t, NFD),
      '[̀-ͯัิ-ฺ็-๎]',
      '',
      'g'
    )
  );
$$;

-- Discover searches title, city and venue on the event and the category name.
CREATE INDEX IF NOT EXISTS ix_events_search_name
  ON events (public.search_norm(name));
CREATE INDEX IF NOT EXISTS ix_events_search_city
  ON events (public.search_norm(city));
CREATE INDEX IF NOT EXISTS ix_events_search_venue
  ON events (public.search_norm(venue_name));
CREATE INDEX IF NOT EXISTS ix_categories_search_name
  ON categories (public.search_norm(name));

-- The grid pages soonest-first across every tenant, over public events only.
CREATE INDEX IF NOT EXISTS ix_events_discover
  ON events (start_at)
  WHERE deleted_at IS NULL AND visibility = 'public';
