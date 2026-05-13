import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOrgSubscription } from "@/hooks/useOrgSubscription";
import { initializePaddle, getPaddlePriceId, getPaddleEnvironment } from "@/lib/paddle";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { CheckCircle2, Loader2, Sparkles, Ticket, AlertTriangle, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const POLICY_VERSION = "2026-05-11";

export default function Billing() {
  const { activeOrg, isAdmin, profile, session } = useAuth();
  const { sub, refresh, isGrandfathered, isTrial, isActivePaid, isSuspended, hasAccess } = useOrgSubscription();
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<null | { priceId: string; quantity: number; label: string }>(null);
  const [nvrQty, setNvrQty] = useState(1);

  useEffect(() => { void initializePaddle().catch(() => {}); }, []);

  const openUpgrade = (plan: { priceId: string; quantity: number; label: string }) => {
    setPendingPlan(plan);
    setAckChecked(false);
    setAckOpen(true);
  };

  const upgrade = async () => {
    if (!activeOrg || !profile || !pendingPlan) return;
    setCheckoutLoading(true);
    try {
      const { error: ackErr } = await supabase.from("billing_acknowledgments").insert({
        organization_id: activeOrg.id,
        user_id: profile.user_id,
        terms_version: POLICY_VERSION,
        refund_version: POLICY_VERSION,
        privacy_version: POLICY_VERSION,
        user_agent: navigator.userAgent,
        context: pendingPlan.priceId,
      });
      if (ackErr) throw ackErr;
      setAckOpen(false);
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(pendingPlan.priceId);
      const email = (profile as any)?.contact_email || session?.user?.email || undefined;
      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: pendingPlan.quantity }],
        ...(email ? { customer: { email } } : {}),
        customData: { organization_id: activeOrg.id, user_id: profile?.user_id || "" },
        settings: {
          displayMode: "overlay",
          successUrl: `${window.location.origin}/billing?upgraded=1`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const redeem = async () => {
    if (!activeOrg || !code.trim()) return;
    setRedeeming(true);
    try {
      const { data, error } = await supabase.rpc("redeem_code", {
        _code: code.trim().toUpperCase(),
        _org: activeOrg.id,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) throw new Error(row?.message || "Failed to redeem");
      toast.success(`Code redeemed — access until ${new Date(row.new_period_end).toLocaleDateString()}`);
      setCode("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRedeeming(false);
    }
  };

  const statusBadge = () => {
    if (!sub) return <Badge variant="outline">No subscription</Badge>;
    if (isGrandfathered) return <Badge className="bg-success/20 text-success border-success/40">Grandfathered — Free</Badge>;
    if (isTrial) return <Badge className="bg-warning/20 text-warning border-warning/40">Free Trial</Badge>;
    if (isActivePaid) return <Badge className="bg-success/20 text-success border-success/40">Pro — Active</Badge>;
    if (isSuspended) return <Badge variant="destructive">Suspended</Badge>;
    return <Badge variant="outline">{sub.status}</Badge>;
  };

  return (
    <DashboardLayout title="Billing & Subscription" subtitle={activeOrg?.name ?? ""}>
      <PaymentTestModeBanner />

      <div className="space-y-4 max-w-3xl mx-auto p-4">
        {!hasAccess && (
          <Card className="p-4 border-destructive/40 bg-destructive/5 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-destructive">This organization is suspended</div>
              <div className="text-muted-foreground text-xs mt-1">
                {isAdmin
                  ? "Activate access by upgrading or redeeming a code below."
                  : "Please ask your organization admin to renew the subscription."}
              </div>
            </div>
          </Card>
        )}

        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Current plan</div>
              <div className="text-lg font-semibold">{activeOrg?.name}</div>
            </div>
            {statusBadge()}
          </div>
          {sub?.current_period_end && (
            <div className="text-xs text-muted-foreground">
              Access through <span className="font-medium text-foreground">{new Date(sub.current_period_end).toLocaleDateString()}</span>
            </div>
          )}
          {isTrial && sub && (
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
              <div>Trial limits:</div>
              <ul className="list-disc list-inside space-y-0.5 text-foreground/80">
                <li>NVRs: <span className="font-mono">{sub.trial_nvr_limit}</span> max</li>
                <li>Emails sent: <span className="font-mono">{sub.trial_emails_sent} / {sub.trial_email_limit}</span></li>
                <li>Customization & branding: locked</li>
              </ul>
            </div>
          )}
        </Card>

        {isAdmin && !isGrandfathered && (
          <>
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <div className="font-semibold">Upgrade to Pro</div>
              </div>
              <div className="text-2xl font-bold">$29<span className="text-sm font-normal text-muted-foreground">/month</span></div>
              <ul className="text-xs space-y-1">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Unlimited NVRs</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Unlimited emails & daily reports</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Full branding & customization</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Cancel anytime</li>
              </ul>
              <Button onClick={openUpgrade} disabled={checkoutLoading} className="w-full">
                {checkoutLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isActivePaid ? "Manage / extend" : "Upgrade now"}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Secure payment by Paddle ({getPaddleEnvironment() === "sandbox" ? "test mode" : "live"}).
              </p>
            </Card>

            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Ticket className="h-4 w-4 text-primary" />
                <div className="font-semibold">Redeem a code</div>
              </div>
              <p className="text-xs text-muted-foreground">Have a license code? Redeem it here to extend access.</p>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCD-1234-EFGH"
                  className="font-mono"
                />
                <Button onClick={redeem} disabled={redeeming || !code.trim()}>
                  {redeeming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Redeem
                </Button>
              </div>
            </Card>
          </>
        )}
      </div>

      <Dialog open={ackOpen} onOpenChange={(o) => { if (!checkoutLoading) setAckOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Before you continue
            </DialogTitle>
            <DialogDescription>
              Please review and acknowledge the following before proceeding to checkout.
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm space-y-3">
            <p className="text-muted-foreground">
              By continuing, you confirm you have read and agree to:
            </p>
            <ul className="space-y-2">
              <li>
                <Link to="/terms" target="_blank" className="text-primary hover:underline font-medium">
                  Terms &amp; Conditions
                </Link>
              </li>
              <li>
                <Link to="/refund-policy" target="_blank" className="text-primary hover:underline font-medium">
                  Refund Policy
                </Link>
              </li>
              <li>
                <Link to="/privacy" target="_blank" className="text-primary hover:underline font-medium">
                  Privacy Notice
                </Link>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Payments are processed by Paddle, the Merchant of Record for this purchase. Your acknowledgment will be recorded with a timestamp for our records.
            </p>

            <label className="flex items-start gap-2 pt-2 cursor-pointer">
              <Checkbox
                checked={ackChecked}
                onCheckedChange={(v) => setAckChecked(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                I have read and agree to the Terms &amp; Conditions, Refund Policy, and Privacy Notice.
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAckOpen(false)} disabled={checkoutLoading}>
              Cancel
            </Button>
            <Button onClick={upgrade} disabled={!ackChecked || checkoutLoading}>
              {checkoutLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Agree &amp; continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
