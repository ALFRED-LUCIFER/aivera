// Fixture: a console service asking for a catalogue eval run without server/operator.ts (AIV-P2-048).
export const run = (c: { requestEval(o: string, i: unknown): void }) => c.requestEval('', {});
