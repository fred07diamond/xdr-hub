import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = APP_TITLE + " - Inbound Contact Sales";
const SEO_DESCRIPTION =
  "Inbound Contact Sales leads, pre-checked, routed, scored, and drafted for their owner, with a receipt for every decision.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function MarketingHomeRoute() {
  return (
    <MarketingHome
      appName={APP_TITLE}
      tagline="Every Contact Sales lead, classified and drafted for its owner."
      description={SEO_DESCRIPTION}
      valueProps={[
        "See how each lead was classified and why, at a glance",
        "Review a drafted first reply that follows the playbook's message rules",
        "Track the SLA from submission to first contact and SAL",
      ]}
      primaryActionHref={appPath("/inbound")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
