// Fixture: a console service publishing the catalogue draft without server/operator.ts (AIV-P2-049).
export const publish = (c: { publishDraft(o: string, i: unknown): void }) => c.publishDraft('', {});
