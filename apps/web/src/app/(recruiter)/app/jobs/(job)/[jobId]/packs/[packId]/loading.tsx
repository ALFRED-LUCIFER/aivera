import { DecisionPack } from '@/features/decision-pack/components/DecisionPack.tsx';

export default function PackLoading() {
  return <DecisionPack view={{ status: 'loading' }} />;
}
