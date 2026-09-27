"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Eye, Mail, RotateCcw } from "lucide-react";
import type { Session } from "@/lib/types";
import { useMutation } from "@/lib/client";
import { InfoTip, Notice } from "./common";

type EmailTemplateOverride = {
  subjectPrefix?: string;
  headline?: string;
  intro?: string;
};

type EmailTemplatesConfig = {
  booking_confirmation: EmailTemplateOverride;
  payment_request: EmailTemplateOverride;
  waiver_request: EmailTemplateOverride;
  cancellation: EmailTemplateOverride;
};

const EMAIL_KINDS = [
  {
    key: "booking_confirmation" as const,
    label: "Booking confirmation",
    icon: "✅",
    defaultSubjectPrefix: "Booking confirmation",
    defaultHeadline: "Your booking is confirmed",
    defaultIntro:
      "Hello {leadName}, your reservation with {tenantName} is confirmed. Keep this email for check-in.",
    description: "Sent when staff confirm a reservation.",
  },
  {
    key: "payment_request" as const,
    label: "Payment request",
    icon: "💳",
    defaultSubjectPrefix: "Payment request",
    defaultHeadline: "Payment is requested",
    defaultIntro:
      "Hello {leadName}, {tenantName} is requesting payment for the booking below. Contact {tenantName} for their approved payment instructions.",
    description: "Sent to request an outstanding balance.",
  },
  {
    key: "waiver_request" as const,
    label: "Waiver request",
    icon: "📋",
    defaultSubjectPrefix: "Waiver request",
    defaultHeadline: "Please complete your waiver",
    defaultIntro:
      "Hello {leadName}, please complete the required waiver with {tenantName} before departure. Contact them if you need a link or assistance.",
    description: "Sent when a guest needs to sign a waiver.",
  },
  {
    key: "cancellation" as const,
    label: "Cancellation notice",
    icon: "❌",
    defaultSubjectPrefix: "Booking cancellation",
    defaultHeadline: "Your booking has been cancelled",
    defaultIntro:
      "Hello {leadName}, the booking below with {tenantName} has been cancelled. Contact them if you have questions.",
    description: "Sent when a booking is cancelled.",
  },
] as const;

const VARIABLES = [
  { token: "{leadName}", hint: "Guest's name" },
  { token: "{tenantName}", hint: "Your company name" },
  { token: "{productName}", hint: "Tour / product name" },
  { token: "{bookingRef}", hint: "Booking reference" },
];

const PREVIEW_CTX = {
  leadName: "Alex Johnson",
  tenantName: "Island Tours Co.",
  productName: "Sunset Catamaran Cruise",
  bookingRef: "A3B9F2E1",
};

function applyVars(template: string): string {
  return template
    .replace(/\{leadName\}/g, PREVIEW_CTX.leadName)
    .replace(/\{tenantName\}/g, PREVIEW_CTX.tenantName)
    .replace(/\{productName\}/g, PREVIEW_CTX.productName)
    .replace(/\{bookingRef\}/g, PREVIEW_CTX.bookingRef);
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildPreviewHtml(
  tenantName: string,
  headline: string,
  intro: string,
): string {
  const rows = [
    ["Tour", "Sunset Catamaran Cruise"],
    ["Departure", "Sat, 12 Oct 2024 · 4:00 PM AST"],
    ["Guests", "2 Adults, 1 Child"],
    ["Status", "Confirmed"],
    ["Total", "$350.00"],
  ]
    .map(
      ([l, v]) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #e8eef0;color:#65777b;font-size:13px;width:34%;vertical-align:top;">${escHtml(l)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e8eef0;color:#172f35;font-size:14px;font-weight:600;vertical-align:top;">${escHtml(v)}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:20px;background:#f0f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:#142f36;padding:24px 28px;">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.3px;">${escHtml(tenantName)}</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.5);font-size:12px;">Booking communication</p>
    </div>
    <div style="padding:28px;color:#172f35;font-size:14px;line-height:1.6;">
      <h2 style="margin:0 0 10px;font-size:20px;letter-spacing:-0.3px;">${escHtml(headline)}</h2>
      <p style="margin:0 0 22px;color:#3a5a62;">${escHtml(intro)}</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 24px;">${rows}</table>
      <div style="text-align:center;padding:18px 16px;background:#f5f7f7;border-radius:10px;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#65777b;font-weight:700;">Booking reference</p>
        <div style="width:100px;height:100px;background:#e8eef0;border-radius:6px;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;">
          <svg width="60" height="60" viewBox="0 0 60 60" fill="none"><rect x="2" y="2" width="20" height="20" rx="2" fill="#142f36"/><rect x="6" y="6" width="12" height="12" rx="1" fill="#fff"/><rect x="38" y="2" width="20" height="20" rx="2" fill="#142f36"/><rect x="42" y="6" width="12" height="12" rx="1" fill="#fff"/><rect x="2" y="38" width="20" height="20" rx="2" fill="#142f36"/><rect x="6" y="42" width="12" height="12" rx="1" fill="#fff"/><rect x="32" y="32" width="6" height="6" fill="#142f36"/><rect x="42" y="32" width="6" height="6" fill="#142f36"/><rect x="52" y="32" width="6" height="6" fill="#142f36"/><rect x="32" y="42" width="6" height="6" fill="#142f36"/><rect x="42" y="52" width="6" height="6" fill="#142f36"/><rect x="52" y="42" width="6" height="6" fill="#142f36"/></svg>
        </div>
        <p style="margin:0;font-size:18px;font-weight:800;letter-spacing:0.12em;font-family:ui-monospace,monospace;">A3B9F2E1</p>
        <p style="margin:8px 0 0;font-size:11px;color:#65777b;">Show this code at check-in if asked.</p>
      </div>
      <p style="margin:20px 0 0;font-size:13px;color:#65777b;">Questions? Contact ${escHtml(tenantName)}.</p>
    </div>
    <div style="padding:16px 28px;background:#f5f7f7;font-size:11px;color:#9ab;text-align:center;">
      Sent on behalf of ${escHtml(tenantName)} via Zettaz Tours &amp; Charters.
    </div>
  </div>
</body>
</html>`;
}

function emptyTemplates(): EmailTemplatesConfig {
  return {
    booking_confirmation: {},
    payment_request: {},
    waiver_request: {},
    cancellation: {},
  };
}

export function EmailTemplatesSettings({ session }: { session: Session }) {
  const canWrite = session.permissions.includes("config.write");
  const mutation = useMutation();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [templates, setTemplates] =
    useState<EmailTemplatesConfig>(emptyTemplates());
  const [saved, setSaved] = useState(false);
  const [activeKind, setActiveKind] = useState<keyof EmailTemplatesConfig>(
    "booking_confirmation",
  );
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    const stored =
      (session.tenant.config as { emailTemplates?: EmailTemplatesConfig })
        ?.emailTemplates ?? ({} as Partial<EmailTemplatesConfig>);
    setTemplates({
      booking_confirmation: stored.booking_confirmation ?? {},
      payment_request: stored.payment_request ?? {},
      waiver_request: stored.waiver_request ?? {},
      cancellation: stored.cancellation ?? {},
    });
  }, [session.tenant.config]);

  const kind = EMAIL_KINDS.find((k) => k.key === activeKind)!;
  const override = templates[activeKind];
  const headline = override.headline?.trim() || kind.defaultHeadline;
  const intro = applyVars(override.intro?.trim() || kind.defaultIntro);
  const tenantName = session.tenant.name ?? PREVIEW_CTX.tenantName;
  const subjectPrefix =
    override.subjectPrefix?.trim() || kind.defaultSubjectPrefix;
  const hasCustom =
    override.subjectPrefix?.trim() ||
    override.headline?.trim() ||
    override.intro?.trim();

  // Update iframe whenever preview content changes
  useEffect(() => {
    if (!showPreview || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(buildPreviewHtml(tenantName, headline, intro));
    doc.close();
  }, [showPreview, headline, intro, tenantName]);

  function update(field: keyof EmailTemplateOverride, value: string) {
    setSaved(false);
    setTemplates((prev) => ({
      ...prev,
      [activeKind]: { ...prev[activeKind], [field]: value },
    }));
  }

  function resetCurrent() {
    setSaved(false);
    setTemplates((prev) => ({ ...prev, [activeKind]: {} }));
  }

  function insertVar(token: string, field: "intro") {
    const current = templates[activeKind][field] ?? "";
    update(field, current + token);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const config = (session.tenant.config ?? {}) as Record<string, unknown>;
    const result = await mutation.run(
      "admin/v1/tenant/config",
      {
        version: session.tenant.version,
        config: { ...config, emailTemplates: templates },
      },
      "PATCH",
    );
    if (result) setSaved(true);
  }

  return (
    <section className="email-templates-root">
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="email-templates-header">
        <div className="email-templates-header-left">
          <Mail size={20} />
          <div>
            <h2>
              Email templates
              <InfoTip label="email templates">
                Customise the subject prefix, headline, and opening paragraph
                for each guest notification. Leave a field blank to keep the
                default. Changes apply to new notifications only — messages
                already sent are not affected.
              </InfoTip>
            </h2>
            <p className="muted">
              Override the default wording for each guest email type.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={"icon-button" + (showPreview ? " active" : "")}
          data-tooltip={showPreview ? "Hide preview" : "Show preview"}
          onClick={() => setShowPreview((v) => !v)}
        >
          <Eye size={16} />
        </button>
      </div>

      {/* ── Notices ─────────────────────────────────────────── */}
      {mutation.error && <Notice error>{mutation.error}</Notice>}
      {saved && (
        <Notice>
          <CheckCircle2 size={14} style={{ marginRight: 6, flexShrink: 0 }} />
          Templates saved — future notifications will use this wording.
        </Notice>
      )}

      {/* ── Body: editor + preview ───────────────────────────── */}
      <form
        className={"email-templates-body" + (showPreview ? " has-preview" : "")}
        onSubmit={(e) => void save(e)}
      >
        {/* Left: kind selector + fields */}
        <div className="email-templates-editor">
          {/* Kind tabs */}
          <div className="email-kind-tabs">
            {EMAIL_KINDS.map((k) => {
              const ov = templates[k.key];
              const isCustom =
                ov.subjectPrefix?.trim() ||
                ov.headline?.trim() ||
                ov.intro?.trim();
              return (
                <button
                  key={k.key}
                  type="button"
                  className={
                    "email-kind-tab" + (activeKind === k.key ? " active" : "")
                  }
                  onClick={() => {
                    setActiveKind(k.key);
                    setSaved(false);
                  }}
                >
                  <span className="email-kind-tab-label">{k.label}</span>
                  {isCustom && (
                    <span className="email-kind-dot" title="Customised" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Fields */}
          <div className="email-template-fields">
            <p className="email-kind-desc muted">{kind.description}</p>

            {/* Subject prefix */}
            <div className="email-field-group">
              <label className="email-field-label">
                Subject prefix
                <span className="email-field-hint">
                  e.g. "{subjectPrefix} · A3B9F2E1 · {tenantName}"
                </span>
              </label>
              <input
                type="text"
                maxLength={120}
                placeholder={kind.defaultSubjectPrefix}
                value={override.subjectPrefix ?? ""}
                disabled={!canWrite}
                onChange={(e) => update("subjectPrefix", e.target.value)}
              />
            </div>

            {/* Headline */}
            <div className="email-field-group">
              <label className="email-field-label">
                Headline
                <span className="email-field-hint">
                  Shown as the email's main title
                </span>
              </label>
              <input
                type="text"
                maxLength={200}
                placeholder={kind.defaultHeadline}
                value={override.headline ?? ""}
                disabled={!canWrite}
                onChange={(e) => update("headline", e.target.value)}
              />
            </div>

            {/* Opening paragraph */}
            <div className="email-field-group">
              <label className="email-field-label">
                Opening paragraph
                <span className="email-field-hint">
                  First paragraph the guest reads
                </span>
              </label>
              <textarea
                rows={4}
                maxLength={1500}
                placeholder={kind.defaultIntro}
                value={override.intro ?? ""}
                disabled={!canWrite}
                onChange={(e) => update("intro", e.target.value)}
              />
              {/* Variable chips */}
              <div className="email-var-chips">
                <span className="email-var-chips-label">Insert:</span>
                {VARIABLES.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    className="email-var-chip"
                    title={v.hint}
                    disabled={!canWrite}
                    onClick={() => insertVar(v.token, "intro")}
                  >
                    {v.token}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="email-field-actions">
              {hasCustom && canWrite && (
                <button
                  type="button"
                  className="text-button"
                  onClick={resetCurrent}
                >
                  <RotateCcw size={13} />
                  Reset to default
                </button>
              )}
              {canWrite && (
                <button
                  type="submit"
                  className="button"
                  disabled={mutation.busy}
                >
                  {mutation.busy ? "Saving…" : "Save templates"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: live preview */}
        {showPreview && (
          <div className="email-templates-preview">
            <div className="email-preview-topbar">
              <div className="email-preview-subject">
                <span className="email-preview-label">Subject</span>
                <span className="email-preview-subject-text">
                  {subjectPrefix} · A3B9F2E1 · {tenantName}
                </span>
              </div>
              <span className="email-preview-badge">Preview</span>
            </div>
            <iframe
              ref={iframeRef}
              className="email-preview-iframe"
              title="Email preview"
              sandbox="allow-same-origin"
            />
          </div>
        )}
      </form>

      {!canWrite && (
        <Notice>
          You need config.write permission to modify email templates.
        </Notice>
      )}
    </section>
  );
}
