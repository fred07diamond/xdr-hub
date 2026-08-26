// TEMPORARY (2026-08-26, at Fred's request) -- mirrors APOLLO_ENRICHMENT_DISABLED
// in server/helpers/apollo-client.ts. That server flag already rejects every
// Apollo call, but this stops the UI from even offering the button, so
// nobody hits the error in the first place. Flip both back to false to
// re-enable, and update this comment.
export const APOLLO_ENRICHMENT_DISABLED = true;
export const APOLLO_ENRICHMENT_DISABLED_MESSAGE = "Apollo enrichment is temporarily disabled";
