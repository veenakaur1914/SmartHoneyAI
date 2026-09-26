"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "/v1").replace(/\/$/, "");
const endpoint = (path: string) => apiUrl.endsWith("/v1") ? `${apiUrl}${path.replace(/^\/v1/, "")}` : `${apiUrl}${path}`;

type FormStatus = "idle" | "loading" | "success" | "error";
const oneTimeTokenPattern = /^[A-Za-z0-9_-]{40,128}$/;

function useFragmentToken() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const candidate = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    window.history.replaceState(window.history.state, "", window.location.pathname);
    setToken(oneTimeTokenPattern.test(candidate) ? candidate : "");
  }, []);
  return token;
}

async function readMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: unknown };
    return typeof body.message === "string" && body.message.length <= 300 ? body.message : fallback;
  } catch {
    return fallback;
  }
}

function requestError(error: unknown, fallback: string) {
  return error instanceof TypeError ? "The account service could not be reached. Please try again shortly." : error instanceof Error ? error.message : fallback;
}

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch(endpoint("/v1/auth/forgot-password"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(form.get("email") ?? "").trim().toLowerCase() })
      });
      if (!response.ok) throw new Error(await readMessage(response, "We could not process that request. Please try again."));
      setStatus("success");
      setMessage(await readMessage(response, "If that account exists, a password reset link has been sent."));
      formElement.reset();
    } catch (error) {
      setStatus("error");
      setMessage(requestError(error, "We could not process that request."));
    }
  }

  return <form className="form-grid" onSubmit={submit}>
    <div className="field">
      <label htmlFor="recoveryEmail">Email address</label>
      <input id="recoveryEmail" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required placeholder="you@company.com"/>
      <span className="field-help">For privacy, the confirmation is the same whether or not an account exists.</span>
    </div>
    {message && <div className={`form-message ${status === "success" ? "success" : "error"}`} role={status === "error" ? "alert" : "status"}>{message}</div>}
    {status === "success" ? <Link className="button button-secondary" href="/login">Return to login</Link> : <button className="button button-primary" type="submit" disabled={status === "loading"}>
      {status === "loading" ? <><LoaderCircle size={16} className="spin"/>Sending secure link…</> : <>Send reset link <ArrowRight size={16}/></>}
    </button>}
  </form>;
}

export function ResetPasswordForm() {
  const token = useFragmentToken();
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== confirmation) {
      setStatus("error");
      setMessage("The password confirmation does not match.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch(endpoint("/v1/auth/reset-password"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      if (!response.ok) throw new Error(await readMessage(response, "This password reset link could not be used."));
      setStatus("success");
      setMessage(await readMessage(response, "Password updated. Sign in with your new password."));
      formElement.reset();
    } catch (error) {
      setStatus("error");
      setMessage(requestError(error, "This password reset link could not be used."));
    }
  }

  if (token === null) return <div className="form-message" role="status">Preparing the secure reset form…</div>;
  if (!token) return <div className="form-grid">
    <div className="form-message error" role="alert">This reset link is incomplete or invalid. Request a new link to continue.</div>
    <Link className="button button-primary" href="/forgot-password">Request a new reset link</Link>
  </div>;

  if (status === "success") return <div className="form-grid">
    <div className="form-message success" role="status"><CheckCircle2 size={16} style={{ display: "inline", verticalAlign: "-3px", marginRight: 7 }}/>{message}</div>
    <Link className="button button-primary" href="/login">Sign in <ArrowRight size={16}/></Link>
  </div>;

  return <form className="form-grid" onSubmit={submit}>
    <div className="field">
      <label htmlFor="newPassword">New password</label>
      <input id="newPassword" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required aria-describedby="passwordHelp" placeholder="At least 15 characters"/>
      <span className="field-help" id="passwordHelp">Use at least 15 characters and a password you do not use elsewhere.</span>
    </div>
    <div className="field">
      <label htmlFor="passwordConfirmation">Confirm new password</label>
      <input id="passwordConfirmation" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={15} maxLength={128} required placeholder="Repeat your new password"/>
    </div>
    {message && <div className="form-message error" role="alert">{message}</div>}
    <button className="button button-primary" type="submit" disabled={status === "loading"}>
      {status === "loading" ? <><LoaderCircle size={16} className="spin"/>Updating password…</> : <>Update password <ArrowRight size={16}/></>}
    </button>
  </form>;
}

export function AcceptInvitationForm() {
  const token = useFragmentToken();
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== confirmation) {
      setStatus("error");
      setMessage("The password confirmation does not match.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch(endpoint("/v1/invitations/accept"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: String(form.get("name") ?? "").trim(), password })
      });
      if (!response.ok) throw new Error(await readMessage(response, "This invitation could not be accepted."));
      setStatus("success");
      setMessage(await readMessage(response, "Invitation accepted. You can now sign in."));
      formElement.reset();
    } catch (error) {
      setStatus("error");
      setMessage(requestError(error, "This invitation could not be accepted."));
    }
  }

  if (token === null) return <div className="form-message" role="status">Preparing the secure invitation form…</div>;
  if (!token) return <div className="form-grid">
    <div className="form-message error" role="alert">This invitation link is incomplete or invalid. Ask your organization administrator for a new invitation.</div>
    <Link className="button button-secondary" href="/login">Return to login</Link>
  </div>;

  if (status === "success") return <div className="form-grid">
    <div className="form-message success" role="status"><CheckCircle2 size={16} style={{ display: "inline", verticalAlign: "-3px", marginRight: 7 }}/>{message}</div>
    <Link className="button button-primary" href="/login">Continue to login <ArrowRight size={16}/></Link>
  </div>;

  return <form className="form-grid" onSubmit={submit}>
    <div className="field">
      <label htmlFor="invitationName">Full name</label>
      <input id="invitationName" name="name" type="text" autoComplete="name" minLength={2} maxLength={120} required placeholder="Your full name"/>
    </div>
    <div className="field">
      <label htmlFor="invitationPassword">Password</label>
      <input id="invitationPassword" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required aria-describedby="invitationPasswordHelp" placeholder="At least 15 characters"/>
      <span className="field-help" id="invitationPasswordHelp">Use at least 15 characters and a password you do not use elsewhere.</span>
    </div>
    <div className="field">
      <label htmlFor="invitationPasswordConfirmation">Confirm password</label>
      <input id="invitationPasswordConfirmation" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={15} maxLength={128} required placeholder="Repeat your password"/>
    </div>
    {message && <div className="form-message error" role="alert">{message}</div>}
    <button className="button button-primary" type="submit" disabled={status === "loading"}>
      {status === "loading" ? <><LoaderCircle size={16} className="spin"/>Accepting invitation…</> : <>Accept invitation <ArrowRight size={16}/></>}
    </button>
  </form>;
}
