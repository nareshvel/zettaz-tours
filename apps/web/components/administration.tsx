"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, ArrowRight, ShieldCheck } from "lucide-react";
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
} from "./common";

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
    [sources, setSources] = useState(config.bookingSources.join(", "));
  const mutation = useMutation();
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
  return (
    <>
      <Heading
        title="Tenant settings"
        description="Policies apply to new holds. Existing quotes and confirmed prices stay fixed."
      />
      <div className="settings-layout">
        <aside className="panel settings-summary">
          <span className="tenant-monogram">
            {session.tenant.name.replace("Mock ", "").slice(0, 1)}
          </span>
          <h2>{session.tenant.name}</h2>
          <Status state="mock" />
          <dl>
            <dt>Timezone</dt>
            <dd>{session.tenant.timezone}</dd>
            <dt>Booking currency</dt>
            <dd>{config.bookingCurrency}</dd>
            <dt>Configuration version</dt>
            <dd>{session.tenant.version}</dd>
          </dl>
          <p className="muted">
            Live gateways and cross-currency collection are not enabled in this
            demo.
          </p>
        </aside>
        <form className="panel form-panel" onSubmit={submit}>
          <h2>Booking & payment policies</h2>
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
                  setConfig({ ...config, holdSeconds: Number(e.target.value) })
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
              label="Tax rate · %"
              hint="Mock policy only. Confirm actual tax treatment before launch."
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
                    taxBasisPoints: Math.round(Number(e.target.value) * 100),
                  })
                }
              />
            </Field>
          </div>
          <label className="checkbox setting-check">
            <input
              type="checkbox"
              checked={config.allowUnresolvedPickup}
              onChange={(e) =>
                setConfig({
                  ...config,
                  allowUnresolvedPickup: e.target.checked,
                })
              }
            />
            <span>
              Allow confirmation before pickup is arranged
              <small>Unresolved pickup still appears on the booking.</small>
            </span>
          </label>
          <div className="form-divider" />
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
            When disabled, an accepted amendment must satisfy its minimum-paid
            rule. This is separate from the initial confirmation policy.
          </p>
          {mutation.error && (
            <Notice error>
              {mutation.error}{" "}
              <button type="button" className="text-button" onClick={refresh}>
                Reload current settings
              </button>
            </Notice>
          )}
          <div className="form-actions">
            <button className="button" disabled={mutation.busy}>
              {mutation.busy ? "Saving…" : "Save settings"}
              <Check size={17} />
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
export function Team({ session }: { session: Session }) {
  const members = usePaged<Member>("staff/v1/workspace/members"),
    mutation = useMutation(),
    add = useMutation();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("reservations"),
    [adding, setAdding] = useState(false);
  const roles = ["admin", "reservations", "dispatcher", "finance", "auditor"];
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const result = await add.run("admin/v1/members", { name, email, role });
    if (result) {
      setName("");
      setEmail("");
      setAdding(false);
      members.reload();
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
          <button className="button" onClick={() => setAdding(!adding)}>
            <Plus size={17} />
            Add staff record
          </button>
        }
      />
      {adding && (
        <form className="panel form-panel" onSubmit={create}>
          <h2>Add a staff record</h2>
          <p className="muted">
            Creates a local staff record. No invitation email or production
            login is sent.
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
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {add.error && <Notice error>{add.error}</Notice>}
          <button className="button" disabled={add.busy}>
            {add.busy ? "Adding…" : "Add staff record"}
          </button>
        </form>
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
                            <option key={r} value={r}>
                              {label(r)}
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
