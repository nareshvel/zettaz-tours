"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine, ShieldCheck, Users, X } from "lucide-react";
import { label, useMutation } from "@/lib/client";
import { Notice } from "./common";

type ScanHit = {
  passengerId: string;
  name: string;
  category: string;
};

type Assignments = {
  readiness: "unassigned" | "ready" | "blocked";
  items: {
    id: string;
    assignment_role: string;
    resource_name: string | null;
    crew_name: string | null;
  }[];
  expiredDocuments: {
    id: string;
    document_type: string;
    expires_on: string;
  }[];
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function barcodeDetectorAvailable() {
  return (
    typeof window !== "undefined" &&
    typeof (window as Window & { BarcodeDetector?: unknown })
      .BarcodeDetector === "function"
  );
}

export function BoardingGateToolbar({
  canCheckin,
  assignments,
  search,
  onSearchChange,
  onScanArrived,
}: {
  canCheckin: boolean;
  assignments: Assignments | null;
  search: string;
  onSearchChange: (value: string) => void;
  onScanArrived: (hit: ScanHit) => void;
}) {
  const [crewOpen, setCrewOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanToken, setScanToken] = useState("");
  const [scanHit, setScanHit] = useState<ScanHit | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const resolve = useMutation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const handledRef = useRef(false);

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!scanOpen) {
      stopCamera();
      handledRef.current = false;
      return;
    }
    if (!barcodeDetectorAvailable()) return;

    let cancelled = false;
    async function start() {
      setCameraError("");
      handledRef.current = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setCameraActive(true);

        const Detector = (
          window as unknown as {
            BarcodeDetector: new (opts: {
              formats: string[];
            }) => BarcodeDetectorLike;
          }
        ).BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code"] });

        const tick = async () => {
          if (cancelled || handledRef.current || !videoRef.current) return;
          try {
            if (videoRef.current.readyState >= 2) {
              const codes = await detector.detect(videoRef.current);
              const value = codes[0]?.rawValue?.trim();
              if (value) {
                handledRef.current = true;
                setScanToken(value);
                await resolveToken(value);
                stopCamera();
                return;
              }
            }
          } catch {
            /* keep scanning */
          }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        rafRef.current = requestAnimationFrame(() => void tick());
      } catch {
        if (!cancelled) {
          setCameraError(
            "Camera unavailable. Paste a check-in code below, or use the crew app scanner.",
          );
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [scanOpen]);

  async function resolveToken(token: string) {
    const value = token.trim();
    if (!value) return;
    const result = await resolve.run<ScanHit>(
      "staff/v1/crew/checkin-token/resolve",
      { token: value },
    );
    if (result) setScanHit(result);
  }

  return (
    <>
      <div className="boarding-gate-toolbar no-print">
        <label className="boarding-gate-search field">
          <span className="sr-only">Search guests</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search name or booking ref"
            autoComplete="off"
          />
        </label>
        <div className="boarding-gate-actions doc-actions">
          {canCheckin && (
            <button
              type="button"
              className="button secondary"
              aria-label="Scan check-in code"
              title="Scan"
              onClick={() => {
                setScanHit(null);
                setScanToken("");
                setCameraError("");
                resolve.clear();
                setScanOpen(true);
              }}
            >
              <ScanLine size={17} aria-hidden="true" />
              <span className="button-label">Scan</span>
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            aria-label="Crew readiness"
            title="Crew"
            onClick={() => setCrewOpen(true)}
          >
            <Users size={17} aria-hidden="true" />
            <span className="button-label">Crew</span>
            {assignments && (
              <span className={`status ${assignments.readiness}`}>
                {assignments.readiness}
              </span>
            )}
          </button>
        </div>
      </div>

      {crewOpen && (
        <div className="boarding-sheet-root" role="presentation">
          <button
            type="button"
            className="boarding-sheet-scrim"
            aria-label="Close crew readiness"
            onClick={() => setCrewOpen(false)}
          />
          <div
            className="boarding-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="boarding-crew-title"
          >
            <header className="boarding-sheet-head">
              <div>
                <p className="eyebrow">READINESS</p>
                <h2 id="boarding-crew-title">Crew & resources</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setCrewOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="boarding-sheet-body">
              {assignments ? (
                <>
                  <div className="boarding-crew-status">
                    <ShieldCheck size={18} />
                    <span className={`status ${assignments.readiness}`}>
                      {assignments.readiness}
                    </span>
                  </div>
                  {assignments.expiredDocuments.length ? (
                    <Notice error>
                      Blocked by expired documents:{" "}
                      {assignments.expiredDocuments
                        .map((item) => item.document_type)
                        .join(", ")}
                      .
                    </Notice>
                  ) : null}
                  {assignments.items.length ? (
                    <ul className="boarding-ops-list">
                      {assignments.items.map((item) => (
                        <li key={item.id}>
                          <strong>{label(item.assignment_role)}</strong>
                          <span>{item.resource_name ?? item.crew_name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      No crew or resources assigned yet. Assign under Catalog →
                      Assignments, Fleet, or Staff.
                    </p>
                  )}
                </>
              ) : (
                <p className="muted">Loading readiness…</p>
              )}
            </div>
          </div>
        </div>
      )}

      {scanOpen && (
        <div className="boarding-sheet-root" role="presentation">
          <button
            type="button"
            className="boarding-sheet-scrim"
            aria-label="Close scanner"
            onClick={() => {
              setScanOpen(false);
              stopCamera();
            }}
          />
          <div
            className="boarding-sheet boarding-scan-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="boarding-scan-title"
          >
            <header className="boarding-sheet-head">
              <div>
                <p className="eyebrow">CHECK-IN</p>
                <h2 id="boarding-scan-title">Scan or paste code</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setScanOpen(false);
                  stopCamera();
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="boarding-sheet-body">
              <div className="boarding-scan-camera">
                <video
                  ref={videoRef}
                  className={
                    "boarding-scan-video" + (cameraActive ? " is-live" : "")
                  }
                  playsInline
                  muted
                />
                {!cameraActive && (
                  <div className="boarding-scan-camera-fallback">
                    <ScanLine size={28} />
                    <p>
                      {barcodeDetectorAvailable()
                        ? "Starting camera…"
                        : "This browser cannot decode QR from the camera. Paste a code below, or use the crew mobile app."}
                    </p>
                  </div>
                )}
              </div>
              {cameraError && <Notice error>{cameraError}</Notice>}
              <form
                className="boarding-scan-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void resolveToken(scanToken);
                }}
              >
                <input
                  aria-label="Check-in token"
                  value={scanToken}
                  onChange={(event) => setScanToken(event.target.value)}
                  placeholder="Paste check-in code"
                  autoComplete="off"
                />
                <button
                  className="button"
                  disabled={resolve.busy || !scanToken.trim()}
                >
                  Find
                </button>
              </form>
              {resolve.error && <Notice error>{resolve.error}</Notice>}
              {scanHit && (
                <div className="boarding-scan-hit">
                  <div>
                    <strong>{scanHit.name}</strong>
                    <small>{label(scanHit.category)}</small>
                  </div>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      onScanArrived(scanHit);
                      setScanOpen(false);
                      stopCamera();
                      setScanHit(null);
                      setScanToken("");
                    }}
                  >
                    Arrived
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
