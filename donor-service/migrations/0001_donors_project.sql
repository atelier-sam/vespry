-- 09/11/2026 — un mur par projet soutenu.
-- Pour une base créée avant cette date (schema.sql porte déjà la colonne).
-- Les soutiens existants étaient tous pour Vespry : la valeur par défaut les y range.
--   npx wrangler d1 execute vespry-donors --remote --file=migrations/0001_donors_project.sql
-- À jouer UNE fois : SQLite refuse un second ADD COLUMN du même nom (erreur sans effet).
ALTER TABLE donors ADD COLUMN project TEXT NOT NULL DEFAULT 'vespry';
CREATE INDEX IF NOT EXISTS idx_donors_project ON donors (project, seq);
