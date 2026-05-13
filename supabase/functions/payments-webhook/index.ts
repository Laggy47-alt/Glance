import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhook, EventName, type PaddleEnv, getPaddleClient } from '../_shared/paddle.ts';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }
  return _supabase;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(): string {
  const seg = (n: number) => Array.from({ length: n }, () =>
    ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  return `${seg(4)}-${seg(4)}-${seg(4)}`;
}

async function emailCode(to: string, code: string, productLabel: string, qty: number) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!RESEND_API_KEY || !LOVABLE_API_KEY) {
    console.warn('Missing email keys, skipping send');
    return;
  }
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px">Thanks for your purchase 🎉</h2>
      <p>You bought <strong>${productLabel}</strong>${qty > 1 ? ` × ${qty}` : ''}.</p>
      <p>Use this code in your dashboard under <em>Billing → Redeem a code</em> to activate access:</p>
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:700;
                  background:#f1f5f9;border:1px dashed #94a3b8;border-radius:8px;
                  padding:16px;text-align:center;letter-spacing:1px;margin:20px 0">
        ${code}
      </div>
      <p style="font-size:13px;color:#475569">If you have any issues, just reply to this email.</p>
    </div>`;
  const res = await fetch('https://connector-gateway.lovable.dev/resend/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': RESEND_API_KEY,
    },
    body: JSON.stringify({
      from: 'First Glance <onboarding@resend.dev>',
      to: [to],
      subject: `Your ${productLabel} activation code`,
      html,
    }),
  });
  if (!res.ok) console.error('Resend error', res.status, await res.text());
}

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const items = data.items ?? [];
  if (!items.length) return;

  // Resolve customer email via Paddle API
  let buyerEmail: string | null = data.customer?.email ?? null;
  if (!buyerEmail && data.customerId) {
    try {
      const paddle = getPaddleClient(env);
      const customer = await paddle.customers.get(data.customerId);
      buyerEmail = customer?.email ?? null;
    } catch (e) {
      console.error('Failed to fetch customer', e);
    }
  }
  if (!buyerEmail) {
    console.warn('No buyer email; cannot send code');
    return;
  }

  for (const item of items) {
    const priceExt: string | undefined = item.price?.importMeta?.externalId;
    const qty: number = item.quantity ?? 1;
    if (!priceExt) {
      console.warn('Skipping item: missing price externalId');
      continue;
    }

    let kind: 'lifetime' | 'nvr_slot' | null = null;
    let nvrSlots = 0;
    let label = '';

    if (priceExt === 'lifetime_unlimited_once') {
      kind = 'lifetime';
      label = 'Lifetime Unlimited Access';
    } else if (priceExt === 'nvr_license_once') {
      kind = 'nvr_slot';
      nvrSlots = qty;
      label = `NVR License${qty > 1 ? `s (${qty})` : ''}`;
    } else {
      console.log('Unknown price, skipping:', priceExt);
      continue;
    }

    // Generate a unique code
    let code = genCode();
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await getSupabase()
        .from('redemption_codes').select('id').eq('code', code).maybeSingle();
      if (!existing) break;
      code = genCode();
    }

    const { error } = await getSupabase().from('redemption_codes').insert({
      code,
      kind,
      duration_days: kind === 'lifetime' ? 36500 : 0,
      nvr_slots: nvrSlots,
      max_uses: 1,
      notes: `Auto-generated from purchase ${data.id} (${buyerEmail})`,
    });
    if (error) { console.error('Failed to insert code', error); continue; }

    await emailCode(buyerEmail, code, label, qty);
  }
}

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, items, status, currentBillingPeriod, customData } = data;
  const orgId = customData?.organization_id;
  if (!orgId) return;
  const item = items?.[0];
  const priceId = item?.price?.importMeta?.externalId;
  const productId = item?.product?.importMeta?.externalId;
  if (!priceId || !productId) return;
  await getSupabase().from('org_subscriptions').upsert({
    organization_id: orgId,
    status: status === 'trialing' ? 'active' : status,
    paddle_subscription_id: id,
    paddle_customer_id: customerId,
    product_id: productId,
    price_id: priceId,
    current_period_start: currentBillingPeriod?.startsAt,
    current_period_end: currentBillingPeriod?.endsAt,
    environment: env,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id' });
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange } = data;
  await getSupabase().from('org_subscriptions')
    .update({
      status: status === 'trialing' ? 'active' : status,
      current_period_start: currentBillingPeriod?.startsAt,
      current_period_end: currentBillingPeriod?.endsAt,
      cancel_at_period_end: scheduledChange?.action === 'cancel',
      updated_at: new Date().toISOString(),
    })
    .eq('paddle_subscription_id', id)
    .eq('environment', env);
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  await getSupabase().from('org_subscriptions')
    .update({ status: 'suspended', updated_at: new Date().toISOString() })
    .eq('paddle_subscription_id', data.id)
    .eq('environment', env);
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.eventType) {
    case EventName.SubscriptionCreated:
      await handleSubscriptionCreated(event.data, env); break;
    case EventName.SubscriptionUpdated:
      await handleSubscriptionUpdated(event.data, env); break;
    case EventName.SubscriptionCanceled:
      await handleSubscriptionCanceled(event.data, env); break;
    case EventName.TransactionCompleted:
      await handleTransactionCompleted(event.data, env); break;
    default:
      console.log('Unhandled event:', event.eventType);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  const env = (url.searchParams.get('env') || 'sandbox') as PaddleEnv;
  try {
    await handleWebhook(req, env);
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('Webhook error', { status: 400 });
  }
});
