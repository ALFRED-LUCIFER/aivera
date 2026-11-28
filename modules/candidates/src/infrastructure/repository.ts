import { DbQueryError, type Tx } from '@credalent/db/client';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { MergeStore } from '../application/merge.ts';
import type { CandidateStore } from '../application/people.ts';
import { UNNAMED_APPLICANT, type IdentifierType, type Person } from '../domain/person.ts';
import { merge, person, personIdentifier } from './schema.ts';

// Thrown inside a locking round's savepoint to roll it back and lock a larger set (findPeople).
const relock = new Error('relock');

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
      // A merged person's identifiers stay with them, so follow the merges to the person they are part of now: first
      // with plain reads, then lock everyone met in one call, by id, as merge and undo do (lockPeople), so arrivals,
      // merges and undos of the same people queue instead of deadlocking. Read again under the lock: an undo that
      // committed while this waited has cleared merged_into_id, and the arrival is filed by what is true now. The
      // later FOR UPDATE in attachIdentifiers and an automatic merge's lockPeople take locks already held.
      const ids = new Set(rows.map((row) => row.personId));
      if (ids.size === 0) return [];
      for (const id of ids) {
        const next = (await store.getPerson(workspaceId, id))?.mergedIntoId;
        if (next) ids.add(next);
      }
      // A merge that committed while this waited can point past the locked set. Each round locks in a savepoint, so
      // such a round is rolled back, which releases its locks, and the larger set is locked afresh, still by id.
      let people: Map<string, Person> | null = null;
      for (let round = 0; !people && round < 5; round++) {
        try {
          people = await tx.transaction(async (sp) => {
            const locked = new Map((await candidateStore(sp).lockPeople(workspaceId, [...ids])).map((p) => [p.id, p]));
            const outside = [...locked.values()].flatMap((p) =>
              p.mergedIntoId && !ids.has(p.mergedIntoId) ? [p.mergedIntoId] : [],
            );
            if (outside.length === 0) return locked;
            for (const id of outside) ids.add(id);
            throw relock;
          });
        } catch (error) {
          if (error !== relock) throw error;
        }
      }
      if (!people) throw new Error('merge chain kept changing while it was being locked');
      const found = new Map<string, { person: Person; types: IdentifierType[] }>();
      for (const row of rows) {
        let current = people.get(row.personId);
        for (let hops = 0; current?.mergedIntoId && hops < 20; hops++) current = people.get(current.mergedIntoId);
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
      // Merges name both people by foreign key, so they go first.
      await tx.delete(merge).where(eq(merge.workspaceId, workspaceId));
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
    async rename(workspaceId, personId, name) {
      const updated = await tx
        .update(person)
        .set({ displayName: name })
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId), isNull(person.mergedIntoId)))
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
