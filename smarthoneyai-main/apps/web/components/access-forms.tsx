"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "/v1").replace(/\/$/, "");
const endpoint = (path: string) => apiUrl.endsWith("/v1") ? `${apiUrl}${path.replace(/^\/v1/, "")}` : `${apiUrl}${path}`;

function loginError(status: number) {
  if (status === 401) return "Email or password was not recognized.";
  if (status === 429) return "Too many attempts. Wait 15 minutes and try again.";
  if (status === 403) return "Login was rejected. Clear this site's cookies and confirm APP_URL matches the browser address.";
  if (status === 404 || status >= 500) return "The login service is unavailable. Check the public Nginx/API route.";
  return "Unable to log in. Please check the submitted details.";
}

export function RequestAccessForm() {
  const [status, setStatus] = useState<"idle"|"loading"|"success"|"error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus("loading"); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      company: String(form.get("company") ?? ""),
      websiteCount: Number(form.get("websiteCount") ?? 1),
      message: String(form.get("message") ?? ""),
      consent: form.get("consent") === "on"
    };
    try {
      const response = await fetch(endpoint("/v1/access-requests"), { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "We could not send your request. Please try again.");
      formElement.reset();
      setStatus("success"); setMessage("Request received. Our pilot team will review your workspace needs and contact you by email.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof TypeError ? "The access request service could not be reached. Check your connection and try again." : error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  return <form className="form-grid" onSubmit={submit}>
    <div className="form-row"><div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" autoComplete="name" required placeholder="Mr X" /></div><div className="field"><label htmlFor="workEmail">Work email</label><input id="workEmail" name="email" autoComplete="email" required type="email" placeholder="you@company.com" /></div></div>
    <div className="form-row"><div className="field"><label htmlFor="company">Company or team</label><input id="company" name="company" autoComplete="organization" required placeholder="Your organization" /></div><div className="field"><label htmlFor="websiteCount">Exact number of WordPress sites</label><input id="websiteCount" name="websiteCount" type="number" inputMode="numeric" min={1} max={50} step={1} defaultValue={1} required /></div></div>
    <div className="field"><label htmlFor="message">What would you like to protect?</label><textarea id="message" name="message" required placeholder="Tell us about your sites, team, and current security workflow." /></div>
    <label style={{display:"flex",gap:10,alignItems:"flex-start",color:"var(--muted)",fontSize:12}}><input name="consent" type="checkbox" required style={{marginTop:3}}/> I agree that SmartHoneyAI may contact me about this pilot request. See the privacy policy for data handling details.</label>
    {message && <div className={`form-message ${status === "success" ? "success" : "error"}`} role="status">{message}</div>}
    <div className="form-footer"><span><LockKeyhole size={13} style={{display:"inline",verticalAlign:"-2px",marginRight:5}}/>Reviewed manually. No public signup.</span><button className="button button-primary" disabled={status === "loading"}>{status === "loading" ? <LoaderCircle size={16} className="spin"/> : <>Send access request <ArrowRight size={16}/></>}</button></div>
  </form>;
}

export function LoginForm() {
  const [status,setStatus]=useState<"idle"|"loading"|"error">("idle"); const [message,setMessage]=useState(""); const router=useRouter();
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setStatus("loading");setMessage("");const form=new FormData(event.currentTarget);try{const response=await fetch(endpoint("/v1/auth/login"),{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(form.entries()))});if(!response.ok)throw new Error(loginError(response.status));router.push("/dashboard");router.refresh()}catch(error){setStatus("error");setMessage(error instanceof TypeError?"The login service could not be reached. Check the public Nginx/API route.":error instanceof Error?error.message:"Unable to log in.")}}
  return <form className="form-grid" onSubmit={submit}><div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com"/></div><div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required minLength={15} placeholder="Enter your password"/></div>{message&&<div className="form-message error" role="alert">{message}</div>}<button className="button button-primary" disabled={status==="loading"}>{status==="loading"?<><LoaderCircle size={16}/>Signing in…</>:<>Log in securely <ArrowRight size={16}/></>}</button></form>;
}
