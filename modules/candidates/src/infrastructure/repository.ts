import { DbQueryError, type Tx } from '@credalent/db/client';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { MergeStore } from '../application/merge.ts';
import type { CandidateStore } from '../application/people.ts';
import { UNNAMED_APPLICANT, type IdentifierType, type Person } from '../domain/person.ts';
import { merge, person, personIdentifier } from './schema.ts';

/**
 * The candidates store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function candidateStore(tx: Tx): CandidateStore & MergeStore {
  const store: CandidateStore & MergeStore = {
    async findPeople(workspaceId, identifiers) {
      const rows = await tx
        .select({ type: personIdentifier.type, personId: personIdentifier.personId })
        .from(personIdentifier)
        .where(
          and(
            eq(personIdentifier.workspaceId, workspaceId),
            or(...identifiers.map((i) => and(eq(personIdentifier.type, i.type), eq(personIdentifier.value, i.value)))),
          ),
        );
      const found = new Map<string, { person: Person; types: IdentifierType[] }>();
      for (const row of rows) {
        let current = await store.getPerson(workspaceId, row.personId);
        // A merged person's identifiers stay with them, so follow the merges to the person they are part of now.
        for (let hops = 0; current?.mergedIntoId && hops < 20; hops++)
          current = await store.getPerson(workspaceId, current.mergedIntoId);
        if (!current || current.mergedIntoId) throw new Error('identifier holder or merge chain not found');
        const entry = found.get(current.id) ?? { person: current, types: [] };
        entry.types.push(row.type);
        found.set(current.id, entry);
      }
      return [...found.values()].toSorted(
        (a, b) => +a.person.createdAt - +b.person.createdAt || a.person.id.localeCompare(b.person.id),
      );
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
    async attachIdentifiers(workspaceId, personId, identifiers) {
      const added = await tx
        .insert(personIdentifier)
        .values(identifiers.map((i) => ({ ...i, workspaceId, personId })))
        .onConflictDoNothing()
        .returning({ type: personIdentifier.type, value: personIdentifier.value });
      if (added.length === 0) return;
      const [row] = await tx
        .select({ emails: person.emails, phones: person.phones })
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)))
        .for('update');
      if (!row) throw new Error('person to attach identifiers to not found');
      const of = (type: string) => added.filter((i) => i.type === type).map((i) => i.value);
      await tx
        .update(person)
        .set({ emails: [...row.emails, ...of('email')], phones: [...row.phones, ...of('phone')] })
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)));
    },
    async appendContact(workspaceId, personId, contact) {
      const [row] = await tx
        .select({ emails: person.emails, phones: person.phones })
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)))
        .for('update');
      if (!row) throw new Error('person to add contact to not found');
      await tx
        .update(person)
        .set({
          emails: [...new Set([...row.emails, ...contact.emails])],
          phones: [...new Set([...row.phones, ...contact.phones])],
        })
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)));
    },
    async getPerson(workspaceId, personId) {
      const [row] = await tx
        .select()
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)));
      return row ?? null;
    },
    async identifierEmails(workspaceId, personId) {
      const rows = await tx
        .select({ value: personIdentifier.value })
        .from(personIdentifier)
        .where(
          and(
            eq(personIdentifier.workspaceId, workspaceId),
            eq(personIdentifier.personId, personId),
            eq(personIdentifier.type, 'email'),
          ),
        )
        .orderBy(asc(personIdentifier.value));
      return rows.map((r) => r.value);
    },
    async deleteSyntheticPeople(workspaceId) {
      const [real] = await tx
        .select({ id: person.id })
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), eq(person.synthetic, false)))
        .limit(1);
      if (real) return false;
      await tx.delete(personIdentifier).where(eq(personIdentifier.workspaceId, workspaceId));
      await tx.delete(person).where(eq(person.workspaceId, workspaceId));
      return true;
    },
    async nameUnnamed(workspaceId, personId, name) {
      const updated = await tx
        .update(person)
        .set({ displayName: name })
        .where(
          and(
            eq(person.workspaceId, workspaceId),
            eq(person.id, personId),
            eq(person.displayName, UNNAMED_APPLICANT),
            isNull(person.mergedIntoId),
          ),
        )
        .returning({ id: person.id });
      return updated.length > 0;
    },
    listPeople(workspaceId) {
      return tx
        .select()
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), isNull(person.mergedIntoId)))
        .orderBy(asc(person.createdAt), asc(person.id));
    },
    displayNames(workspaceId, personIds) {
      return tx
        .select({ id: person.id, displayName: person.displayName })
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), inArray(person.id, personIds)));
    },
    lockPeople(workspaceId, personIds) {
      return tx
        .select()
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), inArray(person.id, personIds)))
        .orderBy(asc(person.id))
        .for('update');
    },
    async setMergedInto(workspaceId, personId, survivorId) {
      await tx
        .update(person)
        .set({ mergedIntoId: survivorId })
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)));
    },
    async insertMerge(values) {
      await tx.insert(merge).values(values);
    },
    async lockActiveMerge(workspaceId, mergeId) {
      const [row] = await tx
        .select()
        .from(merge)
        .where(and(eq(merge.workspaceId, workspaceId), eq(merge.id, mergeId), isNull(merge.undoneAt)))
        .for('update');
      return row ?? null;
    },
    async markUndone(workspaceId, mergeId, { at, by, reason }) {
      await tx
        .update(merge)
        .set({ undoneAt: at, undoneBy: by, undoReason: reason })
        .where(and(eq(merge.workspaceId, workspaceId), eq(merge.id, mergeId)));
    },
    async activeMergesInto(workspaceId, survivorIds) {
      if (survivorIds.length === 0) return [];
      const rows = await tx
        .select({ merge, mergedName: person.displayName })
        .from(merge)
        .innerJoin(person, and(eq(person.workspaceId, merge.workspaceId), eq(person.id, merge.mergedId)))
        .where(and(eq(merge.workspaceId, workspaceId), inArray(merge.survivorId, survivorIds), isNull(merge.undoneAt)))
        .orderBy(asc(merge.mergedAt), asc(merge.id));
      return rows.map((r) => ({ ...r.merge, mergedName: r.mergedName }));
    },
  };
  return store;
}
