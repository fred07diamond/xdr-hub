import { IconTags } from "@tabler/icons-react";

import { PlaceholderPage } from "@/components/pa/states";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Labels - ${APP_TITLE}` }];
}

export default function LabelsRoute() {
  return (
    <PlaceholderPage
      icon={IconTags}
      title="Labels"
      summary="Product Advocates label real submissions so PA Hub can be measured against human judgment before it touches live traffic."
      planned={[
        "Label each submission with the right pre-check outcome, route, and verdict",
        "Compare labels with what the pipeline decided, per rule and per playbook release",
        "Track agreement toward the M0 gate that must pass before live traffic",
      ]}
    />
  );
}
