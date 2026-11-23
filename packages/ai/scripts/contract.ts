// Writes the AI service's contract (AIV-P2-068, ADR-015 point 4): JSON Schema from the zod schemas in src/service.ts.
// Run after changing one, then regenerate the service's pydantic models (apps/backend/ai-service/README.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractSchemas } from '../src/service.ts';

const root = new URL('../../../apps/backend/ai-service/contract/', import.meta.url);
for (const [path, schema] of Object.entries(contractSchemas())) {
  const file = new URL(path, root);
  mkdirSync(dirname(fileURLToPath(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
}
