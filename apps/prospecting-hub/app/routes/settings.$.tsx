// SettingsTabsPage reflects the active tab in the URL via a raw
// window.history.pushState, not real React Router navigation, so a direct
// load or reload of "/settings/<tab>" has no matching route otherwise --
// only "/settings" itself is registered. This splat route renders the exact
// same page for any "/settings/*" sub-path so the server can actually
// resolve it; the client still reads window.location on hydration to show
// the right tab (SettingsTabsPage's own activeTabFromLocation already does
// this, unrelated to which route rendered it).
export { default, meta } from "./settings";
