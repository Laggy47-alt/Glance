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

const APP_URL = 'https://abc.firstglance.digital';
const SCRIPT_URL = `${APP_URL}/setup-frigate.sh`;

function buildGuideHtml(code: string, productLabel: string, qty: number): string {
  const mono = 'font-family:ui-monospace,Menlo,Consolas,monospace';
  const codeBlock = (s: string) =>
    `<pre style="${mono};background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow:auto;font-size:13px;line-height:1.5;margin:10px 0">${s}</pre>`;
  const h3 = 'font-size:16px;font-weight:700;margin:28px 0 8px;color:#0f172a';
  const p  = 'font-size:14px;line-height:1.55;color:#334155;margin:8px 0';
  const li = 'font-size:14px;line-height:1.6;color:#334155;margin:4px 0';

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:auto;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 12px">Thanks for your purchase 🎉</h2>
    <p style="${p}">You bought <strong>${productLabel}</strong>${qty > 1 ? ` × ${qty}` : ''}.</p>

    <p style="${p}">Redeem this code in your dashboard under <em>Billing → Redeem a code</em> to activate access:</p>
    <div style="${mono};font-size:22px;font-weight:700;background:#f1f5f9;border:1px dashed #94a3b8;border-radius:8px;padding:16px;text-align:center;letter-spacing:1px;margin:18px 0">
      ${code}
    </div>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0"/>
    <h2 style="margin:0 0 6px">Glance NVR — Full Setup Guide</h2>
    <p style="${p}">Follow these steps from a clean machine to a live NVR appearing in your Glance dashboard.</p>

    <h3 style="${h3}">1. Install Ubuntu Server (Headless)</h3>
    <ol>
      <li style="${li}">Download <strong>Ubuntu Server 22.04 LTS</strong> from <a href="https://ubuntu.com/download/server">ubuntu.com/download/server</a>.</li>
      <li style="${li}">Flash to a USB stick using <a href="https://etcher.balena.io/">balenaEtcher</a> or <a href="https://www.raspberrypi.com/software/">Raspberry Pi Imager</a>.</li>
      <li style="${li}">Boot your NUC / mini-PC from the USB and run the installer.</li>
      <li style="${li}">During install: choose <strong>minimal install</strong>, enable <strong>OpenSSH server</strong>, set username + password, accept defaults for the rest.</li>
      <li style="${li}">After reboot, note the device's LAN IP (shown at the login prompt).</li>
    </ol>

    <h3 style="${h3}">2. SSH into the machine</h3>
    <p style="${p}">From your laptop:</p>
    ${codeBlock('ssh your-user@&lt;device-ip&gt;')}

    <h3 style="${h3}">3. Run the automated installer</h3>
    <p style="${p}">Replace <code>my-site</code> with a short name for this NVR (lowercase, no spaces, e.g. <code>warehouse-1</code>):</p>
    ${codeBlock(`curl -fsSL ${SCRIPT_URL} -o setup-frigate.sh\nsudo bash setup-frigate.sh my-site`)}
    <p style="${p}">The script installs Docker, Frigate, Mosquitto (MQTT) and frigate-notify, then starts everything in containers.</p>

    <h3 style="${h3}">4. Provide your Webhook URL + Secret when prompted</h3>
    <p style="${p}">The installer will ask for two values. Get them from Glance:</p>
    <ol>
      <li style="${li}">Sign in at <a href="${APP_URL}">${APP_URL}</a> and redeem your code above.</li>
      <li style="${li}">Open <strong>Sources</strong> in the sidebar — your org has its own auto-created <em>Default NVR Source</em>.</li>
      <li style="${li}">Click it and copy the <strong>Webhook URL</strong> and <strong>Secret</strong>.</li>
      <li style="${li}">Paste each one into the installer prompt and press Enter.</li>
    </ol>
    <p style="${p}"><strong>Important:</strong> every organization has its own unique webhook URL — do not share one URL across orgs.</p>

    <h3 style="${h3}">5. Add your cameras</h3>
    <p style="${p}">Edit the Frigate config to add your real RTSP streams:</p>
    ${codeBlock('sudo nano ~/frigate-my-site/config/config.yml')}
    <p style="${p}">Replace the <code>test_camera</code> block with one entry per camera (RTSP URL, name, zones). Then restart:</p>
    ${codeBlock('cd ~/frigate-my-site &amp;&amp; sudo docker compose restart frigate')}

    <h3 style="${h3}">6. Add the NVR in Glance</h3>
    <ol>
      <li style="${li}">In Glance, go to <strong>NVRs</strong> → <strong>Add NVR</strong>.</li>
      <li style="${li}">Name: same site name you used in step 3.</li>
      <li style="${li}">Base URL: <code>http://&lt;device-ip&gt;:5000</code> (or your Cloudflare tunnel URL — see <code>docker logs cloudflared</code>).</li>
      <li style="${li}">Tick <em>is_local</em> if browsers will reach it on the LAN; otherwise leave unticked.</li>
      <li style="${li}">Save. Snapshots and events should start appearing within seconds.</li>
    </ol>

    <h3 style="${h3}">Troubleshooting</h3>
    <ul>
      <li style="${li}">Check container logs: <code>sudo docker logs frigate --tail 50</code></li>
      <li style="${li}">No events in Glance? Confirm the webhook URL/secret in <code>~/frigate-my-site/notify-config.yml</code> match Glance.</li>
      <li style="${li}">Camera offline in Frigate UI? Verify the RTSP URL with <code>ffprobe rtsp://...</code>.</li>
    </ul>

    <p style="${p};margin-top:28px">Need help? Just reply to this email.</p>
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">— The Glance team</p>
  </div>`;
}

async function emailCode(to: string, code: string, productLabel: string, qty: number) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!RESEND_API_KEY || !LOVABLE_API_KEY) {
    console.warn('Missing email keys, skipping send');
    return;
  }
  const html = buildGuideHtml(code, productLabel, qty);
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
      subject: `Your ${productLabel} activation code + Glance setup guide`,
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
