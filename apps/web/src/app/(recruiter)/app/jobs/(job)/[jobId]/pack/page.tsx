import { EmptyStage } from '../EmptyStage.tsx';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('pack');

export default function JobPackPage() {
  return <EmptyStage page="pack" />;
}
