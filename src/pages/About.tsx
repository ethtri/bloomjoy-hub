import { Layout } from '@/components/layout/Layout';
import foundersPhoto from '@/assets/real/about-founders.webp';

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
          <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="prose prose-lg text-muted-foreground">
              <h2 className="font-display text-2xl font-bold text-foreground">Our Story</h2>
              <p>With 5+ years of operational experience across approximately 12 states, we've learned what operators need to succeed. We maintain a direct relationship with Sunze, the manufacturer, ensuring quality machines and reliable support.</p>
              <h2 className="font-display text-2xl font-bold text-foreground mt-8">What We Believe</h2>
              <p>Operators deserve equipment that works reliably, supplies that perform consistently, and support that's clear about what to expect. We focus on practical solutions over flashy promises.</p>
            </div>
            <figure className="card-elevated overflow-hidden p-3">
              <img
                src={foundersPhoto}
                alt="Bloomjoy founders Ethan and Yanhong"
                className="w-full rounded-lg object-cover"
              />
              <figcaption className="mt-3 text-center text-sm text-muted-foreground">
                Ethan and Yanhong, Bloomjoy co-founders
              </figcaption>
            </figure>
          </div>
        </div>
      </section>
    </Layout>
  );
}
