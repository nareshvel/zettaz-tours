"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Check,
  ArrowRight,
  ShieldCheck,
  Building2,
  Globe2,
  Landmark,
  Printer,
  CreditCard,
  Plug,
  FileText,
  Ship,
  Hotel,
} from "lucide-react";
import type { Session, Product, Member } from "@/lib/types";
import {
  label,
  minor,
  money,
  useMutation,
  usePaged,
  useResource,
} from "@/lib/client";
import {
  Back,
  Empty,
  Field,
  Heading,
  Loading,
  More,
  Notice,
  SearchBox,
  Status,
  Toggle,
} from "./common";
import { Integrations } from "./integrations";

export function Catalog({ session }: { session: Session }) {
  const products = useResource<Product[]>("admin/v1/products"),
    [search, setSearch] = useState("");
  return (
    <>
      <Heading
        title="Catalog"
        description="Shared tours, passenger categories and seasonal rates."
        action={
          session.permissions.includes("catalog.write") && (
            <Link href="/catalog/new" className="button">
              <Plus size={17} />
              Add tour
            </Link>
          )
        }
      />
      {products.error ? (
        <Notice error>{products.error}</Notice>
      ) : !products.data ? (
        <Loading />
      ) : (
        <>
          <div className="catalog-toolbar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Find a tour"
            />
            <span className="muted">
              {products.data.length} tours ·{" "}
              {session.tenant.config.bookingCurrency}
            </span>
          </div>
          <div className="catalog-grid">
            {products.data
              .filter((p) =>
                p.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((p) => (
                <article className="panel catalog-card" key={p.id}>
                  <div className="tour-type">
                    <span className="tour-mark">
                      {p.name.replace("Mock ", "").slice(0, 1)}
                    </span>
                    <span>SHARED TOUR</span>
                  </div>
                  <h2>{p.name}</h2>
                  <p>
                    {p.definition.optionName} · {p.definition.durationMinutes}{" "}
                    minutes
                  </p>
                  <div className="rate-list">
                    {p.definition.rates.map((r, i) => (
                      <div key={i}>
                        <span>
                          <strong>
                            {p.definition.categories.find(
                              (c) => c.slug === r.category,
                            )?.label ?? label(r.category)}
                          </strong>
                          <small>
                            {r.startDate} — {r.endDate}
                          </small>
                        </span>
                        <strong>
                          {money(
                            r.amountMinor,
                            session.tenant.config.bookingCurrency,
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                  {session.permissions.includes("catalog.write") && (
                    <Link
                      className="text-link"
                      href={"/departures/new?product=" + p.id}
                    >
                      Schedule departures <ArrowRight size={16} />
                    </Link>
                  )}
                </article>
              ))}
          </div>
          {!products.data.length && (
            <Empty title="Your catalog is empty">
              <Link href="/catalog/new">Add your first tour</Link>
            </Empty>
          )}
          {products.data.length === 100 && (
            <Notice>This first catalog view shows up to 100 products.</Notice>
          )}
        </>
      )}
    </>
  );
}
const isoDay = () => new Date().toISOString().slice(0, 10);
export function NewProduct({ session }: { session: Session }) {
  const [name, setName] = useState(""),
    [option, setOption] = useState(""),
    [duration, setDuration] = useState("120"),
    [error, setError] = useState("");
  const [categories, setCategories] = useState([
    { slug: "", label: "", countsTowardCapacity: true, amount: "" },
  ]);
  const [start, setStart] = useState(isoDay),
    [end, setEnd] = useState("");
  const mutation = useMutation(),
    router = useRouter();
  function category(
    index: number,
    update: Partial<(typeof categories)[number]>,
  ) {
    setCategories((v) =>
      v.map((c, i) => (i === index ? { ...c, ...update } : c)),
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await mutation.run("admin/v1/products", {
        name,
        optionName: option,
        durationMinutes: Number(duration),
        categories: categories.map(({ amount, ...c }) => c),
        rates: categories.map((c) => ({
          category: c.slug,
          startDate: start,
          endDate: end,
          amountMinor: minor(c.amount, session.tenant.config.bookingCurrency),
        })),
      });
      if (result) router.push("/catalog");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Back href="/catalog">Catalog</Back>
      <Heading
        title="Add a shared tour"
        description="Define a tour option and its initial seasonal rates."
      />
      <form onSubmit={submit} className="panel form-panel wide-form">
        <h2>Tour details</h2>
        <div className="form-grid">
          <Field label="Tour name">
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Option name">
            <input
              required
              maxLength={120}
              value={option}
              onChange={(e) => setOption(e.target.value)}
              placeholder="For example, morning departure"
            />
          </Field>
          <Field label="Duration · minutes">
            <input
              type="number"
              min="1"
              max="1440"
              required
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
        </div>
        <div className="form-divider" />
        <h2>Seasonal rate period</h2>
        <div className="form-grid">
          <Field label="Start date">
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </Field>
        </div>
        <div className="panel-heading plain">
          <h2>Passenger categories</h2>
          <button
            type="button"
            className="text-link"
            disabled={categories.length >= 10}
            onClick={() =>
              setCategories([
                ...categories,
                { slug: "", label: "", countsTowardCapacity: true, amount: "" },
              ])
            }
          >
            <Plus size={16} />
            Add category
          </button>
        </div>
        {categories.map((c, i) => (
          <div className="category-editor" key={i}>
            <div className="form-grid three">
              <Field label="Category label">
                <input
                  required
                  value={c.label}
                  onChange={(e) =>
                    category(i, {
                      label: e.target.value,
                      slug: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "_")
                        .replace(/^_|_$/g, ""),
                    })
                  }
                />
              </Field>
              <Field
                label="Category code"
                hint="Lowercase letters, numbers, underscores."
              >
                <input
                  required
                  pattern="[a-z][a-z0-9_\-]{1,49}"
                  value={c.slug}
                  onChange={(e) => category(i, { slug: e.target.value })}
                />
              </Field>
              <Field label={"Rate · " + session.tenant.config.bookingCurrency}>
                <input
                  required
                  inputMode="decimal"
                  value={c.amount}
                  onChange={(e) => category(i, { amount: e.target.value })}
                />
              </Field>
            </div>
            <div className="category-footer">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={c.countsTowardCapacity}
                  onChange={(e) =>
                    category(i, { countsTowardCapacity: e.target.checked })
                  }
                />
                Counts toward seat capacity
              </label>
              {categories.length > 1 && (
                <button
                  type="button"
                  className="icon-link danger"
                  aria-label={"Remove category " + (i + 1)}
                  onClick={() =>
                    setCategories((v) => v.filter((_, n) => n !== i))
                  }
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
        {(error || mutation.error) && (
          <Notice error>{error || mutation.error}</Notice>
        )}
        <div className="form-actions">
          <Link href="/catalog" className="button secondary">
            Cancel
          </Link>
          <button className="button" disabled={mutation.busy}>
            {mutation.busy ? "Saving…" : "Create tour"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </>
  );
}
export function NewSchedule({ session }: { session: Session }) {
  const products = useResource<Product[]>("admin/v1/products"),
    mutation = useMutation(),
    router = useRouter();
  const [product, setProduct] = useState(""),
    [start, setStart] = useState(isoDay),
    [end, setEnd] = useState(isoDay),
    [time, setTime] = useState("09:00"),
    [capacity, setCapacity] = useState(""),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6, 7]),
    [blackouts, setBlackouts] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await mutation.run("admin/v1/schedules", {
      productId: product,
      startDate: start,
      endDate: end,
      localTime: time,
      capacity: Number(capacity),
      weekdays,
      blackoutDates: blackouts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (result) router.push("/departures");
  }
  useEffect(() => {
    setProduct(
      new URLSearchParams(window.location.search).get("product") ?? "",
    );
  }, []);
  return (
    <>
      <Back href="/departures">Departures</Back>
      <Heading
        title="Create recurring departures"
        description={"Departure times use " + session.tenant.timezone + "."}
      />
      <form className="panel form-panel wide-form" onSubmit={submit}>
        {products.error && <Notice error>{products.error}</Notice>}
        <Field label="Tour option">
          <select
            required
            value={product}
            onChange={(e) => setProduct(e.target.value)}
          >
            <option value="">Choose a tour</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.definition.optionName}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Start date">
            <input
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              min={start}
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
          <Field label="Local departure time">
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Seat capacity">
            <input
              type="number"
              required
              min="1"
              max="10000"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </Field>
        </div>
        <fieldset className="weekdays">
          <legend>Operating days</legend>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
            <label
              key={d}
              className={weekdays.includes(i + 1) ? "selected" : ""}
            >
              <input
                type="checkbox"
                checked={weekdays.includes(i + 1)}
                onChange={(e) =>
                  setWeekdays((v) =>
                    e.target.checked
                      ? [...v, i + 1]
                      : v.filter((n) => n !== i + 1),
                  )
                }
              />
              {d}
            </label>
          ))}
        </fieldset>
        <Field
          label="Blackout dates"
          hint="Optional dates separated by commas, for example 2026-12-25, 2027-01-01."
        >
          <input
            value={blackouts}
            onChange={(e) => setBlackouts(e.target.value)}
          />
        </Field>
        {mutation.error && <Notice error>{mutation.error}</Notice>}
        <div className="form-actions">
          <Link className="button secondary" href="/departures">
            Cancel
          </Link>
          <button
            className="button"
            disabled={mutation.busy || !weekdays.length}
          >
            {mutation.busy ? "Creating…" : "Create departures"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </>
  );
}
export function Settings({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => Promise<void>;
}) {
  const [config, setConfig] = useState(session.tenant.config),
    [methods, setMethods] = useState(config.manualPaymentMethods.join(", ")),
    [sources, setSources] = useState(config.bookingSources.join(", ")),
    [logoError, setLogoError] = useState(""),
    [logoBusy, setLogoBusy] = useState(false),
    [logoUnavailable, setLogoUnavailable] = useState(false),
    [tab, setTab] = useState("general"),
    [profile, setProfile] = useState(
      session.tenant.business_profile ?? {
        displayName: session.tenant.name,
        streetAddress: "",
        suite: "",
        city: "",
        stateParish: "",
        postalCode: "",
        country: "US",
        email: "",
        phone: "",
      },
    ),
    [authorizedContact, setAuthorizedContact] = useState(
      session.tenant.authorized_contact ?? { name: "", email: "", phone: "" },
    ),
    [waiverTitle, setWaiverTitle] = useState(""),
    [waiverBody, setWaiverBody] = useState(""),
    [vesselName, setVesselName] = useState(""),
    [callDate, setCallDate] = useState(""),
    [portName, setPortName] = useState(""),
    [allAboardAt, setAllAboardAt] = useState(""),
    [accommodationName, setAccommodationName] = useState(""),
    [accommodationAddress, setAccommodationAddress] = useState(""),
    [printName, setPrintName] = useState(""),
    [printDocumentType, setPrintDocumentType] = useState<
      "manifest" | "pickup_list"
    >("manifest");
  const mutation = useMutation(),
    profileMutation = useMutation(),
    waiverMutation = useMutation(),
    waiverTemplates = useResource<
      {
        id: string;
        version: number;
        title: string;
        body: string;
        active: boolean;
        created_at: string;
      }[]
    >("ops/v1/waiver-templates"),
    stayMutation = useMutation(),
    stayOptions = useResource<{cruiseCalls:{id:string;vessel_name:string;call_date:string;port_name:string;all_aboard_at:string|null}[];accommodations:{id:string;name:string;address:string}[]}>("ops/v1/stays/options"),
    printMutation = useMutation(),
    printTemplates = useResource<
      {
        id: string;
        template_key: string;
        version: number;
        document_type: string;
        name: string;
        is_default: boolean;
        created_at: string;
      }[]
    >("ops/v1/print-templates"),
    printJobs = useResource<
      {
        id: string;
        document_type: string;
        status: string;
        destination_type: string;
        requested_at: string;
      }[]
    >("ops/v1/print-jobs");
  useEffect(() => {
    setLogoUnavailable(false);
  }, [session.tenant.logo_path]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await mutation.run(
      "admin/v1/tenant/config",
      {
        version: session.tenant.version,
        config: {
          ...config,
          manualPaymentMethods: methods
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          bookingSources: sources
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      },
      "PATCH",
    );
    if (result) await refresh();
  }
  async function uploadLogo(file?: File) {
    if (!file) return;
    setLogoBusy(true);
    setLogoError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/gateway/admin/v1/tenant/logo", {
        method: "POST",
        headers: {
          "X-Tenant-Id": session.tenant.id,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: form,
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).message ?? "Logo upload failed",
        );
      await refresh();
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }
  async function saveProfile() {
    const result = await profileMutation.run(
      "admin/v1/tenant/profile",
      { businessProfile: profile, authorizedContact },
      "PATCH",
    );
    if (result) await refresh();
  }
  async function publishWaiverTemplate() {
    const result = await waiverMutation.run("ops/v1/waiver-templates", {
      title: waiverTitle,
      body: waiverBody,
    });
    if (result) {
      setWaiverTitle("");
      setWaiverBody("");
      waiverTemplates.reload();
    }
  }
  async function publishPrintTemplate() {
    const result = await printMutation.run("ops/v1/print-templates", {
      documentType: printDocumentType,
      name: printName,
      outputProfile: { paper: "A4", orientation: "portrait" },
      payload: { includeTenantLogo: true },
      isDefault: true,
    });
    if (result) {
      setPrintName("");
      printTemplates.reload();
    }
  }
  async function createCruiseCall() {
    const result=await stayMutation.run("ops/v1/stays/cruise-calls",{vesselName,callDate,portName,...(allAboardAt?{allAboardAt}:{}),tenderRequired:false});
    if(result){setVesselName("");setCallDate("");setPortName("");setAllAboardAt("");stayOptions.reload();}
  }
  async function createAccommodation() {
    const result=await stayMutation.run("ops/v1/stays/accommodations",{name:accommodationName,address:accommodationAddress});
    if(result){setAccommodationName("");setAccommodationAddress("");stayOptions.reload();}
  }
  return (
    <>
      <Heading
        title="Tenant settings"
        description="Policies apply to new holds. Existing quotes and confirmed prices stay fixed."
      />
      <div className="settings-layout">
        <aside className="panel settings-summary">
          <div className="settings-tenant-header">
            {session.tenant.logo_path && !logoUnavailable ? (
              <img
                className="tenant-logo-preview"
                src={session.tenant.logo_path}
                alt={`${session.tenant.name} logo`}
                onError={() => setLogoUnavailable(true)}
              />
            ) : (
              <span className="tenant-monogram">
                {session.tenant.name.replace("Mock ", "").slice(0, 1)}
              </span>
            )}
            <h2>{session.tenant.name}</h2>
          </div>
          <nav className="settings-nav" aria-label="Tenant settings sections">
            <p>PROFILE</p>
            <button
              className={tab === "general" ? "active" : ""}
              type="button"
              onClick={() => setTab("general")}
            >
              <Building2 size={16} /> General & branding
            </button>
            <button
              className={tab === "localization" ? "active" : ""}
              type="button"
              onClick={() => setTab("localization")}
            >
              <Globe2 size={16} /> Localization
            </button>
            <p>OPERATIONS</p>
            <button
              className={tab === "commercial" ? "active" : ""}
              type="button"
              onClick={() => setTab("commercial")}
            >
              <Landmark size={16} /> Taxes & commercial
            </button>
            <button
              className={tab === "printers" ? "active" : ""}
              type="button"
              onClick={() => setTab("printers")}
            >
              <Printer size={16} /> Printers & documents
            </button>
            <button className={tab === "stays" ? "active" : ""} type="button" onClick={() => setTab("stays")}>
              <Ship size={16} /> Guest stays & cruise calls
            </button>
            <p>PLATFORM</p>
            <button
              className={tab === "payments" ? "active" : ""}
              type="button"
              onClick={() => setTab("payments")}
            >
              <CreditCard size={16} /> Payments
            </button>
            <button
              className={tab === "waivers" ? "active" : ""}
              type="button"
              onClick={() => setTab("waivers")}
            >
              <FileText size={16} /> Waivers
            </button>
            {session.permissions.includes("integration.manage") && <button
                className={tab === "integrations" ? "active" : ""}
                type="button"
                onClick={() => setTab("integrations")}
              >
                <Plug size={16} /> Integrations
              </button>}
            <button
              className={tab === "security" ? "active" : ""}
              type="button"
              onClick={() => setTab("security")}
            >
              <ShieldCheck size={16} /> Security
            </button>
          </nav>
        </aside>
        {tab === "integrations" ? <div className="settings-tab-content"><Integrations embedded /></div> : <form className="panel form-panel" onSubmit={submit}>
          {tab === "general" && (
            <section>
              <div className="settings-card-head" id="branding">
                <Building2 size={20} />
                <div>
                  <h2>Company identity</h2>
                  <p>
                    Logo and core business details used across the workspace and
                    operational documents.
                  </p>
                </div>
              </div>
              <div className="identity-layout">
                <div className="logo-control">
                  <label className="logo-dropzone" htmlFor="tenant-logo">
                    {session.tenant.logo_path && !logoUnavailable ? (
                      <img
                        className="uploaded-tenant-logo"
                        src={session.tenant.logo_path}
                        alt="Tenant logo"
                        onError={() => setLogoUnavailable(true)}
                      />
                    ) : (
                      <span className="logo-monogram">
                        {profile.displayName.slice(0, 1).toUpperCase() || "T"}
                      </span>
                    )}
                    {(!session.tenant.logo_path || logoUnavailable) && (
                      <span>Click to upload logo</span>
                    )}
                  </label>
                  <input
                    id="tenant-logo"
                    className="visually-hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/svg+xml"
                    disabled={logoBusy}
                    onChange={(e) => void uploadLogo(e.target.files?.[0])}
                  />
                  <small>JPG, PNG, WebP or SVG · maximum 2 MB</small>
                </div>
                <div className="identity-fields">
                  <Field label="Business name">
                    <input
                      required
                      value={profile.displayName}
                      onChange={(e) =>
                        setProfile({ ...profile, displayName: e.target.value })
                      }
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Business email">
                      <input
                        required
                        type="email"
                        value={profile.email}
                        onChange={(e) =>
                          setProfile({ ...profile, email: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Business phone">
                      <input
                        value={profile.phone}
                        onChange={(e) =>
                          setProfile({ ...profile, phone: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                </div>
              </div>
              {logoError && <Notice error>{logoError}</Notice>}
              <div className="form-divider" />
              <div className="settings-card-head compact-card-head">
                <Globe2 size={20} />
                <div>
                  <h2>Business address</h2>
                  <p>Used for operational and statutory correspondence.</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="Street address">
                  <input
                    value={profile.streetAddress}
                    onChange={(e) =>
                      setProfile({ ...profile, streetAddress: e.target.value })
                    }
                  />
                </Field>
                <Field label="Apt / suite">
                  <input
                    value={profile.suite}
                    onChange={(e) =>
                      setProfile({ ...profile, suite: e.target.value })
                    }
                  />
                </Field>
                <Field label="City">
                  <input
                    value={profile.city}
                    onChange={(e) =>
                      setProfile({ ...profile, city: e.target.value })
                    }
                  />
                </Field>
                <Field label="State / parish">
                  <input
                    value={profile.stateParish}
                    onChange={(e) =>
                      setProfile({ ...profile, stateParish: e.target.value })
                    }
                  />
                </Field>
                <Field label="Postal code">
                  <input
                    value={profile.postalCode}
                    onChange={(e) =>
                      setProfile({ ...profile, postalCode: e.target.value })
                    }
                  />
                </Field>
                <Field label="Country">
                  <input
                    required
                    maxLength={2}
                    value={profile.country}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        country: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </Field>
              </div>
              <h2>Authorized contact</h2>
              <p className="policy-copy">
                This contact will receive future verification requests for
                critical account changes.
              </p>
              <div className="form-grid">
                <Field label="Name">
                  <input
                    required
                    value={authorizedContact.name}
                    onChange={(e) =>
                      setAuthorizedContact({
                        ...authorizedContact,
                        name: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Email">
                  <input
                    required
                    type="email"
                    value={authorizedContact.email}
                    onChange={(e) =>
                      setAuthorizedContact({
                        ...authorizedContact,
                        email: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Phone">
                  <input
                    value={authorizedContact.phone}
                    onChange={(e) =>
                      setAuthorizedContact({
                        ...authorizedContact,
                        phone: e.target.value,
                      })
                    }
                  />
                </Field>
              </div>
              {profileMutation.error && (
                <Notice error>{profileMutation.error}</Notice>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="button"
                  disabled={profileMutation.busy}
                  onClick={() => void saveProfile()}
                >
                  {profileMutation.busy ? "Saving…" : "Save general profile"}
                  <Check size={17} />
                </button>
              </div>
              <div className="form-divider" />
            </section>
          )}
          {tab === "commercial" && (
            <section>
              <div className="settings-card-head" id="commercial">
                <Landmark size={20} />
                <div>
                  <h2>Booking, taxes & commercial policy</h2>
                  <p>
                    Controls for new holds and bookings. Existing snapshots
                    remain fixed.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <Field
                  label="Hold duration · seconds"
                  hint="Between 30 and 1,800 seconds."
                >
                  <input
                    type="number"
                    min="30"
                    max="1800"
                    required
                    value={config.holdSeconds}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        holdSeconds: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Minimum payment to confirm · %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={config.minimumPaidPercent}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        minimumPaidPercent: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Tax / fee rate · %"
                  hint="Applied once to the subtotal of new holds. Finance approval is required before live use."
                >
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    value={config.taxBasisPoints / 100}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        taxBasisPoints: Math.round(
                          Number(e.target.value) * 100,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
              <Toggle
                label="Allow confirmation before pickup is arranged"
                description="Unresolved pickup still appears on the booking."
                checked={config.allowUnresolvedPickup}
                onChange={(checked) =>
                  setConfig({ ...config, allowUnresolvedPickup: checked })
                }
              />
              <div className="form-divider" />
            </section>
          )}
          {tab === "localization" && (
            <section>
              <div className="settings-card-head" id="localization">
                <Globe2 size={20} />
                <div>
                  <h2>Localization</h2>
                  <p>
                    Regional display and data-entry defaults for this tenant.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="Display language">
                  <select
                    value={config.locale}
                    onChange={(e) =>
                      setConfig({ ...config, locale: e.target.value })
                    }
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                  </select>
                </Field>
                <Field label="Date format">
                  <select
                    value={config.dateFormat}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        dateFormat: e.target.value as typeof config.dateFormat,
                      })
                    }
                  >
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </Field>
                <Field label="Time format">
                  <select
                    value={config.timeFormat}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        timeFormat: e.target.value as typeof config.timeFormat,
                      })
                    }
                  >
                    <option value="12h">12-hour</option>
                    <option value="24h">24-hour</option>
                  </select>
                </Field>
                <Field label="Week starts on">
                  <select
                    value={config.weekStartsOn}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        weekStartsOn: Number(e.target.value),
                      })
                    }
                  >
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                  </select>
                </Field>
                <Field label="Measurement system">
                  <select
                    value={config.measurementSystem}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        measurementSystem: e.target
                          .value as typeof config.measurementSystem,
                      })
                    }
                  >
                    <option value="metric">Metric</option>
                    <option value="imperial">Imperial</option>
                  </select>
                </Field>
              </div>
              <div className="form-divider" />
              <h2>Currency & tax context</h2>
              <div className="form-grid">
                <Field label="Booking currency">
                  <input value={config.bookingCurrency} disabled />
                </Field>
                <Field label="Collection currency">
                  <input value={config.collectionCurrency} disabled />
                </Field>
                <Field label="Reporting currency">
                  <input value={config.reportingCurrency} disabled />
                </Field>
              </div>
              <p className="policy-copy">
                Currency conversion and settlement reconciliation are not
                enabled yet. Configure currencies through the approved finance
                migration workflow.
              </p>
              <div className="form-divider" />
            </section>
          )}
          {tab === "printers" && (
            <section>
              <div className="settings-card-head">
                <Printer size={20} />
                <div>
                  <h2>Printers & documents</h2>
                  <p>
                    Produce paper-safe operational documents from the current
                    departure data.
                  </p>
                </div>
              </div>
              <div className="document-access-grid">
                <article>
                  <FileText size={19} />
                  <div>
                    <h3>Departure manifest</h3>
                    <p>
                      Open a departure, then print its confirmed passenger
                      manifest or save it as a PDF.
                    </p>
                    <Link className="text-link" href="/departures">
                      Open departures <ArrowRight size={16} />
                    </Link>
                  </div>
                </article>
                <article>
                  <Printer size={19} />
                  <div>
                    <h3>Pickup list</h3>
                    <p>
                      Open the operations board, save the pickup plan, then
                      print its ordered stops and exceptions.
                    </p>
                    <Link className="text-link" href="/operations">
                      Open operations <ArrowRight size={16} />
                    </Link>
                  </div>
                </article>
              </div>
              <p className="policy-copy">
                Browser print and Save as PDF are the current delivery method.
                Browser jobs are recorded for audit; a printer agent and
                physical destinations are not enabled yet.
              </p>
              {session.permissions.includes("print.templates.manage") && (
                <>
                  <div className="form-divider" />
                  <h2>Document templates</h2>
                  <p className="policy-copy">
                    Publishing creates a new tenant-owned template version. The
                    selected layout becomes the default for its document type.
                  </p>
                  <div className="form-grid compact">
                    <Field label="Document type">
                      <select
                        value={printDocumentType}
                        onChange={(event) =>
                          setPrintDocumentType(
                            event.target.value as "manifest" | "pickup_list",
                          )
                        }
                      >
                        <option value="manifest">Departure manifest</option>
                        <option value="pickup_list">Pickup list</option>
                      </select>
                    </Field>
                    <Field label="Template name">
                      <input
                        value={printName}
                        maxLength={120}
                        placeholder="Standard departure manifest"
                        onChange={(event) => setPrintName(event.target.value)}
                      />
                    </Field>
                  </div>
                  {printMutation.error && (
                    <Notice error>{printMutation.error}</Notice>
                  )}
                  <div className="form-actions">
                    <button
                      className="button"
                      type="button"
                      disabled={printMutation.busy || !printName.trim()}
                      onClick={() => void publishPrintTemplate()}
                    >
                      {printMutation.busy ? "Publishing…" : "Publish template"}
                    </button>
                  </div>
                </>
              )}
              {printTemplates.error ? (
                <Notice error>{printTemplates.error}</Notice>
              ) : printTemplates.data?.length ? (
                <div className="settings-list">
                  {printTemplates.data.map((template) => (
                    <article key={template.id}>
                      <div>
                        <strong>{template.name}</strong>
                        <p>
                          {label(template.document_type)} · version{" "}
                          {template.version}
                        </p>
                      </div>
                      {template.is_default && <Status state="confirmed" />}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No published document templates yet.</p>
              )}
              {printJobs.data?.length ? (
                <>
                  <div className="form-divider" />
                  <h2>Recent document requests</h2>
                  <div className="settings-list">
                    {printJobs.data.slice(0, 5).map((job) => (
                      <article key={job.id}>
                        <div>
                          <strong>{label(job.document_type)}</strong>
                          <p>{new Date(job.requested_at).toLocaleString()}</p>
                        </div>
                        <Status state={job.status} />
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          )}
          {tab === "stays" && <section>
            <div className="settings-card-head"><Ship size={20}/><div><h2>Guest stays & cruise calls</h2><p>Maintain controlled vessel calls and accommodations used by reservations and pickup operations.</p></div></div>
            <h2>Cruise calls</h2>
            <div className="form-grid"><Field label="Vessel name"><input required value={vesselName} onChange={e=>setVesselName(e.target.value)}/></Field><Field label="Call date"><input required type="date" value={callDate} onChange={e=>setCallDate(e.target.value)}/></Field><Field label="Port or marina"><input required value={portName} onChange={e=>setPortName(e.target.value)}/></Field><Field label="All aboard · optional ISO time" hint="Include the UTC offset, for example 2026-09-10T16:30:00-04:00"><input value={allAboardAt} onChange={e=>setAllAboardAt(e.target.value)}/></Field></div>
            <button type="button" className="button" disabled={stayMutation.busy||!vesselName||!callDate||!portName} onClick={()=>void createCruiseCall()}>Add cruise call</button>
            {stayOptions.data?.cruiseCalls.map(item=><div className="detail-row" key={item.id}><span><strong>{item.vessel_name}</strong><small>{item.call_date} · {item.port_name}{item.all_aboard_at?` · all aboard ${new Date(item.all_aboard_at).toLocaleString()}`:""}</small></span></div>)}
            <div className="form-divider"/><h2>Accommodation properties</h2>
            <div className="form-grid"><Field label="Hotel or property name"><input required value={accommodationName} onChange={e=>setAccommodationName(e.target.value)}/></Field><Field label="Address"><input value={accommodationAddress} onChange={e=>setAccommodationAddress(e.target.value)}/></Field></div>
            <button type="button" className="button" disabled={stayMutation.busy||!accommodationName} onClick={()=>void createAccommodation()}>Add accommodation</button>
            {stayOptions.data?.accommodations.map(item=><div className="detail-row" key={item.id}><span><strong>{item.name}</strong><small>{item.address||"No address recorded"}</small></span></div>)}
            {(stayMutation.error||stayOptions.error)&&<Notice error>{stayMutation.error||stayOptions.error}</Notice>}
          </section>}
          {tab === "payments" && (
            <section className="settings-future">
              <CreditCard size={20} />
              <div>
                <h2>Payments</h2>
                <p>
                  Tenant collection providers, Stripe Connect, gateway selection
                  and settlement rules will appear here after finance policy
                  decisions are recorded.
                </p>
              </div>
            </section>
          )}
          {tab === "waivers" && (
            <section>
              <div className="settings-card-head">
                <FileText size={20} />
                <div>
                  <h2>Waiver templates</h2>
                  <p>
                    Publish an approved version for staff capture. Signed
                    evidence always stays bound to its original version.
                  </p>
                </div>
              </div>
              {waiverTemplates.error ? (
                <Notice error>{waiverTemplates.error}</Notice>
              ) : !waiverTemplates.data ? (
                <Loading />
              ) : waiverTemplates.data.length ? (
                <div className="waiver-current">
                  <span>ACTIVE VERSION</span>
                  <strong>
                    v{waiverTemplates.data[0].version} ·{" "}
                    {waiverTemplates.data[0].title}
                  </strong>
                  <p>
                    Published{" "}
                    {new Date(
                      waiverTemplates.data[0].created_at,
                    ).toLocaleDateString()}
                  </p>
                </div>
              ) : (
                <Notice>No active waiver template has been published.</Notice>
              )}
              {session.permissions.includes("waiver.template.publish") ? (
                <div className="waiver-editor">
                  <h2>
                    {waiverTemplates.data?.length
                      ? "Publish replacement version"
                      : "Publish first version"}
                  </h2>
                  <p className="policy-copy">
                    Confirm wording with the tenant's legal and insurance
                    advisers before publishing. Publishing supersedes the
                    current version for future signatures; it never changes
                    existing evidence.
                  </p>
                  <Field label="Template title">
                    <input
                      required
                      maxLength={160}
                      value={waiverTitle}
                      onChange={(e) => setWaiverTitle(e.target.value)}
                      placeholder="For example, Tour participant waiver"
                    />
                  </Field>
                  <Field label="Approved waiver wording">
                    <textarea
                      required
                      maxLength={20000}
                      value={waiverBody}
                      onChange={(e) => setWaiverBody(e.target.value)}
                      placeholder="Enter tenant-approved wording"
                      rows={12}
                    />
                  </Field>
                  {waiverMutation.error && (
                    <Notice error>{waiverMutation.error}</Notice>
                  )}
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={
                        waiverMutation.busy ||
                        !waiverTitle.trim() ||
                        !waiverBody.trim()
                      }
                      onClick={() => void publishWaiverTemplate()}
                    >
                      {waiverMutation.busy
                        ? "Publishing…"
                        : "Publish immutable version"}
                      <Check size={17} />
                    </button>
                  </div>
                </div>
              ) : (
                <Notice>
                  Only the tenant owner can publish or replace waiver wording.
                </Notice>
              )}
            </section>
          )}
          {tab === "security" ? session.role==="owner"?<SupportAccessSettings/>:<section><div className="settings-card-head"><ShieldCheck size={20}/><div><h2>Security & support access</h2><p>Only a tenant owner can review or authorize Zettaz support access.</p></div></div></section> : null}
          {tab === "commercial" && (
            <section>
              <h2>Collection methods & booking sources</h2>
              <Field
                label="Allowed manual collection methods"
                hint="Comma-separated codes using lowercase letters, numbers and underscores."
              >
                <input
                  required
                  value={methods}
                  onChange={(e) => setMethods(e.target.value)}
                />
              </Field>
              <Field
                label="Booking sources"
                hint="Use partner_reseller for staff-entered Partners/Resellers bookings."
              >
                <input
                  required
                  value={sources}
                  onChange={(e) => setSources(e.target.value)}
                />
              </Field>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.allowAmendmentBalance ?? false}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      allowAmendmentBalance: e.target.checked,
                    })
                  }
                />
                Allow confirmed amendments to create an additional balance due
              </label>
              <p className="policy-copy">
                When disabled, an accepted amendment must satisfy its
                minimum-paid rule. This is separate from the initial
                confirmation policy.
              </p>
            </section>
          )}
          {mutation.error && (
            <Notice error>
              {mutation.error}{" "}
              <button type="button" className="text-button" onClick={refresh}>
                Reload current settings
              </button>
            </Notice>
          )}
          {(tab === "commercial" || tab === "localization") && (
            <div className="form-actions">
              <button className="button" disabled={mutation.busy}>
                {mutation.busy ? "Saving…" : "Save settings"}
                <Check size={17} />
              </button>
            </div>
          )}
        </form>}
      </div>
    </>
  );
}

type SupportGrant={id:string;platform_actor_id:string;platform_user:string;purpose:string;permissions:string[];status:"pending"|"approved"|"rejected"|"revoked";requested_at:string;expires_at:string|null;decision_reason:string|null};
function SupportAccessSettings(){
  const grants=useResource<{items:SupportGrant[]}>("admin/v1/support-access");
  const mutation=useMutation();
  async function decide(grant:SupportGrant,decision:"approved"|"rejected"){
    const reason=window.prompt(decision==="approved"?"Why is this support access approved?":"Why is this request rejected?");
    if(!reason)return;
    const result=await mutation.run(`admin/v1/support-access/${grant.id}/decision`,{decision,...(decision==="approved"?{expiresInHours:8}:{}),reason});
    if(result)grants.reload();
  }
  async function revoke(grant:SupportGrant){
    const reason=window.prompt("Why is this support access being revoked?");
    if(!reason)return;
    const result=await mutation.run(`admin/v1/support-access/${grant.id}/revoke`,{reason});
    if(result)grants.reload();
  }
  return <section>
    <div className="settings-card-head"><ShieldCheck size={20}/><div><h2>Security & support access</h2><p>Review time-limited, read-only access requested by an identified Zettaz support user.</p></div></div>
    <Notice>Support has no standing tenant access. Approval lasts at most eight hours, remains visibly marked in the workspace, and can be revoked immediately.</Notice>
    {(grants.error||mutation.error)&&<Notice error>{grants.error||mutation.error}</Notice>}
    {!grants.data?<Loading/>:!grants.data.items.length?<Empty title="No support requests"><p>No Zettaz support user has requested access to this tenant.</p></Empty>:<div className="stack-list support-grants">{grants.data.items.map(grant=><div className="detail-row" key={grant.id}>
      <span><strong>{grant.platform_user}</strong><small>{grant.purpose}</small><small>{grant.permissions.map(label).join(" · ")}</small>{grant.expires_at&&<small>Expires {new Date(grant.expires_at).toLocaleString()}</small>}</span>
      <span><Status state={grant.status}/>{grant.status==="pending"&&<><button type="button" className="button secondary" disabled={mutation.busy} onClick={()=>void decide(grant,"rejected")}>Reject</button><button type="button" className="button" disabled={mutation.busy} onClick={()=>void decide(grant,"approved")}>Approve 8 hours</button></>}{grant.status==="approved"&&<button type="button" className="text-link danger" disabled={mutation.busy} onClick={()=>void revoke(grant)}>Revoke</button>}</span>
    </div>)}</div>}
  </section>;
}
export function Team({ session }: { session: Session }) {
  const members = usePaged<Member>("staff/v1/workspace/members"),
    mutation = useMutation(),
    add = useMutation(),
    roleData = useResource<{ roles: RoleData[] }>("staff/v1/workspace/roles");
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("reservations"),
    [adding, setAdding] = useState(false),
    [invitationToken, setInvitationToken] = useState("");
  const roles = (roleData.data?.roles ?? []).filter(
    (item) => item.code !== "owner",
  );
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const result = await add.run<{ token: string }>("admin/v1/invitations", {
      name,
      email,
      role,
    });
    if (result) {
      setName("");
      setEmail("");
      setAdding(false);
      setInvitationToken(result.token);
    }
  }
  async function update(m: Member, r: string, active: boolean) {
    if (
      m.active &&
      !active &&
      !window.confirm(`Revoke ${m.name}'s tenant access?`)
    )
      return;
    const result = await mutation.run(
      "admin/v1/members/" + m.id,
      { role: r, active },
      "PATCH",
    );
    if (result) members.reload();
  }
  return (
    <>
      <Heading
        title="Team & access"
        description="Tenant staff only. External Partners/Resellers use a separate access model."
        action={
          <div className="button-row">
            <Link className="button secondary" href="/roles">
              <ShieldCheck size={17} />
              Roles & permissions
            </Link>
            <button className="button" onClick={() => setAdding(!adding)}>
              <Plus size={17} />
              Invite staff member
            </button>
          </div>
        }
      />
      {adding && (
        <form className="panel form-panel" onSubmit={create}>
          <h2>Invite a staff member</h2>
          <p className="muted">
            Creates a one-time activation token that expires in seven days.
            Send it only through an approved channel.
          </p>
          <div className="form-grid three">
            <Field label="Name">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={!roles.length}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {add.error && <Notice error>{add.error}</Notice>}
          <button className="button" disabled={add.busy || !roles.length}>
            {add.busy ? "Creating…" : "Create invitation"}
          </button>
        </form>
      )}
      {invitationToken && (
        <section className="panel form-panel">
          <h2>Activation token</h2>
          <p className="muted">
            Copy this token now. It is shown once and cannot be recovered. The recipient can use it at <strong>/activate</strong>.
          </p>
          <Field label="One-time token">
            <input readOnly value={invitationToken} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <button className="button secondary" onClick={() => setInvitationToken("")}>Done</button>
        </section>
      )}
      {(members.error || mutation.error) && (
        <Notice error>{members.error || mutation.error}</Notice>
      )}
      <section className="panel">
        {members.busy && !members.items.length ? (
          <Loading />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.items.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>
                        {m.name}
                        {m.id === session.actorId ? " (you)" : ""}
                      </strong>
                      <small>{m.email}</small>
                    </td>
                    <td>
                      {m.role === "owner" ? (
                        <span className="owner-role">
                          <ShieldCheck size={15} />
                          Owner
                        </span>
                      ) : (
                        <select
                          aria-label={"Role for " + m.name}
                          value={m.role}
                          disabled={mutation.busy}
                          onChange={(e) => update(m, e.target.value, m.active)}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.code}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <Status state={m.active ? "active" : "revoked"} />
                    </td>
                    <td>
                      {m.role !== "owner" && (
                        <button
                          className="text-button"
                          disabled={mutation.busy}
                          onClick={() => update(m, m.role, !m.active)}
                        >
                          {m.active ? "Revoke access" : "Restore access"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More {...members} count={members.items.length} />
      </section>
    </>
  );
}
type RoleData = {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  permissions: string[];
};
type PermissionData = {
  code: string;
  name: string;
  description: string;
  module_code: string;
  module_name: string;
};
export function RolesPermissions() {
  const data = useResource<{
      roles: RoleData[];
      permissions: PermissionData[];
    }>("staff/v1/workspace/roles"),
    create = useMutation();
  const [name, setName] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [adding, setAdding] = useState(false);
  if (data.error) return <Notice error>{data.error}</Notice>;
  if (!data.data) return <Loading />;
  const grouped = Object.entries(
    Object.groupBy(
      data.data.permissions,
      (permission) => permission.module_name,
    ),
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await create.run("admin/v1/roles", {
      name,
      permissions: selected,
    });
    if (result) {
      setName("");
      setSelected([]);
      setAdding(false);
      data.reload();
    }
  }
  return (
    <>
      <Heading
        title="Roles & permissions"
        description="System roles are protected. Create tenant roles by selecting the capabilities staff require."
        action={
          <Link className="button secondary" href="/team">
            Back to team
          </Link>
        }
      />
      {adding ? (
        <form className="panel form-panel" onSubmit={submit}>
          <h2>Create tenant role</h2>
          <Field label="Role name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <div className="permission-grid">
            {grouped.map(([module, permissions]) => (
              <fieldset key={module}>
                <legend>{module}</legend>
                {permissions!.map((permission) => (
                  <label key={permission.code}>
                    <input
                      type="checkbox"
                      checked={selected.includes(permission.code)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(permission.code)
                            ? current.filter((code) => code !== permission.code)
                            : [...current, permission.code],
                        )
                      }
                    />{" "}
                    <span>
                      <strong>{permission.name}</strong>
                      <small>{permission.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          {create.error && <Notice error>{create.error}</Notice>}
          <button className="button" disabled={create.busy || !selected.length}>
            {create.busy ? "Creating…" : "Create role"}
          </button>
        </form>
      ) : (
        <button className="button" onClick={() => setAdding(true)}>
          <Plus size={17} />
          Create role
        </button>
      )}
      <section className="panel roles-table">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Permissions</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {data.data.roles.map((role) => (
              <tr key={role.id}>
                <td>
                  <strong>{role.name}</strong>
                  <small>{role.code}</small>
                </td>
                <td>
                  {role.permissions.map(label).join(", ") || "No permissions"}
                </td>
                <td>
                  <Status state={role.is_system ? "system" : "custom"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
