import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { captureMarketingAttribution } from "@/lib/marketingAttribution";

initAnalytics();
if (captureMarketingAttribution()) {
  trackEvent('marketing_attribution_captured');
}

createRoot(document.getElementById("root")!).render(<App />);
