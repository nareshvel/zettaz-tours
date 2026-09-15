"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import {
  Building2,
  CreditCard,
  KeyRound,
  Lock,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { Session } from "@/lib/types";
import { label, useMutation } from "@/lib/client";
import { ConfirmDialog, Field, FormActions, Heading, Notice } from "./common";
import { Subscription } from "./subscription";

type ProfileSection = "profile" | "security" | "subscription";

function isOwner(session: Session) {
  return session.role === "owner";
}

export function Profile({
  session,
  section = "profile",
}: {
  session: Session;
  section?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const active: ProfileSection =
    section === "security"
      ? "security"
      : section === "subscription"
        ? "subscription"
        : "profile";

  useEffect(() => {
    if (active === "subscription" && !isOwner(session)) {
      router.replace("/profile");
      return;
    }
    if (path === "/subscription" && isOwner(session)) {
      router.replace("/profile/subscription");
    }
  }, [active, path, router, session]);

  const tabs: {
    id: ProfileSection;
    href: string;
    label: string;
    icon: typeof UserRound;
    ownerOnly?: boolean;
  }[] = [
    { id: "profile", href: "/profile", label: "Profile", icon: UserRound },
    {
      id: "security",
      href: "/profile/security",
      label: "Security",
      icon: ShieldCheck,
    },
    {
      id: "subscription",
      href: "/profile/subscription",
      label: "Subscription",
      icon: CreditCard,
      ownerOnly: true,
    },
  ];

  const visibleTabs = tabs.filter((tab) => !tab.ownerOnly || isOwner(session));

  return (
    <div className="account-profile-page">
      <Heading
        eyebrow="ACCOUNT"
        title="My profile"
        description="Manage your personal information, security, and preferences."
      />

      <div className="account-profile-layout">
        <aside className="panel account-profile-rail">
          <div className="account-profile-hero">
            <span className="profile-avatar" aria-hidden>
              {(session.actorName || "?").slice(0, 1).toUpperCase()}
            </span>
            <strong>{session.actorName}</strong>
            <small>{session.actorEmail}</small>
            <span className="account-role-badge">{label(session.role)}</span>
          </div>
          <nav className="account-profile-nav" aria-label="Account sections">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  className={active === tab.id ? "active" : ""}
                  aria-current={active === tab.id ? "page" : undefined}
                >
                  <Icon size={17} />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="account-profile-content">
          {active === "profile" && <ProfileDetails session={session} />}
          {active === "security" && <SecurityDetails session={session} />}
          {active === "subscription" && isOwner(session) && (
            <div className="panel form-panel account-profile-panel">
              <Suspense
                fallback={
                  <div style={{ padding: "40px 24px" }}>
                    <div className="spinner" />
                  </div>
                }
              >
                <Subscription embedded />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileDetails({ session }: { session: Session }) {
  const mutation = useMutation();
  const [name, setName] = useState(session.actorName);
  const [email, setEmail] = useState(session.actorEmail);
  const [phoneNumber, setPhoneNumber] = useState(session.actorPhone ?? "");
  const [profileMessage, setProfileMessage] = useState("");

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setProfileMessage("");
    const result = await mutation.run(
      "staff/v1/workspace/profile",
      { name, email, phoneNumber },
      "PATCH",
    );
    if (result) setProfileMessage("Profile saved.");
  }

  return (
    <div className="panel form-panel account-profile-panel">
      <form className="profile-section" onSubmit={saveProfile}>
        <div className="settings-card-head">
          <UserRound size={20} />
          <div>
            <h2>Personal information</h2>
            <p>Used for your workspace identity and account communications.</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Full name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="name"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Phone">
            <input
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              autoComplete="tel"
            />
          </Field>
        </div>
        {mutation.error && <Notice error>{mutation.error}</Notice>}
        {!mutation.error && profileMessage && <Notice>{profileMessage}</Notice>}
        <FormActions stickyOnMobile>
          <button className="button" disabled={mutation.busy}>
            {mutation.busy ? "Saving…" : "Save profile"}
          </button>
        </FormActions>
      </form>

      <div className="form-divider" />

      <section className="profile-section profile-workspace">
        <Building2 size={20} />
        <div>
          <h2>{session.tenant.name}</h2>
          <p>Current tenant workspace for this session.</p>
        </div>
        {session.permissions.includes("config.write") && (
          <Link className="button secondary" href="/settings">
            Tenant settings
          </Link>
        )}
      </section>
    </div>
  );
}

function SecurityDetails({ session }: { session: Session }) {
  const password = useMutation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function updatePassword(event: React.FormEvent) {
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
  }

  async function signOutEverywhere() {
    setSignOutBusy(true);
    setSignOutError(null);
    try {
      const response = await fetch("/api/session?all=true", {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "Could not sign out everywhere.");
      }
      window.location.href = "/login";
    } catch (error) {
      setSignOutBusy(false);
      setSignOutError(
        error instanceof Error
          ? error.message
          : "Could not sign out everywhere.",
      );
    }
  }

  return (
    <>
      <div className="panel form-panel account-profile-panel">
        <form className="profile-section" onSubmit={updatePassword}>
          <div className="settings-card-head">
            <KeyRound size={20} />
            <div>
              <h2>Change password</h2>
              <p>
                Use at least 12 characters. Changing password keeps this
                session.
              </p>
            </div>
          </div>
          <div className="form-grid">
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
          <FormActions stickyOnMobile>
            <button className="button" disabled={password.busy}>
              {password.busy ? "Updating…" : "Save password"}
            </button>
          </FormActions>
        </form>

        <div className="form-divider" />

        <section className="profile-section">
          <div className="settings-card-head">
            <ShieldCheck size={20} />
            <div>
              <div className="account-section-title-row">
                <h2>Two-factor authentication</h2>
                <span className="status-pill muted">Disabled</span>
              </div>
              <p>
                Privileged MFA (TOTP and recovery codes) is planned for launch
                hardening and is not enabled yet.
              </p>
            </div>
          </div>
        </section>

        <div className="form-divider" />

        <section className="profile-section">
          <div className="settings-card-head">
            <Lock size={20} />
            <div>
              <div className="account-section-title-row">
                <h2>Active sessions</h2>
                <button
                  className="text-link danger"
                  type="button"
                  onClick={() => {
                    setSignOutError(null);
                    setSignOutOpen(true);
                  }}
                >
                  Sign out everywhere
                </button>
              </div>
              <p>
                Device inventory is not listed yet. You can revoke every
                workspace session for {session.actorEmail}, including this
                browser.
              </p>
            </div>
          </div>
          <div className="account-session-row">
            <div>
              <strong>This browser</strong>
              <small>Current workspace session</small>
            </div>
            <span className="status-pill success">This device</span>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={signOutOpen}
        title="Sign out everywhere?"
        description="This ends every active workspace session for your account, including this browser. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        danger
        busy={signOutBusy}
        error={signOutError}
        onClose={() => {
          if (!signOutBusy) setSignOutOpen(false);
        }}
        onConfirm={signOutEverywhere}
      />
    </>
  );
}
