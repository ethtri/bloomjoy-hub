import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackResourcesPlaybookCardClick } from '@/lib/businessPlaybookAnalytics';
import { FOOD_TRUCK_SOLUTION_PATH, MOBILE_SETUP_GUIDE_PATH } from '@/data/mobileOperatorPages';

export const MobileOperatorEntry = ({ surface }: { surface: 'resources_category' | 'playbook_index_category' }) => (
  <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#1d2722] p-6 text-white shadow-elevated sm:p-8">
    <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />
    <div className="relative grid gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
        <Truck aria-hidden="true" className="h-7 w-7" />
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Food trucks &amp; mobile operators</p>
        <h2 className="mt-2 font-display text-2xl font-bold">Start with fit. Then inspect the setup.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">Compare a staffed Mini path with larger or lower-volume options, then work through space, total electrical load, service flow, transport questions, cleaning, storage, and local review.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
        <Button asChild>
          <Link
            to={FOOD_TRUCK_SOLUTION_PATH}
            onClick={() => trackResourcesPlaybookCardClick({ surface, cta: 'food_truck_solution', href: FOOD_TRUCK_SOLUTION_PATH })}
          >
            Explore mobile fit <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Link
          to={MOBILE_SETUP_GUIDE_PATH}
          onClick={() => trackResourcesPlaybookCardClick({ surface, cta: 'mobile_setup_guide', href: MOBILE_SETUP_GUIDE_PATH })}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-4 text-sm font-bold text-white transition hover:bg-white/10"
        >
          <ClipboardCheck aria-hidden="true" className="h-4 w-4" /> Setup checklist
        </Link>
      </div>
    </div>
  </div>
);
