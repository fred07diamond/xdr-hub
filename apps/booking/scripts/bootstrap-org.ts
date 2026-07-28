import { createOrganization } from "@agent-native/core/org";

const name = process.env.WORKSPACE_ORG_NAME ?? "Builder.io";
const email = process.env.WORKSPACE_OWNER_EMAIL;

if (!email) {
  console.error("WORKSPACE_OWNER_EMAIL is not set");
  process.exit(1);
}

const result = await createOrganization(name, email, "owner");
console.log(`Created org: ${result.name} (${result.id})`);
console.log(`Owner: ${email}`);
