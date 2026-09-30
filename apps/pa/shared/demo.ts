export const DEMO_ID_PREFIX = "demo-";

export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_ID_PREFIX);
}
