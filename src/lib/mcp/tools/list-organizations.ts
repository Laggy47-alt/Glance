import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_organizations",
  title: "List my organizations",
  description: "List organizations the signed-in user is a member of, with their role.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations(id, slug, name)")
      .eq("user_id", ctx.getUserId());
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []).map((m: any) => ({
      organization_id: m.organization_id,
      role: m.role,
      organization: Array.isArray(m.organizations) ? m.organizations[0] : m.organizations,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { organizations: rows },
    };
  },
});
