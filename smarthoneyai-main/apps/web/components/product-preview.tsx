export function ProductPreview() {
  return (
    <div className="product-preview" aria-label="Illustrative SmartHoneyAI security data flow">
      <div className="preview-top"><span className="preview-brand"><span className="live-dot" /> SmartHoneyAI</span><span className="preview-live">Architecture preview</span></div>
      <div className="preview-body">
        <div className="preview-sidebar">{Array.from({length: 8}).map((_,i) => <div className={`preview-nav-line ${i === 0 ? "active" : ""}`} key={i} />)}</div>
        <div className="preview-content">
          <div className="preview-heading"><strong>Security data flow</strong><span>Reference architecture</span></div>
          <div className="preview-metrics">
            <div className="preview-metric"><small>Telemetry</small><b>Bounded</b></div>
            <div className="preview-metric"><small>Evidence</small><b>Redacted</b></div>
            <div className="preview-metric"><small>Policies</small><b>Signed</b></div>
          </div>
          <div className="preview-chart">
            <svg className="sparkline" viewBox="0 0 420 100" preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id="previewFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity=".26"/><stop offset="1" stopColor="#38bdf8" stopOpacity="0"/></linearGradient></defs>
              <path d="M0 78 C30 70,45 75,68 58 S110 80,140 52 S184 22,210 45 S252 66,278 31 S332 18,350 38 S392 12,420 22 L420 100 L0 100Z" fill="url(#previewFill)" />
              <path d="M0 78 C30 70,45 75,68 58 S110 80,140 52 S184 22,210 45 S252 66,278 31 S332 18,350 38 S392 12,420 22" fill="none" stroke="#38bdf8" strokeWidth="2" />
            </svg>
          </div>
          <div className="preview-event"><strong>WordPress sensor</strong><span>Suspicious-only capture</span><span style={{color:"#bae6fd"}}>Local</span></div>
          <div className="preview-event"><strong>Control plane</strong><span>Asynchronous classification</span><span style={{color:"#fde68a"}}>Isolated</span></div>
          <div className="preview-event"><strong>Signed response</strong><span>Verified cached policy</span><span style={{color:"#bbf7d0"}}>Fail-open</span></div>
        </div>
      </div>
    </div>
  );
}
