/** A decision pack page as the server hands it to the browser (AIV-P2-010): plain data, scores as snapshotted. */
export type PackPage = {
  name: string;
  job: string;
  members: { candidateId: string; name: string | null; backedScore: number; upperBound: number }[];
};
