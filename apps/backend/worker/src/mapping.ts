/**
 * Whether the worker maps evidence (AIV-P1-027, AIV-P2-062): it needs a model and at least one reader feeding the
 * evidence queue (the GitHub App, or file reading), so that queue always has a consumer; otherwise evidence and rubric
 * changes go to `assessment` directly.
 */
export const mapsEvidence = (readers: { model: boolean; githubApp: boolean; fileReading: boolean }) =>
  readers.model && (readers.githubApp || readers.fileReading);
