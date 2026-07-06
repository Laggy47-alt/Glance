import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, RefreshCw, Copy, Check, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

type Props = {
  open: boolean;
  onClose: () => void;
  responderId: string | null;
  responderName: string;
};

type Device = {
  id: string;
  token: string;
  label: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const sb = supabase as any;

// Generate a random opaque token client-side.
function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ProvisionDeviceDialog({ open, onClose, responderId, responderName }: Props) {
  const { activeOrg } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  const load = async () => {
    if (!responderId) return;
    setLoading(true);
    const { data } = await sb.from("responder_devices")
      .select("*").eq("responder_id", responderId).is("revoked_at", null)
      .maybeSingle();
    setDevice((data ?? null) as Device | null);
    setLoading(false);
  };

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setLabel("");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, responderId]);

  const generate = async () => {
    if (!activeOrg?.id || !responderId) return;
    setLoading(true);
    // Revoke any existing active token
    if (device) {
      await sb.from("responder_devices")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", device.id);
    }
    const token = makeToken();
    const { data, error } = await sb.from("responder_devices").insert({
      organization_id: activeOrg.id,
      responder_id: responderId,
      token,
      label: label.trim() || null,
    }).select("*").maybeSingle();
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setDevice(data as Device);
    toast.success("Device token generated");
  };

  const revoke = async () => {
    if (!device) return;
    if (!confirm("Revoke this device? The phone will stop working until re-provisioned.")) return;
    await sb.from("responder_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", device.id);
    setDevice(null);
    toast.success("Device revoked");
  };

  const copyToken = () => {
    if (!device) return;
    navigator.clipboard.writeText(device.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Payload the Android app scans. Base64-safe JSON with everything the app needs.
  const provisionPayload = device ? JSON.stringify({
    v: 1,
    token: device.token,
    endpoint: `${supabaseUrl}/functions/v1`,
    responder: responderName,
  }) : "";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            Provision phone — {responderName}
          </DialogTitle>
          <DialogDescription>
            One active device per responder. Scan the QR from the responder Android app.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
          </div>
        ) : device ? (
          <div className="space-y-4">
            <div className="flex justify-center rounded-lg border border-border bg-white p-4">
              <QRCodeSVG value={provisionPayload} size={220} level="M" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Or paste this token manually</Label>
              <div className="flex gap-2">
                <Input value={device.token} readOnly className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={copyToken}>
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {device.label && (
              <p className="text-xs text-muted-foreground">Label: <span className="font-medium">{device.label}</span></p>
            )}
            <div className="text-xs text-muted-foreground">
              {device.last_seen_at
                ? `Last ping: ${new Date(device.last_seen_at).toLocaleString()}`
                : "Never pinged yet."}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={generate}>
                <RefreshCw className="h-3.5 w-3.5" /> Rotate token
              </Button>
              <Button variant="destructive" size="sm" onClick={revoke}>Revoke</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No active token for this responder. Generate one to provision their phone.
            </p>
            <div className="space-y-1.5">
              <Label>Device label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="Samsung A15 — John's phone" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {!device && (
            <Button onClick={generate} disabled={loading}>Generate token</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
