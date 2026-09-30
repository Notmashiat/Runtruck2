import { OnboardingTab } from '@/components/hr/OnboardingTab';
import { onboardingCasesQuery } from '@/lib/api/hr';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// HR › Onboarding, with the cases prefetched for the first paint (implementation-brief §4).
export default async function OnboardingPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('hr.view') ? [onboardingCasesQuery] : []}>
      <OnboardingTab />
    </Prefetch>
  );
}
