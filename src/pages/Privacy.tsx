import { LegalLayout } from "@/components/LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Notice">
      <p>
        This Privacy Notice explains how <strong>First Glance Automation</strong> ("we", "us",
        "our") collects, uses, and shares personal data when you use our video monitoring and
        alerting service (the "Service"). We act as the <strong>data controller</strong> for
        personal data processed about your account and use of the Service.
      </p>

      <h2>1. Personal Data We Collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email address, username, password (hashed), display name.</li>
        <li><strong>Organisation data:</strong> organisation name, role, team membership.</li>
        <li><strong>Usage & telemetry:</strong> pages visited, actions taken, timestamps, error logs.</li>
        <li><strong>Device & technical data:</strong> IP address, browser type, device identifiers.</li>
        <li><strong>Customer Content:</strong> camera snapshots, alert metadata, callout notes you generate through the Service.</li>
        <li><strong>Support communications:</strong> messages you send to us through support channels.</li>
      </ul>

      <h2>2. Why We Use Your Data</h2>
      <ul>
        <li><strong>Provide the Service</strong> — account creation, authentication, delivering alerts and callouts. <em>(Legal basis: contract performance.)</em></li>
        <li><strong>Security & fraud prevention</strong> — detecting abuse and protecting accounts. <em>(Legal basis: legitimate interests.)</em></li>
        <li><strong>Product improvement</strong> — analytics on aggregated usage to improve features. <em>(Legal basis: legitimate interests.)</em></li>
        <li><strong>Customer support</strong> — responding to your questions. <em>(Legal basis: contract performance / legitimate interests.)</em></li>
        <li><strong>Legal compliance</strong> — complying with our legal obligations. <em>(Legal basis: legal obligation.)</em></li>
      </ul>

      <h2>3. Who We Share Data With</h2>
      <ul>
        <li><strong>Service providers / subprocessors</strong> — hosting, database, email delivery, and analytics providers used to operate the Service.</li>
        <li><strong>Merchant of Record (Paddle)</strong> — for processing payments, subscription management, tax compliance, and invoicing. Paddle acts as an independent controller for payment data.</li>
        <li><strong>Professional advisers</strong> — legal, accounting, and similar advisers where necessary.</li>
        <li><strong>Authorities</strong> — when required by law or to protect our rights.</li>
      </ul>

      <h2>4. Data Retention</h2>
      <p>
        We retain personal data for as long as your account is active and for a reasonable
        period afterwards to comply with legal obligations, resolve disputes, and enforce our
        agreements. When data is no longer needed it is deleted or anonymised.
      </p>

      <h2>5. Security</h2>
      <p>
        We use appropriate technical and organisational measures to protect personal data,
        including encryption in transit, access controls, and row-level security on stored
        data. No system is perfectly secure, but we work continuously to protect your data.
      </p>

      <h2>6. International Transfers</h2>
      <p>
        Personal data may be processed outside your country of residence by our service
        providers. Where required, we use appropriate safeguards (such as Standard
        Contractual Clauses or adequacy decisions) for international transfers.
      </p>

      <h2>7. Your Rights</h2>
      <p>Depending on your jurisdiction, you may have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you;</li>
        <li>Request correction or deletion of your personal data;</li>
        <li>Restrict or object to certain processing;</li>
        <li>Request portability of your data;</li>
        <li>Withdraw consent where processing is based on consent;</li>
        <li>Lodge a complaint with your local data protection authority.</li>
      </ul>
      <p>
        To exercise these rights, contact us through the in-app support channels. We will
        respond within the timeframe required by applicable law (typically one month).
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use essential cookies for authentication and session management. We may use
        analytics cookies to understand how the Service is used. You can manage cookie
        preferences through your browser settings.
      </p>

      <h2>9. Changes to This Notice</h2>
      <p>
        We may update this Privacy Notice from time to time. Material changes will be
        communicated through the Service or by email.
      </p>

      <h2>10. Contact</h2>
      <p>
        For privacy questions or to exercise your rights, contact <strong>First Glance
        Automation</strong> through the support channels in the application.
      </p>
    </LegalLayout>
  );
}
