import { Link } from 'react-router-dom';

const footerLinks = {
  products: [
    { href: '/products/commercial-robotic-machine', label: 'Commercial Robotic Machine' },
    { href: '/products/mini', label: 'Mini' },
    { href: '/products/micro', label: 'Micro' },
    { href: '/supplies', label: 'Supplies' },
  ],
  company: [
    { href: '/about', label: 'About' },
    { href: '/plus', label: 'Bloomjoy Plus' },
    { href: '/resources', label: 'Resources' },
    { href: '/contact', label: 'Contact' },
  ],
  support: [
    { href: '/resources#faq', label: 'FAQ' },
    { href: '/resources#support-boundaries', label: 'Support Boundaries' },
    { href: '/contact', label: 'Request a Quote' },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container-page py-12 lg:py-16">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <span className="font-display text-lg font-bold text-primary-foreground">B</span>
              </div>
              <span className="font-display text-xl font-semibold text-foreground">
                Bloomjoy<span className="text-primary">.</span>
              </span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Robotic cotton candy machines and premium supplies for operators across the United States.
            </p>
          </div>

          {/* Products */}
          <div>
            <h4 className="font-display text-sm font-semibold text-foreground">Products</h4>
            <ul className="mt-4 space-y-3">
              {footerLinks.products.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-display text-sm font-semibold text-foreground">Company</h4>
            <ul className="mt-4 space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="font-display text-sm font-semibold text-foreground">Support</h4>
            <ul className="mt-4 space-y-3">
              {footerLinks.support.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Support Boundaries Notice */}
        <div className="mt-12 rounded-lg border border-border bg-background p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <strong className="font-semibold text-foreground">Support Boundaries:</strong> Sunze provides 24/7 first-line technical support via WeChat for machine issues. Bloomjoy provides concierge guidance, onboarding assistance, and escalation support during US business hours (Mon–Fri, 9am–5pm EST). Bloomjoy is not a 24/7 support provider. Response times may vary based on volume.
          </p>
        </div>

        {/* Copyright */}
        <div className="mt-8 border-t border-border pt-8">
          <p className="text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} Bloomjoy Sweets. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
