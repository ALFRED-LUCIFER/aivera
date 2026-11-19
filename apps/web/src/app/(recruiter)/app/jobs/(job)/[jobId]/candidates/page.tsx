import { EmptyStage } from '../EmptyStage.tsx';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('candidates');

export default function CandidatesPage() {
  return <EmptyStage page="candidates" />;
}
