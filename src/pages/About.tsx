import { Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import aboutHero from '@/assets/real/about-hero.jpg';
import aboutGallery1 from '@/assets/real/about-gallery-1.jpg';
import aboutGallery2 from '@/assets/real/about-gallery-2.jpg';
import aboutGallery3 from '@/assets/real/about-gallery-3.jpg';
import foundersPhoto from '@/assets/real/about-founders.webp';

const missionPillars = [
  {
    title: 'Delight First',
    description: 'Every machine should create a memorable customer moment, not just a transaction.',
  },
  {
    title: 'Operator Practicality',
    description: 'Reliable equipment, consistent consumables, and clear support expectations matter most.',
  },
  {
    title: 'Long-Term Partnership',
    description: 'We stay close to the manufacturer and help operators scale with confidence.',
  },
];

export default function AboutPage() {
  return (
    <Layout>
      <section className="section-padding">
        <div className="container-page">
          <div className="relative overflow-hidden rounded-3xl">
            <img
              src={aboutHero}
              alt="Customers interacting with a Bloomjoy cotton candy machine"
              width={1800}
              height={1200}
              loading="eager"
              decoding="async"
              className="h-[360px] w-full object-cover sm:h-[440px]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/65 via-foreground/30 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
              <div className="max-w-3xl">
                <h1 className="font-display text-4xl font-bold text-background sm:text-5xl">
                  About Bloomjoy
                </h1>
                <p className="mt-4 text-base text-background/90 sm:text-lg">
                  We help operators build profitable, repeatable cotton candy experiences with
                  commercial machines, premium supplies, and practical operational support.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-padding pt-0">
        <div className="container-page">
          <h2 className="font-display text-3xl font-bold text-foreground">Our Mission</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {missionPillars.map((pillar) => (
              <div key={pillar.title} className="card-elevated p-6">
                <h3 className="font-display text-xl font-semibold text-foreground">{pillar.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {pillar.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-padding bg-muted/40">
        <div className="container-page">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h2 className="font-display text-3xl font-bold text-foreground">
                The Bloomjoy Story
              </h2>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-muted-foreground">
                <p>
                  Bloomjoy started from a simple belief: cotton candy can be more than a snack. It
                  can be an experience that creates joy, keeps people engaged, and brings repeat
                  traffic to a venue.
                </p>
                <p>
                  Through years of real-world operation across multiple states, we learned that
                  operators do best when three things stay consistent: machine reliability,
                  consumable quality, and support clarity. That is what we focus on every day.
                </p>
                <p>
                  We maintain a direct relationship with the manufacturer and pair that with
                  Bloomjoy onboarding, playbooks, and concierge guidance so operators can launch
                  quickly and run with confidence.
                </p>
              </div>
            </div>
            <figure className="card-elevated overflow-hidden p-3">
              <img
                src={foundersPhoto}
                alt="Bloomjoy founders Ethan and Yanhong"
                width={720}
                height={720}
                loading="lazy"
                decoding="async"
                className="w-full rounded-lg object-cover"
              />
              <figcaption className="mt-3 text-center text-sm text-muted-foreground">
                Ethan and Yanhong, Bloomjoy co-founders
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          <h2 className="font-display text-3xl font-bold text-foreground">In the Field</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Real moments from Bloomjoy activations and operator environments.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="overflow-hidden rounded-2xl">
              <img
                src={aboutGallery1}
                alt="Bloomjoy cotton candy activation in a mall environment"
                width={600}
                height={450}
                loading="lazy"
                decoding="async"
                className="h-72 w-full object-cover"
              />
            </div>
            <div className="overflow-hidden rounded-2xl">
              <img
                src={aboutGallery2}
                alt="Customers using a Bloomjoy cotton candy machine"
                width={600}
                height={450}
                loading="lazy"
                decoding="async"
                className="h-72 w-full object-cover"
              />
            </div>
            <div className="overflow-hidden rounded-2xl">
              <img
                src={aboutGallery3}
                alt="Fresh cotton candy served at a Bloomjoy event"
                width={600}
                height={450}
                loading="lazy"
                decoding="async"
                className="h-72 w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section-padding pt-0">
        <div className="container-page">
          <div className="card-elevated rounded-3xl p-8 text-center sm:p-10">
            <h2 className="font-display text-3xl font-bold text-foreground">
              Join Us on Our Sweet Journey
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Planning a launch, scaling to multiple locations, or comparing machine options? Our
              team can help you map the right path.
            </p>
            <div className="mt-6">
              <Link to="/contact">
                <Button size="lg">Contact Us</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
