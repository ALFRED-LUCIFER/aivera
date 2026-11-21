import { ApplicantList } from '@/features/add-applicants/components/ApplicantList.tsx';

export default function CandidatesLoading() {
  return <ApplicantList view={{ status: 'loading' }} />;
}
