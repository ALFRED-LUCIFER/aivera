// Fixture: the one allowed caller.
export const run = (w: { changeStatus(i: unknown): void }) => w.changeStatus({});
