import { createAuthPlugin } from "@agent-native/core/server";

// All actions require auth. Domain restriction (WORKSPACE_ORG_DOMAIN) is
// enforced in server/middleware/auth.ts, same pattern as booking/li-agent.
// No extra Google scopes needed here — HubSpot/CommonRoom/Notion/Google
// Docs sync each use their own separate connection, not the login OAuth.
export default createAuthPlugin({});
