import Link from "next/link";
import { useState } from "react";
import { Building2, ShieldCheck } from "lucide-react";
import type { Session } from "@/lib/types";
import { Field, Heading, Notice } from "./common";
import { label, useMutation } from "@/lib/client";

export function Profile({ session }: { session: Session }) {
  const mutation = useMutation();
  const [name, setName] = useState(session.actorName),
    [email, setEmail] = useState(session.actorEmail),
    [phoneNumber, setPhoneNumber] = useState(session.actorPhone ?? "");
  const password = useMutation();
  const [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [passwordMessage, setPasswordMessage] = useState("");
  return (
    <>
      <Heading
        title="My profile"
        description="Your active workspace identity and access role."
      />
      <section className="panel profile-card">
        <span className="profile-avatar">
          {session.actorName.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{session.actorName}</h2>
          <p>{session.actorEmail}</p>
          <span className="profile-role">
            <ShieldCheck size={15} /> {label(session.role)}
          </span>
        </div>
      </section>
      <form
        className="panel form-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          await mutation.run(
            "staff/v1/workspace/profile",
            { name, email, phoneNumber },
            "PATCH",
          );
        }}
      >
        <h2>Personal information</h2>
        <p className="muted">
          Used for your workspace identity and account communications.
        </p>
        <div className="form-grid three">
          <Field label="Full name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Phone">
            <input
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />
          </Field>
        </div>
        {mutation.error && <Notice error>{mutation.error}</Notice>}
        <button className="button" disabled={mutation.busy}>
          {mutation.busy ? "Saving…" : "Save profile"}
        </button>
      </form>
      <section className="panel profile-workspace">
        <Building2 size={20} />
        <div>
          <h2>{session.tenant.name}</h2>
          <p>Current tenant workspace</p>
        </div>
        {session.permissions.includes("config.write") && (
          <Link className="text-link" href="/settings">
            Tenant settings
          </Link>
        )}
      </section>
      <form
        className="panel form-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          setPasswordMessage("");
          if (newPassword !== confirmPassword) {
            setPasswordMessage("New passwords do not match.");
            return;
          }
          const result = await password.run("auth/v1/change-password", {
            currentPassword,
            newPassword,
          });
          if (result) {
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setPasswordMessage("Password updated.");
          }
        }}
      >
        <h2>Password</h2>
        <p className="muted">Use at least 12 characters.</p>
        <div className="form-grid three">
          <Field label="Current password">
            <input
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              autoComplete="new-password"
              type="password"
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input
              autoComplete="new-password"
              type="password"
              minLength={12}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>
        </div>
        {(password.error || passwordMessage) && (
          <Notice error={Boolean(password.error)}>
            {password.error || passwordMessage}
          </Notice>
        )}
        <button className="button" disabled={password.busy}>
          {password.busy ? "Updating…" : "Update password"}
        </button>
      </form>
      <section className="panel form-panel">
        <h2>Active sessions</h2>
        <p className="muted">End every active workspace session for this account, including this browser.</p>
        <button className="button secondary" type="button" onClick={async () => { if (!window.confirm("Sign out of every device?")) return; await fetch("/api/session?all=true", { method: "DELETE" }); window.location.href = "/login"; }}>Sign out everywhere</button>
      </section>
    </>
  );
}
