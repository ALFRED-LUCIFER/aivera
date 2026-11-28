// The ranking feature's API for other features (ADR-003): its table cells, for Candidates (all jobs, AIV-P1-048).
export { MeetsNeedCell, NextActionCell } from './components/RankingTable.tsx';
export { ScoreCell } from './components/ScoreCell.tsx';
export { StageLine } from './components/StageLine.tsx';
// "Add to decision pack" with its preview-confirm, for Compare's "Add these to a decision pack" (AIV-P1-165 §10).
export { AddToPack } from './components/AddToPack.tsx';
export { usePackController } from './hooks/usePackController.ts';
