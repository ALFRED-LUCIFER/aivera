import { EmptyStage } from '../EmptyStage.tsx';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('interviews');

export default function JobInterviewsPage() {
  return <EmptyStage page="interviews" />;
}
