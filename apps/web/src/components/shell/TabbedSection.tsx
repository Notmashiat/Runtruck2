import type { ReactNode } from 'react';
import { SectionTabs } from './SectionTabs';

// Layout for a sidebar section that is split into tabs: the pill bar, then the
// active tab. A fragment, not a wrapper: .ui-tabs must stay a direct flex child
// of .ui-main (align-self: center, gap: 20px).
export function TabbedSection({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs />
      {children}
    </>
  );
}
