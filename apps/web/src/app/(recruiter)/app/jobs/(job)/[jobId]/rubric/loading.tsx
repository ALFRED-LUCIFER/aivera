import { Rubric } from '@/features/rubric/components/Rubric.tsx';

export default function RubricLoading() {
  return <Rubric state={{ status: 'loading' }} />;
}
