import { Scorecard } from '@/features/scorecard/components/Scorecard.tsx';

export default function ScorecardLoading() {
  return <Scorecard view={{ status: 'loading' }} />;
}
