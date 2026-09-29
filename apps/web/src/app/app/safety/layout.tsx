import type { ReactNode } from 'react';
import { TabbedSection } from '@/components/shell/TabbedSection';

export default function SafetyLayout({ children }: { children: ReactNode }) {
  return <TabbedSection>{children}</TabbedSection>;
}
