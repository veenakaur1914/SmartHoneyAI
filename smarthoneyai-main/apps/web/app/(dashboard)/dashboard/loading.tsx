export default function DashboardLoading() {
  return <section className="panel" aria-busy="true" aria-live="polite">
    <div className="panel-body"><p className="muted" style={{ margin: 0 }}>Loading current control-plane records…</p></div>
  </section>;
}
