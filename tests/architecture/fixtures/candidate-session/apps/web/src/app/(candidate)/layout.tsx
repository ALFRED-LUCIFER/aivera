import { getSessionUserId } from '@/server/auth';

export default async function Layout() {
  return getSessionUserId();
}
