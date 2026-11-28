// The interviews feature's API for other features (ADR-003).
// Server only: a client hook exported beside it would pull the database into the browser bundle.
export { toInterviewRows } from './services/loadInterviews.ts';
