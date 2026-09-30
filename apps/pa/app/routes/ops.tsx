import { IconActivityHeartbeat } from "@tabler/icons-react";

import { PlaceholderPage } from "@/components/pa/states";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Ops - ${APP_TITLE}` }];
}

export default function OpsRoute() {
  return (
    <PlaceholderPage
      icon={IconActivityHeartbeat}
      title="Ops"
      summary="The operator view for running PA Hub day to day: pipeline health, mode, and the clocks that keep first touches on time."
      planned={[
        "Pipeline health: intake, retries, failed steps, and the recurring sweep",
        "Shadow or live mode, switched by a feature flag with an audit trail",
        "Slack shadow cards and draft lint results",
        "Clock breaches and at-risk trends by owner",
      ]}
    />
  );
}
