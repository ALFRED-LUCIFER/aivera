// The evidence profile feature's API for other features (ADR-003): a CV's status line, its "Try again" and the live
// refresh while a CV is read or assessed, for the ranking (AIV-P1-165 §7).
export { CvStatusLine } from './components/CvStatusLine.tsx';
// How cited evidence states its strength and its limit, for the scorecard (AIV-P1-165 §11).
export { LimitLine, Standing } from './components/Standing.tsx';
export { useCvRetryController, useLiveRefresh } from './hooks/useCvRetryController.ts';
