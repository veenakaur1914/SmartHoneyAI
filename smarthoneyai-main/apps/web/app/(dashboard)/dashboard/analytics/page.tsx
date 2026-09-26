import type { Metadata } from "next";
import { Activity, Flame, ShieldAlert, Waypoints } from "lucide-react";
import { MetricCard, PageHeader, Panel } from "@/components/dashboard-ui";
import { apiGet } from "@/lib/api";

export const metadata: Metadata = { title: "Analytics" };

type CountRow = { _count: { _all: number } };
type AnalyticsResponse = {
  totalEvents: number;
  blockedEvents: number;
  criticalAssessments: number;
  trend: Array<{ date: string; detected: number; blocked: number }>;
  byThreat: Array<CountRow & { threatType: string | null }>;
  byCountry: Array<CountRow & { countryCode: string | null }>;
  byProtocol: Array<CountRow & { protocol: string | null }>;
  bySite: Array<CountRow & { siteId: string; name: string }>;
  topRoutes: Array<CountRow & { path: string }>;
};

const number = new Intl.NumberFormat("en");
const palette = ["#f87171", "#fbbf24", "#38bdf8", "#34d399", "#a78bfa", "#73869a"];

function percent(value: number, total: number) {
  return total === 0 ? "0%" : `${((value / total) * 100).toFixed(1)}%`;
}

function EmptyList({ children }: { children: string }) {
  return <p className="muted">{children}</p>;
}

function ThreatActivityGraph({ data }: { data: AnalyticsResponse["trend"] }) {
  if (data.length === 0) return <div className="panel-body"><EmptyList>No event activity is available for this period.</EmptyList></div>;
  const width = 960;
  const height = 260;
  const bounds = { top: 16, right: 18, bottom: 38, left: 48 };
  const graphWidth = width - bounds.left - bounds.right;
  const graphHeight = height - bounds.top - bounds.bottom;
  const maximum = Math.max(1, ...data.flatMap((row) => [row.detected, row.blocked]));
  const x = (index: number) => bounds.left + (index / Math.max(1, data.length - 1)) * graphWidth;
  const y = (value: number) => bounds.top + (1 - value / maximum) * graphHeight;
  const path = (key: "detected" | "blocked") => data.map((row, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`).join(" ");
  const detectedPath = path("detected");
  const blockedPath = path("blocked");
  const areaPath = `${detectedPath} L${x(data.length - 1).toFixed(1)},${(bounds.top + graphHeight).toFixed(1)} L${x(0).toFixed(1)},${(bounds.top + graphHeight).toFixed(1)} Z`;
  const yTicks = Array.from(new Set([maximum, Math.round(maximum * 0.66), Math.round(maximum * 0.33), 0]));
  const labelIndexes = Array.from(new Set([0, Math.round((data.length - 1) * 0.25), Math.round((data.length - 1) * 0.5), Math.round((data.length - 1) * 0.75), data.length - 1]));
  const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });

  return <figure className="analytics-trend" aria-labelledby="threat-activity-caption">
    <div className="analytics-legend" aria-hidden="true"><span><i className="legend-detected"/>Detected <strong>{number.format(data.reduce((sum, row) => sum + row.detected, 0))}</strong></span><span><i className="legend-blocked"/>Blocked <strong>{number.format(data.reduce((sum, row) => sum + row.blocked, 0))}</strong></span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="threat-activity-title threat-activity-desc" preserveAspectRatio="none">
      <title id="threat-activity-title">Daily detected and blocked security events</title>
      <desc id="threat-activity-desc">Thirty-day line graph comparing all detected events with events that were blocked or rate limited.</desc>
      <defs><linearGradient id="detected-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--info)" stopOpacity=".2"/><stop offset="100%" stopColor="var(--info)" stopOpacity="0"/></linearGradient></defs>
      {yTicks.map((tick) => <g key={tick}><line className="analytics-gridline" x1={bounds.left} x2={width - bounds.right} y1={y(tick)} y2={y(tick)}/><text className="analytics-axis-label" x={bounds.left - 12} y={y(tick) + 4} textAnchor="end">{number.format(tick)}</text></g>)}
      <path className="analytics-area" d={areaPath}/>
      <path className="analytics-line detected-line" d={detectedPath}/>
      <path className="analytics-line blocked-line" d={blockedPath}/>
      {labelIndexes.map((index) => <text className="analytics-axis-label" key={index} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{dateLabel(data[index]!.date)}</text>)}
    </svg>
    <figcaption id="threat-activity-caption">Daily activity for the last 30 days. Blocked includes firewall blocks and rate limits.</figcaption>
  </figure>;
}

export default async function AnalyticsPage() {
  const analytics = await apiGet<AnalyticsResponse>("/v1/analytics");
  const assessedThreats = analytics.byThreat.reduce((total, row) => total + row._count._all, 0);
  const maximumCountry = Math.max(...analytics.byCountry.map((row) => row._count._all), 0);
  const maximumSite = Math.max(...analytics.bySite.map((row) => row._count._all), 0);

  return <>
    <PageHeader title="Threat analytics" description="Live 30-day patterns across sensor events, assets, protocols, sources, and outcomes." />
    <div className="metric-grid">
      <MetricCard label="Detected events" value={number.format(analytics.totalEvents)} note="Received in the last 30 days" icon={Activity} />
      <MetricCard label="Blocked outcomes" value={number.format(analytics.blockedEvents)} note={`${percent(analytics.blockedEvents, analytics.totalEvents)} of detected events`} icon={Flame} />
      <MetricCard label="Critical assessments" value={number.format(analytics.criticalAssessments)} note="Completed AI assessments" icon={ShieldAlert} />
      <MetricCard label="Reporting assets shown" value={number.format(analytics.bySite.length)} note="Top 10 assets with events in this period" icon={Waypoints} />
    </div>
    <Panel title="Threat activity" description="Detected and blocked outcomes by day across the last 30 days" className="analytics-trend-panel">
      <ThreatActivityGraph data={analytics.trend} />
    </Panel>
    <div className="dashboard-grid">
      <Panel title="Threat classes" description="Completed AI assessments in the last 30 days">
        <div className="panel-body chart-list">
          {analytics.byThreat.length === 0 ? <EmptyList>No completed threat assessments in this period.</EmptyList> : analytics.byThreat.map((row, index) => {
            const label = row.threatType?.replaceAll("_", " ") ?? "Unclassified";
            return <div className="chart-list-row" key={row.threatType ?? "unclassified"}>
              <i style={{ background: palette[index % palette.length] }} />
              <span>{label} <span className="muted">{percent(row._count._all, assessedThreats)}</span></span>
              <strong>{number.format(row._count._all)}</strong>
            </div>;
          })}
        </div>
      </Panel>
      <Panel title="Events by asset" description="Top reporting sensors in the last 30 days">
        <div className="panel-body chart-list">
          {analytics.bySite.length === 0 ? <EmptyList>No asset activity in this period.</EmptyList> : analytics.bySite.map((row) => <div key={row.siteId} style={{ display: "grid", gridTemplateColumns: "minmax(100px, 1fr) 2fr 55px", gap: 12, alignItems: "center", fontSize: 12 }}>
            <span>{row.name}</span>
            <div className="progress"><span style={{ width: `${maximumSite === 0 ? 0 : (row._count._all / maximumSite) * 100}%`, background: "var(--info)" }} /></div>
            <strong style={{ textAlign: "right" }}>{number.format(row._count._all)}</strong>
          </div>)}
        </div>
      </Panel>
    </div>
    <div className="dashboard-grid">
      <Panel title="Top reported country codes" description="Country values present on stored event records">
        <div className="panel-body chart-list">
          {analytics.byCountry.length === 0 ? <EmptyList>No country data is stored for events in this period.</EmptyList> : analytics.byCountry.map((row) => <div key={row.countryCode ?? "unknown"} style={{ display: "grid", gridTemplateColumns: "110px 1fr 55px", gap: 12, alignItems: "center", fontSize: 12 }}>
            <span>{row.countryCode ?? "Unknown"}</span>
            <div className="progress"><span style={{ width: `${maximumCountry === 0 ? 0 : (row._count._all / maximumCountry) * 100}%`, background: "var(--info)" }} /></div>
            <strong style={{ textAlign: "right" }}>{number.format(row._count._all)}</strong>
          </div>)}
        </div>
      </Panel>
      <Panel title="Events by protocol" description="HTTP and network-service telemetry">
        <div className="panel-body chart-list">
          {analytics.byProtocol.length === 0 ? <EmptyList>No protocol data in this period.</EmptyList> : analytics.byProtocol.map((row) => <div className="check-row" key={row.protocol ?? "unknown"}>
            <span>{row.protocol ?? "Unknown"}</span><strong>{number.format(row._count._all)}</strong>
          </div>)}
        </div>
      </Panel>
      <Panel title="Most targeted routes" description="Normalized request paths from live events">
        <div className="panel-body chart-list">
          {analytics.topRoutes.length === 0 ? <EmptyList>No routes detected in this period.</EmptyList> : analytics.topRoutes.map((row) => <div className="check-row" key={row.path}>
            <span className="mono">{row.path}</span><strong>{number.format(row._count._all)}</strong>
          </div>)}
        </div>
      </Panel>
    </div>
  </>;
}
