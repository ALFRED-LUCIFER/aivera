import { RankingTable } from '@/features/ranking/components/RankingTable.tsx';

export default function CandidatesLoading() {
  return <RankingTable view={{ status: 'loading' }} />;
}
