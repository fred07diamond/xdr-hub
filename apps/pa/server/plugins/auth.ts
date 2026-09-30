import { createAuthPlugin } from "@agent-native/core/server";

// The minute poll (D58) arrives from a Netlify scheduled function with no
// session; the route verifies its HMAC signature itself.
export default createAuthPlugin({
  publicPaths: ["/api/internal/intake-poll"],
});
