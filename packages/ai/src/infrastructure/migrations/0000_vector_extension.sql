-- Custom migration (drizzle-kit generate --custom): pgvector, for search.chunk's halfvec column and HNSW index.
-- A no-op where the extension exists. Locally and in tests packages/db/sql/roles.sql creates it as the superuser;
-- in Azure `vector` must be allow-listed in azure.extensions (infra/README.md, pgvector).
CREATE EXTENSION IF NOT EXISTS vector;
