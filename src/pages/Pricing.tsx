import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Pricing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-semibold">First Glance Automation</Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/refund-policy" className="hover:text-foreground">Refunds</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">Simple, transparent pricing</h1>
          <p className="text-muted-foreground">
            ABC monitoring & Frigate alerts for security operators. Start free, upgrade when you're ready.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <Card className="p-6 space-y-4">
            <div>
              <div className="text-sm text-muted-foreground">Free trial</div>
              <div className="text-3xl font-bold">$0</div>
              <div className="text-xs text-muted-foreground">Try it out, no card required</div>
            </div>
            <ul className="text-sm space-y-2">
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Up to 1 NVR</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Limited email notifications</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Core monitoring features</li>
            </ul>
            <Button asChild variant="outline" className="w-full">
              <Link to="/signup">Start free trial</Link>
            </Button>
          </Card>

          <Card className="p-6 space-y-4 border-primary/40 relative">
            <div className="absolute -top-3 right-4 text-[10px] bg-primary text-primary-foreground px-2 py-1 rounded">Most popular</div>
            <div>
              <div className="text-sm text-muted-foreground">Pro</div>
              <div className="text-3xl font-bold">$29<span className="text-base font-normal text-muted-foreground">/month</span></div>
              <div className="text-xs text-muted-foreground">Everything you need to run security ops</div>
            </div>
            <ul className="text-sm space-y-2">
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Unlimited NVRs</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Unlimited email notifications</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Daily reports & callout requests</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Full branding & customization</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> All admin features</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> Cancel anytime</li>
            </ul>
            <Button asChild className="w-full">
              <Link to="/signup">Get started</Link>
            </Button>
          </Card>
        </div>

        <div className="mt-12 text-center text-xs text-muted-foreground space-y-2">
          <p>
            Payments are processed securely by Paddle, our Merchant of Record.
            30-day money-back guarantee — see our <Link to="/refund-policy" className="underline">Refund Policy</Link>.
          </p>
          <p>
            Prices in USD. VAT and sales tax may apply based on your location.
          </p>
        </div>

        <footer className="mt-16 pt-6 border-t text-sm text-muted-foreground text-center">
          © {new Date().getFullYear()} First Glance Automation. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
