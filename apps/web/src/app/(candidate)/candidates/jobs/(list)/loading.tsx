'use client';

// In the (list) group so this Suspense boundary does not wrap jobs/[slug]: streaming would start before notFound()
// could answer 404 (AIV-P3-005).
export { JobsListLoading as default } from '@/features/public-jobs/components/JobsList.tsx';
