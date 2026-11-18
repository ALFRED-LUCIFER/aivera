import { DbQueryError, type Tx } from '@aivera/db/client';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { CandidateStore } from '../application/people.ts';
import { person, personIdentifier } from './schema.ts';

/**
 * The candidates store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function candidateStore(tx: Tx): CandidateStore {
  return {
    async findPersonId(workspaceId, identifiers) {
      const [row] = await tx
        .select({ id: person.id, mergedIntoId: person.mergedIntoId })
        .from(personIdentifier)
        .innerJoin(person, eq(person.id, personIdentifier.personId))
        .where(
          and(
            eq(personIdentifier.workspaceId, workspaceId),
            eq(person.workspaceId, workspaceId),
            or(...identifiers.map((i) => and(eq(personIdentifier.type, i.type), eq(personIdentifier.value, i.value)))),
          ),
        )
        .orderBy(asc(person.createdAt), asc(person.id))
        .limit(1);
      return row ? (row.mergedIntoId ?? row.id) : null;
    },
    async insertPerson(values, identifiers) {
      try {
        // A savepoint, so a concurrent insert of the same identifier leaves the caller's transaction usable.
        await tx.transaction(async (sp) => {
          await sp.insert(person).values(values);
          await sp
            .insert(personIdentifier)
            .values(identifiers.map((i) => ({ ...i, workspaceId: values.workspaceId, personId: values.id })));
        });
        return true;
      } catch (error) {
        if (error instanceof DbQueryError && error.constraint === 'person_identifier_pkey') return false;
        throw error;
      }
    },
    async getPerson(workspaceId, personId) {
      const [row] = await tx
        .select()
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)));
      return row ?? null;
    },
    listPeople(workspaceId) {
      return tx
        .select()
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), isNull(person.mergedIntoId)))
        .orderBy(asc(person.createdAt), asc(person.id));
    },
  };
}
