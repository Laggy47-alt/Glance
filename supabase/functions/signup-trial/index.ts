// Self-signup: creates a trial org with chosen slug + admin user.
// Body: { org_name, slug, username, password, contact_email }
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESERVED = new Set(['super', 'admin', 'api', 'www', 'app', 'auth', 'login', 'signup', 'billing']);

const cleanSlug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { org_name, slug: rawSlug, username: rawUsername, password, contact_email } = await req.json();
    const slug = cleanSlug(String(rawSlug || ''));
    const username = String(rawUsername || '').toLowerCase().trim();
    const orgName = String(org_name || '').trim();
    const email = String(contact_email || '').trim();

    if (!slug || slug.length < 3) throw new Error('Organization ID must be at least 3 characters');
    if (RESERVED.has(slug)) throw new Error('That organization ID is reserved');
    if (!/^[a-z0-9_-]{3,32}$/.test(username)) throw new Error('Username must be 3-32 chars, letters/numbers/-/_');
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters');
    if (!email || !email.includes('@')) throw new Error('Valid email required');
    if (!orgName) throw new Error('Organization name required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check slug not taken
    const { data: existing } = await supabase.from('organizations').select('id').eq('slug', slug).maybeSingle();
    if (existing) throw new Error('That organization ID is already taken');

    // Create auth user with synthetic email
    const authEmail = `${username}@${slug}.local.app`;
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        display_name: username,
        contact_email: email,
        must_change_password: false,
      },
    });
    if (createErr || !created.user) throw new Error(createErr?.message || 'Failed to create user');
    const userId = created.user.id;

    // Create org
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({ name: orgName, slug, created_by: userId })
      .select('id, slug, name')
      .single();
    if (orgErr || !org) {
      // cleanup user
      await supabase.auth.admin.deleteUser(userId);
      throw new Error(orgErr?.message || 'Failed to create organization');
    }

    // Add member as admin
    await supabase.from('organization_members').insert({
      organization_id: org.id, user_id: userId, role: 'admin',
    });

    // Trial subscription
    await supabase.from('org_subscriptions').insert({
      organization_id: org.id, status: 'trial',
    });

    // Save contact email on profile
    await supabase.from('profiles').update({ contact_email: email }).eq('user_id', userId);

    return new Response(JSON.stringify({ ok: true, org, slug, username }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
