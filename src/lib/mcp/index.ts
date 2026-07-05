import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import getProfileTool from "./tools/get-profile";
import listOrganizationsTool from "./tools/list-organizations";

// Construct the Supabase OAuth issuer from the project ref. Do NOT read
// SUPABASE_URL — on Lovable Cloud that's a proxy host, and mcp-js rejects
// tokens whose issuer doesn't match the discovery document exactly.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "glance-mcp",
  title: "Glance MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Glance CCTV monitoring app. Use `echo` to verify connectivity. Use `get_profile` and `list_organizations` to fetch the signed-in user's account context.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [echoTool, getProfileTool, listOrganizationsTool],
});
