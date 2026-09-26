"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import type { Session } from "@/lib/types";
import { useMutation } from "@/lib/client";
import { Field, InfoTip, Notice, SectionHeading } from "./common";

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
    defaultSubjectPrefix: "Booking confirmation",
    defaultHeadline: "Your booking is confirmed",
    defaultIntro:
      "Hello {leadName}, your reservation with {tenantName} is confirmed. Keep this email for check-in.",
    description:
      "Sent when staff confirm a reservation. Tells the guest they're booked.",
  },
  {
    key: "payment_request" as const,
    label: "Payment request",
    defaultSubjectPrefix: "Payment request",
    defaultHeadline: "Payment is requested",
    defaultIntro:
      "Hello {leadName}, {tenantName} is requesting payment for the booking below. Contact {tenantName} for their approved payment instructions.",
    description:
      "Sent to request an outstanding balance. No payment link is included.",
  },
  {
    key: "waiver_request" as const,
    label: "Waiver request",
    defaultSubjectPrefix: "Waiver request",
    defaultHeadline: "Please complete your waiver",
    defaultIntro:
      "Hello {leadName}, please complete the required waiver with {tenantName} before departure. Contact them if you need a link or assistance.",
    description: "Sent when the guest needs to sign a waiver before check-in.",
  },
  {
    key: "cancellation" as const,
    label: "Cancellation notice",
    defaultSubjectPrefix: "Booking cancellation",
    defaultHeadline: "Your booking has been cancelled",
    defaultIntro:
      "Hello {leadName}, the booking below with {tenantName} has been cancelled. Contact them if you have questions about this change.",
    description: "Sent when a booking is cancelled.",
  },
] as const;

const VARIABLES = [
  { token: "{leadName}", hint: "Guest's name" },
  { token: "{tenantName}", hint: "Your company name" },
  { token: "{productName}", hint: "Tour / product name" },
  { token: "{bookingRef}", hint: "Short booking reference" },
];

function emptyTemplates(): EmailTemplatesConfig {
  return {
    booking_confirmation: {},
    payment_request: {},
    waiver_request: {},
    cancellation: {},
  };
}

export function EmailTemplatesSettings({ session }: { session: Session }) {
  const canWrite = session.permissions.includes("settings.write");
  const mutation = useMutation();

  const [templates, setTemplates] = useState<EmailTemplatesConfig>(
    emptyTemplates(),
  );
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(
    "booking_confirmation",
  );

  useEffect(() => {
    const stored =
      (session.tenant.config as { emailTemplates?: EmailTemplatesConfig })
        ?.emailTemplates ?? {};
    setTemplates({
      booking_confirmation: stored.booking_confirmation ?? {},
      payment_request: stored.payment_request ?? {},
      waiver_request: stored.waiver_request ?? {},
      cancellation: stored.cancellation ?? {},
    });
  }, [session.tenant.config]);

  function update(
    kind: keyof EmailTemplatesConfig,
    field: keyof EmailTemplateOverride,
    value: string,
  ) {
    setSaved(false);
    setTemplates((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], [field]: value },
    }));
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
    <section>
      <div className="settings-card-head">
        <Mail size={20} />
        <div>
          <h2>
            Email templates
            <InfoTip label="email templates">
              Customise the subject line prefix, headline, and opening paragraph
              for each guest notification. Leave a field blank to keep the
              default wording. Saved text applies to every new notification
              from this point on — messages already sent are not affected. Use{" "}
              {VARIABLES.map((v) => v.token).join(", ")} to insert booking
              details.
            </InfoTip>
          </h2>
          <p>
            Override the default subject, headline, and intro for each guest
            email.
          </p>
        </div>
      </div>

      <div className="email-template-vars">
        <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          Available variables:
        </p>
        <div className="email-template-var-list">
          {VARIABLES.map((v) => (
            <span key={v.token} className="email-template-var-chip">
              <code>{v.token}</code>
              <span>{v.hint}</span>
            </span>
          ))}
        </div>
      </div>

      {mutation.error && <Notice error>{mutation.error}</Notice>}
      {saved && (
        <Notice>
          Email templates saved. Future notifications will use this wording.
        </Notice>
      )}

      <form onSubmit={(e) => void save(e)}>
        {EMAIL_KINDS.map((kind) => {
          const isOpen = expanded === kind.key;
          const override = templates[kind.key];
          const hasCustom =
            override.subjectPrefix?.trim() ||
            override.headline?.trim() ||
            override.intro?.trim();
          return (
            <div key={kind.key} className="email-template-card">
              <button
                type="button"
                className="email-template-card-head"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : kind.key)}
              >
                <div>
                  <strong>{kind.label}</strong>
                  <p className="muted">{kind.description}</p>
                </div>
                <span
                  className={
                    "email-template-badge" + (hasCustom ? " is-custom" : "")
                  }
                >
                  {hasCustom ? "Customised" : "Default"}
                </span>
              </button>
              {isOpen && (
                <div className="email-template-card-body">
                  <Field
                    label="Subject prefix"
                    hint={`Default: "${kind.defaultSubjectPrefix}"`}
                  >
                    <input
                      type="text"
                      maxLength={120}
                      placeholder={kind.defaultSubjectPrefix}
                      value={override.subjectPrefix ?? ""}
                      disabled={!canWrite}
                      onChange={(e) =>
                        update(kind.key, "subjectPrefix", e.target.value)
                      }
                    />
                  </Field>
                  <Field
                    label="Headline"
                    hint={`Default: "${kind.defaultHeadline}"`}
                  >
                    <input
                      type="text"
                      maxLength={200}
                      placeholder={kind.defaultHeadline}
                      value={override.headline ?? ""}
                      disabled={!canWrite}
                      onChange={(e) =>
                        update(kind.key, "headline", e.target.value)
                      }
                    />
                  </Field>
                  <Field
                    label="Opening paragraph"
                    hint={`Default: "${kind.defaultIntro}"`}
                  >
                    <textarea
                      rows={4}
                      maxLength={1500}
                      placeholder={kind.defaultIntro}
                      value={override.intro ?? ""}
                      disabled={!canWrite}
                      onChange={(e) =>
                        update(kind.key, "intro", e.target.value)
                      }
                    />
                  </Field>
                  {canWrite && (
                    <div className="button-row" style={{ marginTop: 4 }}>
                      {hasCustom && (
                        <button
                          type="button"
                          className="text-button danger"
                          onClick={() => {
                            setSaved(false);
                            setTemplates((prev) => ({
                              ...prev,
                              [kind.key]: {},
                            }));
                          }}
                        >
                          Reset to default
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {canWrite && (
          <div className="form-actions">
            <button
              type="submit"
              className="button"
              disabled={mutation.busy}
            >
              {mutation.busy ? "Saving…" : "Save templates"}
            </button>
          </div>
        )}
      </form>

      {!canWrite && (
        <Notice>Only workspace owners can modify email templates.</Notice>
      )}
    </section>
  );
}
EOSX
echo "email-templates-settings.tsx created"
