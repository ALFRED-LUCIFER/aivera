// Fixture: a console service discarding the catalogue draft without server/operator.ts (AIV-P2-049).
export const discard = (c: { discardDraft(o: string, i: unknown): void }) => c.discardDraft('', {});
