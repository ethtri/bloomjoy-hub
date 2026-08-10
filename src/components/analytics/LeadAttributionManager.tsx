import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { captureLeadAttribution } from '@/lib/leadAttribution';
import { getRouteSeo, PUBLIC_ROBOTS } from '@/lib/seoRoutes';

export const LeadAttributionManager = () => {
  const location = useLocation();

  useEffect(() => {
    if (getRouteSeo(location.pathname).robots !== PUBLIC_ROBOTS) return;
    captureLeadAttribution();
  }, [location.pathname, location.search]);

  return null;
};
