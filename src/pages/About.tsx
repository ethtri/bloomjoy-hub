import { Layout } from '@/components/layout/Layout';

export default function AboutPage() {
  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-display text-4xl font-bold text-foreground">About Bloomjoy</h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              We help operators run successful robotic cotton candy businesses with commercial-grade machines and premium supplies.
            </p>
          </div>
        </div>
      </section>
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-3xl prose prose-lg text-muted-foreground">
            <h2 className="font-display text-2xl font-bold text-foreground">Our Story</h2>
            <p>With 5+ years of operational experience across approximately 12 states, we've learned what operators need to succeed. We maintain a direct relationship with Sunze, the manufacturer, ensuring quality machines and reliable support.</p>
            <h2 className="font-display text-2xl font-bold text-foreground mt-8">What We Believe</h2>
            <p>Operators deserve equipment that works reliably, supplies that perform consistently, and support that's clear about what to expect. We focus on practical solutions over flashy promises.</p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
