import { LegalLayout } from "@/components/LegalLayout";

export default function Terms() {
  return (
    <LegalLayout title="Terms & Conditions">
      <p>
        These Terms & Conditions ("Terms") govern your use of the services provided by
        <strong> First Glance Automation</strong> ("we", "us", "our"), including our video
        monitoring, alerting, and operator-callout software (the "Service"). By creating
        an account or using the Service, you agree to these Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        First Glance Automation provides a monitoring platform that connects to NVR/Frigate
        camera systems to deliver alerts, callouts, and operator workflows to security teams
        and end customers. The Service is provided on a subscription basis.
      </p>

      <h2>2. Eligibility & Account</h2>
      <ul>
        <li>You must be at least 18 years old or, if a business, authorised to bind your organisation.</li>
        <li>You are responsible for keeping your login credentials confidential and for all activity under your account.</li>
        <li>You must provide accurate information and keep it up to date.</li>
      </ul>

      <h2>3. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful, fraudulent, or harmful purpose.</li>
        <li>Send spam or unsolicited communications via the Service.</li>
        <li>Infringe on any intellectual property or privacy rights, including by monitoring people without lawful basis.</li>
        <li>Interfere with the security or integrity of the Service (including malware, probing, scraping, or reverse engineering).</li>
        <li>Resell or redistribute the Service without our written permission.</li>
      </ul>

      <h2>4. Intellectual Property</h2>
      <p>
        We retain all rights, title, and interest in the Service, including software,
        documentation, branding, and design. We grant you a limited, non-exclusive,
        non-transferable right to use the Service in accordance with your subscription plan.
      </p>

      <h2>5. Customer Content</h2>
      <p>
        You retain ownership of the camera footage, snapshots, and other content you upload
        or generate through the Service ("Customer Content"). You grant us a limited licence
        to host, process, and transmit Customer Content solely to provide the Service.
      </p>

      <h2>6. Service Availability</h2>
      <p>
        We work to keep the Service running smoothly but do not guarantee uninterrupted or
        error-free performance. The Service is provided "as is" and we disclaim all implied
        warranties (including merchantability and fitness for a particular purpose) to the
        fullest extent permitted by law.
      </p>

      <h2>7. Payment, Subscriptions & Billing</h2>
      <p>
        Our order process is conducted by our online reseller <strong>Paddle.com</strong>.
        Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer
        service inquiries and handles returns. Payment, billing frequency, taxes, cancellations,
        and refund mechanics are governed by Paddle's <a href="https://www.paddle.com/legal/checkout-buyer-terms" target="_blank" rel="noopener noreferrer">Buyer Terms</a>.
      </p>
      <p>
        Subscriptions renew automatically at the end of each billing period unless cancelled.
        You can cancel at any time from your billing page or via Paddle.
      </p>

      <h2>8. Suspension & Termination</h2>
      <p>We may suspend or terminate your access to the Service if:</p>
      <ul>
        <li>You materially breach these Terms;</li>
        <li>Your subscription becomes overdue;</li>
        <li>We reasonably believe your account presents a security or fraud risk; or</li>
        <li>You repeatedly or seriously violate our acceptable use rules.</li>
      </ul>
      <p>
        On termination, your access ends and Customer Content may be deleted after a reasonable
        export window.
      </p>

      <h2>9. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, our aggregate liability under these Terms is
        capped at the fees you paid us in the 12 months preceding the claim. We are not liable
        for indirect, consequential, or special damages, including loss of profits, data, or
        goodwill. Nothing in these Terms excludes liability for fraud, death, or personal
        injury where this cannot be excluded by law.
      </p>

      <h2>10. Indemnity</h2>
      <p>
        You agree to indemnify us against any claims arising from your Customer Content,
        unlawful use of the Service, or breach of these Terms.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update these Terms from time to time. Material changes will be communicated
        through the Service or by email. Continued use after changes take effect constitutes
        acceptance.
      </p>

      <h2>12. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the jurisdiction in which First Glance
        Automation is established. Disputes will be resolved in the competent courts of that
        jurisdiction.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Contact us via the support channels in the application.
      </p>
    </LegalLayout>
  );
}
