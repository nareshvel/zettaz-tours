"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowLeft,
  CreditCard,
  Database,
  Eye,
  FileText,
  Globe,
  Lock,
  Mail,
  Scale,
  Shield,
  Users,
  AlertTriangle,
  X,
} from "lucide-react";

export type LegalDoc = "terms" | "privacy";

const UPDATED = "September 17, 2026";
const PRODUCT = "Zettaz Tours & Charters";
const COMPANY = "Zettaz";
const SUPPORT = "support@zettaz.com";

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="legal-section">
      <div className="legal-section-head">
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="legal-section-body">{children}</div>
    </section>
  );
}

export function TermsContent() {
  return (
    <>
      <Section icon={<FileText size={22} />} title="1. Agreement to Terms">
        <p>
          These Terms of Service (“Terms”) are a legally binding agreement
          between you (“Customer,” “you,” or “your”) and {COMPANY} (“we,” “us,”
          or “our”) regarding your use of {PRODUCT}, our multi-tenant software
          platform for tour, charter, excursion, and transport operators.
        </p>
        <p>
          By creating an account, starting a trial, or using the service, you
          agree to these Terms. If you do not agree, do not use the service.
        </p>
      </Section>

      <Section icon={<Shield size={22} />} title="2. Description of Services">
        <p>{PRODUCT} provides operator workspace tools that may include:</p>
        <ul>
          <li>Reservations, holds, availability, and departure management</li>
          <li>Day board, pickup planning, manifests, and boarding workflows</li>
          <li>Staff access, roles, and crew-facing tools</li>
          <li>Waivers, check-in, and guest communication features</li>
          <li>
            Payments, partner attribution, reports, and related admin tools
          </li>
          <li>Integrations and import workflows where enabled for your plan</li>
        </ul>
        <p>
          Features vary by subscription plan and configuration. We may modify,
          suspend, or discontinue features with reasonable notice where
          practical.
        </p>
      </Section>

      <Section icon={<Users size={22} />} title="3. Accounts and registration">
        <h3>3.1 Account creation</h3>
        <p>
          You must provide accurate business and account information. You are
          responsible for your credentials and for activity under your
          workspace, including actions by staff you invite.
        </p>
        <h3>3.2 Account security</h3>
        <ul>
          <li>Keep passwords confidential and use strong credentials</li>
          <li>Notify us promptly of suspected unauthorized access</li>
          <li>Revoke access for staff who leave your organization</li>
          <li>Enable available security controls when offered</li>
        </ul>
        <h3>3.3 Suspension or termination</h3>
        <p>
          We may suspend or terminate access for Terms violations, non-payment,
          abuse, or security risk. You may cancel according to your plan and
          billing settings.
        </p>
      </Section>

      <Section icon={<AlertTriangle size={22} />} title="4. Acceptable use">
        <p>
          You may use the service only for lawful operator purposes. You may
          not:
        </p>
        <ul>
          <li>Violate applicable law or third-party rights</li>
          <li>Attempt unauthorized access, probing, or interference</li>
          <li>Upload malware or abuse the platform</li>
          <li>Reverse engineer the software except where law allows</li>
          <li>
            Resell or white-label the service without our written permission
          </li>
          <li>
            Use the service to build a competing product from our materials
          </li>
        </ul>
      </Section>

      <Section
        icon={<CreditCard size={22} />}
        title="5. Trials, plans, and billing"
      >
        <h3>5.1 Free trial</h3>
        <p>
          Trial access is provided for evaluation. Trial length, limits, and
          conversion to a paid plan are described at signup and in-product. We
          may end or change trial terms prospectively.
        </p>
        <h3>5.2 Subscription fees</h3>
        <p>
          Paid plans are billed in advance per the selected cycle. Fees are
          generally non-refundable except where required by law or expressly
          stated.
        </p>
        <h3>5.3 Payment processing</h3>
        <p>
          Card and subscription payments may be processed by Stripe or other
          processors. Failed payments may lead to grace periods, restricted
          access, or suspension as described in-product.
        </p>
        <h3>5.4 Taxes</h3>
        <p>
          You are responsible for taxes related to your subscription, except
          taxes on our net income.
        </p>
      </Section>

      <Section icon={<Shield size={22} />} title="6. Your operator data">
        <p>
          You retain ownership of your business data (bookings, guests,
          manifests, payments records, and configuration). You grant us a
          limited license to host and process that data solely to provide and
          secure the service.
        </p>
        <p>
          You are responsible for the legality of guest, passenger, and partner
          data you enter, including consent and retention obligations in your
          jurisdictions of operation.
        </p>
      </Section>

      <Section icon={<Lock size={22} />} title="7. Privacy">
        <p>
          Our collection and use of personal information is described in the{" "}
          <Link href="/privacy">Privacy Policy</Link>, which forms part of these
          Terms.
        </p>
      </Section>

      <Section
        icon={<FileText size={22} />}
        title="8. Disclaimers and liability"
      >
        <p>
          The service is provided “as is” to the extent permitted by law. We do
          not warrant uninterrupted or error-free operation. To the maximum
          extent permitted by law, our aggregate liability arising from the
          service is limited to the fees you paid us for the service in the
          three months before the claim.
        </p>
      </Section>

      <Section icon={<Globe size={22} />} title="9. Changes">
        <p>
          We may update these Terms. Material changes will be posted with an
          updated date. Continued use after the effective date constitutes
          acceptance of the revised Terms.
        </p>
      </Section>

      <Section icon={<Mail size={22} />} title="10. Contact">
        <p>
          Questions about these Terms:{" "}
          <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>
        </p>
      </Section>
    </>
  );
}

export function PrivacyContent() {
  return (
    <>
      <Section icon={<Eye size={22} />} title="1. Introduction">
        <p>
          This Privacy Policy explains how {COMPANY} collects, uses, and
          protects information when you use {PRODUCT}.
        </p>
        <p>
          By using the service, you agree to this Policy. If you do not agree,
          do not use the service.
        </p>
      </Section>

      <Section icon={<Database size={22} />} title="2. Information we collect">
        <h3>2.1 Account and business information</h3>
        <ul>
          <li>Name, email, and phone number</li>
          <li>Company name, country, timezone, and currency preferences</li>
          <li>Billing and subscription details when you subscribe</li>
          <li>Staff invitations and role assignments</li>
        </ul>
        <h3>2.2 Operator content</h3>
        <p>As you use the workspace, you may store:</p>
        <ul>
          <li>
            Reservations, guest and passenger details, and stay information
          </li>
          <li>Pickup, manifest, waiver, and boarding records</li>
          <li>Payment, partner, and operational notes</li>
          <li>Documents and files you upload</li>
        </ul>
        <h3>2.3 Technical information</h3>
        <ul>
          <li>IP address, device, and browser data</li>
          <li>Authentication and session logs</li>
          <li>
            Usage and diagnostic events needed to run and secure the service
          </li>
        </ul>
      </Section>

      <Section icon={<Globe size={22} />} title="3. How we use information">
        <ul>
          <li>
            <strong>Service delivery:</strong> provide reservations, ops, and
            account features
          </li>
          <li>
            <strong>Account & billing:</strong> authenticate users, manage
            trials and subscriptions
          </li>
          <li>
            <strong>Communications:</strong> send verification, security, and
            service messages
          </li>
          <li>
            <strong>Security:</strong> detect abuse, prevent fraud, and protect
            tenants
          </li>
          <li>
            <strong>Improvement:</strong> understand product usage in aggregate
          </li>
          <li>
            <strong>Legal compliance:</strong> meet applicable legal obligations
          </li>
        </ul>
      </Section>

      <Section icon={<Lock size={22} />} title="4. Sharing and disclosure">
        <p>
          We do not sell your personal information. We may share information
          with:
        </p>
        <h3>4.1 Service providers</h3>
        <p>
          Trusted processors (for example hosting, email delivery, and payment
          providers) who process data on our instructions.
        </p>
        <h3>4.2 Legal requirements</h3>
        <p>When required by law or to protect rights, safety, or security.</p>
        <h3>4.3 Business transfers</h3>
        <p>
          In a merger or acquisition, subject to continued privacy protections.
        </p>
      </Section>

      <Section icon={<Shield size={22} />} title="5. Security">
        <p>
          We use administrative, technical, and organizational measures such as
          encryption in transit, access controls, tenant isolation, and
          monitoring. No system is perfectly secure; please protect your
          credentials and devices.
        </p>
      </Section>

      <Section icon={<Eye size={22} />} title="6. Your rights and choices">
        <p>
          Depending on your location, you may have rights to access, correct,
          delete, or export personal information, or to object to certain
          processing. Contact us to make a request. We may need to verify your
          identity and will respond as required by applicable law.
        </p>
      </Section>

      <Section icon={<Database size={22} />} title="7. Retention">
        <p>
          We retain account and operational data for as long as your workspace
          is active and as needed for legal, security, and billing records.
          After cancellation, data may be retained for a limited period for
          recovery or compliance, then deleted or anonymized according to our
          retention practices.
        </p>
      </Section>

      <Section icon={<Users size={22} />} title="8. Operator responsibilities">
        <p>
          If you store guest or passenger personal data, you act as the
          controller of that data. You must have a lawful basis to collect and
          process it and must configure retention and access appropriately for
          your operations.
        </p>
      </Section>

      <Section icon={<Globe size={22} />} title="9. International processing">
        <p>
          We may process information in countries where we or our providers
          operate. Where required, we use appropriate safeguards for
          cross-border transfers.
        </p>
      </Section>

      <Section icon={<FileText size={22} />} title="10. Changes">
        <p>
          We may update this Policy and will revise the “Last updated” date.
          Continued use after changes take effect means you accept the updated
          Policy.
        </p>
      </Section>

      <Section icon={<Mail size={22} />} title="11. Contact">
        <p>
          Privacy questions: <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>
        </p>
      </Section>
    </>
  );
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const isTerms = doc === "terms";
  return (
    <main className="legal-page">
      <nav className="legal-nav">
        <Link href="/" className="legal-brand" aria-label={PRODUCT}>
          <img src="/brand/zettaz-logo-dark.svg" alt={PRODUCT} />
        </Link>
        <Link href="/signup" className="legal-back">
          <ArrowLeft size={16} />
          Back to signup
        </Link>
      </nav>
      <div className="legal-shell">
        <header className="legal-hero">
          <div className="legal-hero-icon" aria-hidden="true">
            {isTerms ? <Scale size={32} /> : <Shield size={32} />}
          </div>
          <h1>{isTerms ? "Terms of Service" : "Privacy Policy"}</h1>
          <p>
            {isTerms
              ? "Please read these terms carefully before using Zettaz Tours & Charters."
              : "How we collect, use, and protect information in Zettaz Tours & Charters."}
          </p>
          <p className="legal-updated">Last updated: {UPDATED}</p>
        </header>
        <article className="legal-card">
          {isTerms ? <TermsContent /> : <PrivacyContent />}
        </article>
      </div>
    </main>
  );
}

export function LegalDocumentModal({
  doc,
  open,
  onClose,
}: {
  doc: LegalDoc | null;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !doc || typeof document === "undefined") return null;

  const isTerms = doc === "terms";
  return createPortal(
    <div className="confirm-dialog-root legal-dialog-root" role="presentation">
      <button
        type="button"
        className="confirm-dialog-scrim"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="panel confirm-dialog-sheet form-dialog-sheet legal-dialog-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="confirm-dialog-head">
          <div>
            <h2 id={titleId}>
              {isTerms ? "Terms of Service" : "Privacy Policy"}
            </h2>
            <p className="muted">Last updated: {UPDATED}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="confirm-dialog-body legal-dialog-body">
          {isTerms ? <TermsContent /> : <PrivacyContent />}
        </div>
        <div className="confirm-dialog-actions legal-dialog-actions">
          <Link
            className="button secondary"
            href={isTerms ? "/terms" : "/privacy"}
            target="_blank"
            rel="noreferrer"
          >
            Open full page
          </Link>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
