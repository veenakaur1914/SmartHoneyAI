"use client";

import { useEffect } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Dashboard data request failed", error); }, [error]);
  return <section className="panel" aria-labelledby="dashboard-error-title">
    <div className="panel-body">
      <div className="notice danger" role="alert"><ShieldAlert size={16}/><span><strong id="dashboard-error-title">Live control-plane data is unavailable.</strong> No fallback or fabricated values are being shown.</span></div>
      <p className="muted">Check the API, database, and current organization access, then retry this request.</p>
      <button className="button button-secondary" type="button" onClick={reset}><RefreshCw size={15}/> Retry</button>
    </div>
  </section>;
}
