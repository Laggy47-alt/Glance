import { LegalLayout } from "@/components/LegalLayout";

export default function RefundPolicy() {
  return (
    <LegalLayout title="Refund Policy">
      <p>
        <strong>First Glance Automation</strong> wants you to be happy with your subscription.
        We offer a <strong>30-day money-back guarantee</strong> on all paid subscriptions.
      </p>

      <h2>Eligibility</h2>
      <p>
        If you're not satisfied with your purchase, you can request a full refund within
        <strong> 30 days</strong> of your initial order date. The guarantee applies to first-time
        subscription purchases.
      </p>

      <h2>How to Request a Refund</h2>
      <p>
        Refunds are processed by our payment provider, <strong>Paddle</strong>, which acts as
        Merchant of Record for all our transactions. To request a refund:
      </p>
      <ul>
        <li>
          Visit <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a> and look up
          your transaction using the email address you used at checkout, or
        </li>
        <li>Contact our support team through the application and we will help you submit the request.</li>
      </ul>

      <h2>Processing Time</h2>
      <p>
        Approved refunds are typically returned to your original payment method within 5–10
        business days, depending on your bank or card issuer.
      </p>

      <h2>Renewals</h2>
      <p>
        You can cancel your subscription at any time from your billing page to prevent future
        renewal charges. Cancellation stops future billing; for refunds on a renewal charge,
        please contact us within the refund window.
      </p>

      <h2>Questions</h2>
      <p>
        If you have any questions about this policy, contact us through the in-app support
        channels and we'll be glad to help.
      </p>
    </LegalLayout>
  );
}
