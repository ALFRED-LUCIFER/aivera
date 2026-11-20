-- Custom migration (drizzle-kit generate --custom): pgvector, for search.chunk's halfvec column and HNSW index.
-- Locally and in tests packages/db/sql/roles.sql creates it as the superuser; in Azure `vector` is allow-listed in
-- azure.extensions and infra/sql/bootstrap-roles.sql creates it as the Entra admin (an untrusted extension;
-- infra/README.md, pgvector). Azure refuses CREATE EXTENSION to the migrator even with IF NOT EXISTS, so it runs
-- only when vector is missing (AIV-P0-932: edited after it applied locally, same effect; never applied on dev).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;
