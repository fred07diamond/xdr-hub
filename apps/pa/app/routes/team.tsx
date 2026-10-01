import { TeamPage } from "@agent-native/core/client/org";
import { PLAYBOOK_ROLES } from "@shared/playbook-roles";

import { RoutingSettings } from "@/components/pa/routing-settings";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Team - ${APP_TITLE}` }];
}

// Playbook roles (D44): PA team and RevOps approve changes to the entries they
// own. Org owners and admins assign them here. Below, the people leads are
// routed to, with their meeting links (D66).
export default function TeamRoute() {
  return (
    <>
      <TeamPage title="Team and playbook roles" appRoles={PLAYBOOK_ROLES} />
      <div className="px-3 pb-8 sm:px-4 md:px-6">
        <RoutingSettings />
      </div>
    </>
  );
}
