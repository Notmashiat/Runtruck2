import { LandingPage } from '@/components/marketing/LandingPage';

// Marketing site (Runtruck1 "/"). "Log in" links to /app/dashboard as in Runtruck1;
// without a session the proxy sends the visitor to /login (docs/01 D2).
export default function Home() {
  return <LandingPage />;
}
