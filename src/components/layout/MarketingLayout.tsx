import { useEffect, type ReactNode } from 'react';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { PublicNavigationRestoration } from './PublicNavigationRestoration';

interface MarketingLayoutProps {
  children: ReactNode;
}

export function MarketingLayout({ children }: MarketingLayoutProps) {
  useEffect(() => {
    document.body.classList.add('marketing-surface');
    return () => document.body.classList.remove('marketing-surface');
  }, []);

  return (
    <div className="marketing-surface flex min-h-screen flex-col">
      <PublicNavigationRestoration />
      <a href="#main-content" className="public-skip-link">Skip to content</a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>
      <Footer />
    </div>
  );
}
