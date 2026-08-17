import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { MasterProspectsTable } from "@/components/MasterProspectsTable";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `All Prospects - ${APP_TITLE}` }];
}

export default function AllProspectsPage() {
  useSetPageTitle("All Prospects");
  return <MasterProspectsTable />;
}
