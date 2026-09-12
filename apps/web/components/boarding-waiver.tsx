"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Booking, Manifest } from "@/lib/types";
import { label, useMutation, useResource } from "@/lib/client";
import { Field, Notice } from "./common";

type Stay = NonNullable<Booking["stay"]>;
type Passenger = Manifest["bookings"][number]["passengers"][number];
type Point = { x: number; y: number };

type WaiverTemplate = {
  id: string;
  version: number;
  title: string;
  body: string;
};

function stayFromBooking(stay?: Stay | null): {
  kind: Stay["kind"];
  name: string;
  unit: string;
  address: string;
} {
  if (!stay || stay.kind === "none")
    return { kind: "none", name: "", unit: "", address: "" };
  if (stay.kind === "cruise")
    return {
      kind: "cruise",
      name: stay.vesselName ?? "",
      unit: stay.cabinNumber ?? "",
      address: "",
    };
  if (stay.kind === "hotel")
    return {
      kind: "hotel",
      name: stay.hotelName ?? "",
      unit: stay.roomNumber ?? "",
      address: "",
    };
  if (stay.kind === "private_accommodation")
    return {
      kind: "private_accommodation",
      name: stay.propertyName ?? "",
      unit: "",
      address: stay.address ?? "",
    };
  return { kind: "local", name: "", unit: "", address: stay.address ?? "" };
}

function buildStay(
  kind: Stay["kind"],
  name: string,
  unit: string,
  address: string,
): Stay {
  if (kind === "cruise")
    return { kind, vesselName: name.trim(), cabinNumber: unit.trim() };
  if (kind === "hotel")
    return { kind, hotelName: name.trim(), roomNumber: unit.trim() };
  if (kind === "private_accommodation")
    return {
      kind,
      propertyName: name.trim(),
      address: address.trim(),
    };
  if (kind === "local") return { kind, address: address.trim() };
  return { kind: "none" };
}

function readableStaySnapshot(stay?: Stay | null) {
  if (!stay || stay.kind === "none") return "Not provided";
  if (stay.kind === "cruise")
    return [stay.vesselName, stay.cabinNumber && `Cabin ${stay.cabinNumber}`]
      .filter(Boolean)
      .join(" · ");
  if (stay.kind === "hotel")
    return [stay.hotelName, stay.roomNumber && `Room ${stay.roomNumber}`]
      .filter(Boolean)
      .join(" · ");
  if (stay.kind === "private_accommodation")
    return [stay.propertyName, stay.address].filter(Boolean).join(" · ");
  return stay.address || "Local guest";
}

export function BoardingWaiverModal({
  booking,
  passenger,
  adultGuardians,
  mode = "sign",
  onClose,
  onSigned,
}: {
  booking: Manifest["bookings"][number];
  passenger: Passenger;
  adultGuardians: Passenger[];
  mode?: "sign" | "view";
  onClose: () => void;
  onSigned: () => void;
}) {
  const templates = useResource<WaiverTemplate[]>(
    mode === "sign" ? "ops/v1/waiver-templates" : null,
  );
  const evidence = useResource<
    {
      id: string;
      passenger_id: string | null;
      template_title: string | null;
      template_body: string | null;
      template_version: number;
      signer_name: string;
      signer_capacity: string;
      consent_text: string | null;
      signature_strokes: Point[] | null;
      stay_snapshot: Stay | null;
      guardian_passenger_name: string | null;
      captured_at: string | null;
      occurred_at: string;
    }[]
  >(mode === "view" ? `ops/v1/bookings/${booking.booking_id}/waivers` : null);
  const sign = useMutation();
  const seed = stayFromBooking(booking.stay);
  const [passengerName, setPassengerName] = useState(
    passenger.identity_pending ? "" : passenger.name,
  );
  const [signerName, setSignerName] = useState(
    passenger.is_minor ? "" : passenger.identity_pending ? "" : passenger.name,
  );
  const [guardianId, setGuardianId] = useState(
    adultGuardians[0]?.id ?? "",
  );
  const [stayKind, setStayKind] = useState<Stay["kind"]>(seed.kind);
  const [stayName, setStayName] = useState(seed.name);
  const [stayUnit, setStayUnit] = useState(seed.unit);
  const [stayAddress, setStayAddress] = useState(seed.address);
  const [consent, setConsent] = useState(false);
  const [strokes, setStrokes] = useState<Point[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const template = templates.data?.[0];
  const viewRow = evidence.data?.find(
    (row) => row.passenger_id === passenger.id,
  );
  const viewSignature = viewRow
    ? {
        templateTitle: viewRow.template_title ?? "Waiver",
        templateBody: viewRow.template_body ?? "",
        signerName: viewRow.signer_name,
        signerCapacity: viewRow.signer_capacity,
        consentText: viewRow.consent_text,
        signatureStrokes: viewRow.signature_strokes ?? [],
        staySnapshot: viewRow.stay_snapshot,
        guardianPassengerName: viewRow.guardian_passenger_name,
        capturedAt: viewRow.captured_at ?? viewRow.occurred_at,
        templateVersion: viewRow.template_version,
      }
    : null;
  const displayStrokes =
    mode === "view" ? (viewSignature?.signatureStrokes ?? []) : strokes;

  useEffect(() => {
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
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#172f35";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!displayStrokes.length) return;
    ctx.beginPath();
    displayStrokes.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [displayStrokes]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point | null {
    const target = event.currentTarget ?? canvasRef.current;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!template || !consent || strokes.length < 8) return;
    const stay = buildStay(stayKind, stayName, stayUnit, stayAddress);
    if (
      (stayKind === "cruise" ||
        stayKind === "hotel" ||
        stayKind === "private_accommodation") &&
      !stayName.trim()
    )
      return;
    if (stayKind === "private_accommodation" && !stayAddress.trim()) return;
    const result = await sign.run(
      `ops/v1/passengers/${passenger.id}/waiver`,
      {
        passengerName: passenger.identity_pending
          ? passengerName.trim()
          : undefined,
        signerName: signerName.trim(),
        guardianPassengerId: passenger.is_minor ? guardianId : undefined,
        consentAccepted: true as const,
        signatureStrokes: strokes,
        capturedAt: new Date().toISOString(),
        deviceCommandId: `web-${passenger.id}-${Date.now()}`,
        stay,
      },
    );
    if (result) onSigned();
  }

  const canSubmit =
    Boolean(template) &&
    consent &&
    strokes.length >= 8 &&
    signerName.trim().length > 1 &&
    (!passenger.identity_pending || passengerName.trim().length > 1) &&
    (!passenger.is_minor || Boolean(guardianId)) &&
    !(
      ["cruise", "hotel", "private_accommodation"].includes(stayKind) &&
      !stayName.trim()
    ) &&
    !(stayKind === "private_accommodation" && !stayAddress.trim());

  if (mode === "view") {
    return (
      <div className="boarding-waiver-root" role="presentation">
        <button
          type="button"
          className="boarding-waiver-scrim"
          aria-label="Close waiver"
          onClick={onClose}
        />
        <div
          className="boarding-waiver-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="boarding-waiver-title"
        >
          <header className="boarding-waiver-head">
            <div>
              <p className="eyebrow">SIGNED WAIVER</p>
              <h2 id="boarding-waiver-title">
                {passenger.identity_pending ? "Guest" : passenger.name}
              </h2>
              <p className="muted">
                {label(passenger.category)}
                {passenger.is_minor ? " · minor" : ""} ·{" "}
                {booking.booking_id.slice(0, 8).toUpperCase()}
              </p>
            </div>
            <button
              type="button"
              className="icon-button boarding-summary-close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </header>
          <div className="boarding-waiver-body">
            {evidence.error && <Notice error>{evidence.error}</Notice>}
            {evidence.data === null && !evidence.error ? (
              <p className="muted">Loading signed waiver…</p>
            ) : !viewSignature ? (
              <Notice error>No signed waiver is stored for this passenger.</Notice>
            ) : (
              <>
                <section className="boarding-waiver-block">
                  <h3>
                    {viewSignature.templateTitle} · v
                    {viewSignature.templateVersion}
                  </h3>
                  <div className="boarding-waiver-copy">
                    {viewSignature.templateBody}
                  </div>
                </section>
                <section className="boarding-waiver-block">
                  <h3>Signer & stay</h3>
                  <dl className="detail-grid compact">
                    <div>
                      <dt>Signer</dt>
                      <dd>
                        {viewSignature.signerName} ·{" "}
                        {label(viewSignature.signerCapacity)}
                      </dd>
                    </div>
                    {viewSignature.guardianPassengerName && (
                      <div>
                        <dt>Guardian</dt>
                        <dd>{viewSignature.guardianPassengerName}</dd>
                      </div>
                    )}
                    <div className="detail-wide">
                      <dt>Stay snapshot</dt>
                      <dd>
                        {readableStaySnapshot(viewSignature.staySnapshot)}
                      </dd>
                    </div>
                    <div>
                      <dt>Captured</dt>
                      <dd>{viewSignature.capturedAt}</dd>
                    </div>
                  </dl>
                </section>
                <section className="boarding-waiver-block">
                  <h3>Signature</h3>
                  <canvas
                    ref={canvasRef}
                    className="boarding-signature-pad is-readonly"
                    aria-label="Stored signature"
                  />
                  <p className="muted boarding-waiver-note">
                    Drawn from signature strokes stored with the booking. No PDF
                    copy is required to review this waiver.
                  </p>
                </section>
                <div className="boarding-waiver-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={onClose}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="boarding-waiver-root" role="presentation">
      <button
        type="button"
        className="boarding-waiver-scrim"
        aria-label="Close waiver"
        onClick={onClose}
      />
      <div
        className="boarding-waiver-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="boarding-waiver-title"
      >
        <header className="boarding-waiver-head">
          <div>
            <p className="eyebrow">ARRIVAL · WAIVER</p>
            <h2 id="boarding-waiver-title">
              {passenger.identity_pending
                ? "Collect name & waiver"
                : passenger.name}
            </h2>
            <p className="muted">
              {label(passenger.category)}
              {passenger.is_minor ? " · minor" : ""} ·{" "}
              {booking.booking_id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            className="icon-button boarding-summary-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <form className="boarding-waiver-body" onSubmit={(e) => void submit(e)}>
          {templates.error && <Notice error>{templates.error}</Notice>}
          {!templates.data ? (
            <p className="muted">Loading waiver template…</p>
          ) : !template ? (
            <Notice error>
              No active waiver template. Publish one in Tenant settings before
              boarding.
            </Notice>
          ) : (
            <>
              <section className="boarding-waiver-block">
                <h3>{template.title}</h3>
                <div className="boarding-waiver-copy">{template.body}</div>
              </section>
              <section className="boarding-waiver-block">
                <h3>Guest & stay</h3>
                <div className="form-grid">
                  {passenger.identity_pending && (
                    <Field label="Passenger full name">
                      <input
                        required
                        maxLength={120}
                        value={passengerName}
                        onChange={(e) => setPassengerName(e.target.value)}
                      />
                    </Field>
                  )}
                  <Field label="Signer name">
                    <input
                      required
                      maxLength={160}
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                    />
                  </Field>
                  {passenger.is_minor && (
                    <Field label="Guardian on this booking">
                      <select
                        required
                        value={guardianId}
                        onChange={(e) => setGuardianId(e.target.value)}
                      >
                        <option value="">Select adult</option>
                        {adultGuardians.map((adult) => (
                          <option key={adult.id} value={adult.id}>
                            {adult.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label="Stay type">
                    <select
                      value={stayKind}
                      onChange={(e) =>
                        setStayKind(e.target.value as Stay["kind"])
                      }
                    >
                      <option value="none">Not provided</option>
                      <option value="cruise">Cruise vessel</option>
                      <option value="hotel">Hotel / resort</option>
                      <option value="private_accommodation">
                        Airbnb / private
                      </option>
                      <option value="local">Local guest</option>
                    </select>
                  </Field>
                  {["cruise", "hotel", "private_accommodation"].includes(
                    stayKind,
                  ) && (
                    <Field
                      label={
                        stayKind === "cruise"
                          ? "Vessel name"
                          : stayKind === "hotel"
                            ? "Hotel name"
                            : "Property name"
                      }
                    >
                      <input
                        required
                        maxLength={160}
                        value={stayName}
                        onChange={(e) => setStayName(e.target.value)}
                      />
                    </Field>
                  )}
                  {(stayKind === "cruise" || stayKind === "hotel") && (
                    <Field
                      label={
                        stayKind === "cruise" ? "Cabin number" : "Room number"
                      }
                    >
                      <input
                        maxLength={40}
                        value={stayUnit}
                        onChange={(e) => setStayUnit(e.target.value)}
                      />
                    </Field>
                  )}
                  {(stayKind === "private_accommodation" ||
                    stayKind === "local") && (
                    <Field
                      label={
                        stayKind === "local"
                          ? "Locality (optional)"
                          : "Address"
                      }
                    >
                      <input
                        required={stayKind === "private_accommodation"}
                        maxLength={300}
                        value={stayAddress}
                        onChange={(e) => setStayAddress(e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              </section>
              <section className="boarding-waiver-block">
                <h3>Signature</h3>
                <canvas
                  ref={canvasRef}
                  className="boarding-signature-pad"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const point = pointFromEvent(event);
                    if (!point) return;
                    drawingRef.current = true;
                    setStrokes([point]);
                  }}
                  onPointerMove={(event) => {
                    if (!drawingRef.current) return;
                    event.preventDefault();
                    const point = pointFromEvent(event);
                    if (!point) return;
                    setStrokes((current) => [...current, point]);
                  }}
                  onPointerUp={() => {
                    drawingRef.current = false;
                  }}
                  onPointerCancel={() => {
                    drawingRef.current = false;
                  }}
                />
                <div className="boarding-signature-actions">
                  <label className="boarding-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span>I have read and agree to this waiver</span>
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setStrokes([])}
                  >
                    Clear signature
                  </button>
                </div>
              </section>
              <p className="muted boarding-waiver-note">
                Signature strokes and stay details are stored with the booking
                and can be reviewed any time from this screen.
              </p>
              {sign.error && <Notice error>{sign.error}</Notice>}
              <div className="boarding-waiver-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={onClose}
                >
                  Later
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={!canSubmit || sign.busy}
                >
                  {sign.busy ? "Saving…" : "Save signed waiver"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
