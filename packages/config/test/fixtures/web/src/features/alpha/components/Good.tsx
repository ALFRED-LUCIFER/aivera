import type { Alpha } from '../domain/alpha';
export const Good = ({ alpha, label }: { alpha: Alpha; label: string }) => <p title={alpha.id}>{label}</p>;
