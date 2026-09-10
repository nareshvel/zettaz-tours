"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  UsersRound,
} from "lucide-react";
import type { DemoTenant } from "@/lib/types";
import { Loading, Notice } from "./common";

export function Entry({
  login,
  activation,
  recovery,
  tenants,
  busy,
  error,
  signIn,
}: {
  login: boolean;
  activation: boolean;
  recovery: boolean;
  tenants: DemoTenant[];
  busy: boolean;
  error: string;
  signIn: (
    tenantId: string | undefined,
    email: string,
    password: string,
  ) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activationToken, setActivationToken] = useState("");
  const [activationError, setActivationError] = useState("");
  const [recoveryToken,setRecoveryToken]=useState("");
  const [recoveryMessage,setRecoveryMessage]=useState("");
  if(recovery) return <main className="login-page"><div className="login-brand"><img src="/brand/zettaz-logo-dark.svg" alt="Zettaz Tours and Charters"/></div><section className="login-card"><p className="eyebrow">ACCOUNT RECOVERY</p><h1>{recoveryToken?"Choose a new password":"Reset your password"}</h1><p className="subtitle">{recoveryToken?"Use the single-use recovery token and choose a new password.":"Enter your work email. The response is the same whether or not an account exists."}</p><form onSubmit={async event=>{event.preventDefault();setActivationError("");const response=await fetch("/api/recovery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(recoveryToken?{token:recoveryToken,password}:{email})});const result=await response.json();if(!response.ok)return setActivationError(result.message??"Recovery failed.");if(recoveryToken){setRecoveryMessage("Password updated. All previous sessions were signed out.");return}setRecoveryMessage("If that account is active, recovery instructions are ready.");if(result.token)setRecoveryToken(result.token);}}>{!recoveryToken?<label className="field"><span>Work email</span><input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label>:<><label className="field"><span>Recovery token</span><input required value={recoveryToken} onChange={event=>setRecoveryToken(event.target.value)}/></label><label className="field"><span>New password</span><input type="password" minLength={12} autoComplete="new-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label></>}<button className="button">{recoveryToken?"Update password":"Continue"} <ArrowRight size={17}/></button></form>{recoveryMessage&&<Notice>{recoveryMessage}</Notice>}{activationError&&<Notice error>{activationError}</Notice>}<p className="login-note">Recovery delivery remains held until the transactional email provider is configured.</p><Link className="text-link" href="/login">Return to sign in</Link></section></main>;
  if (activation)
    return <main className="login-page"><div className="login-brand"><img src="/brand/zettaz-logo-dark.svg" alt="Zettaz Tours and Charters" /></div><section className="login-card"><p className="eyebrow">ACCOUNT ACTIVATION</p><h1>Activate your account</h1><p className="subtitle">Enter the one-time token supplied by your tenant administrator and choose a password.</p>{busy ? <Loading /> : <form onSubmit={async (event) => { event.preventDefault(); if (password !== confirmPassword) return; setActivationError(""); const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activationToken, password }) }); const result = await response.json(); if (response.ok) window.location.href = "/"; else setActivationError(result.message ?? "Activation failed."); }}><label className="field"><span>Activation token</span><input required value={activationToken} onChange={(event) => setActivationToken(event.target.value)} /></label><label className="field"><span>Password</span><input type="password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="field"><span>Confirm password</span><input type="password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>{confirmPassword && password !== confirmPassword && <Notice error>Passwords do not match.</Notice>}{activationError && <Notice error>{activationError}</Notice>}<button className="button" disabled={password !== confirmPassword}>Activate account <ArrowRight size={17} /></button></form>}{error && <Notice error>{error}</Notice>}</section></main>;
  if (!login)
    return (
      <main className="landing">
        <header className="landing-header">
          <img
            src="/brand/zettaz-logo-dark.svg"
            alt="Zettaz Tours and Charters"
          />
          <Link href="/login" className="button secondary">
            Sign in
          </Link>
        </header>
        <section className="landing-hero">
          <p className="eyebrow">TOUR OPERATOR WORKSPACE</p>
          <h1>Every departure, under control.</h1>
          <p>
            Manage reservations, departures, payments, waivers and staff access
            from one tenant-secure workspace.
          </p>
          <Link href="/login" className="button">
            Access your workspace <ArrowRight size={17} />
          </Link>
        </section>
        <section className="landing-points">
          <div>
            <CheckCircle2 size={21} />
            <strong>Operational control</strong>
            <span>Bookings and departure readiness together.</span>
          </div>
          <div>
            <UsersRound size={21} />
            <strong>Role-based access</strong>
            <span>Staff see only the work they need.</span>
          </div>
          <div>
            <LockKeyhole size={21} />
            <strong>Tenant-secure data</strong>
            <span>Every read and mutation is tenant scoped.</span>
          </div>
        </section>
      </main>
    );
  return (
    <main className="login-page">
      <div className="login-brand">
        <img
          src="/brand/zettaz-logo-dark.svg"
          alt="Zettaz Tours and Charters"
        />
      </div>
      <section className="login-card">
        <p className="eyebrow">WORKSPACE ACCESS</p>
        <h1>Sign in</h1>
        <p className="subtitle">Use the email assigned to your organization.</p>
        {busy ? (
          <Loading />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              signIn(undefined, email, password);
            }}
          >
            <label className="field">
              <span>Work email</span>
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="button">
              Continue <ArrowRight size={17} />
            </button>
            <Link className="text-link" href="/forgot-password">Forgot password?</Link>
          </form>
        )}
        {error && <Notice error>{error}</Notice>}
        <p className="login-note">
          Local development uses the persistent workspace database. Invitation
          activation is available; MFA and account recovery remain required
          before production use.
        </p>
      </section>
    </main>
  );
}
