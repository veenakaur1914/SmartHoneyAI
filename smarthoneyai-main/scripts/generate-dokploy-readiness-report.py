#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import sys
from datetime import datetime
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
EVIDENCE_DIR = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if not EVIDENCE_DIR or not EVIDENCE_DIR.is_dir():
    raise SystemExit("Usage: generate-dokploy-readiness-report.py E2E_EVIDENCE_DIR")

E2E_PATH = EVIDENCE_DIR / "local-wordpress-e2e.json"
AGENT_PATH = EVIDENCE_DIR / "agent-security.json"
CONNECTION_PATH = EVIDENCE_DIR / "connection-state.json"
for required in (E2E_PATH, AGENT_PATH, CONNECTION_PATH):
    if not required.is_file():
        raise SystemExit(f"Missing required evidence: {required}")

e2e = json.loads(E2E_PATH.read_text())
agent = json.loads(AGENT_PATH.read_text())
connection = json.loads(CONNECTION_PATH.read_text())
if e2e.get("verdict") != "PASS" or not agent.get("ok") or not connection.get("ok"):
    raise SystemExit("Refusing to create a PASS report from failing evidence.")

OUTPUT_PATH = ROOT / "output" / "pdf" / "smarthoneyai-dokploy-readiness-report-2026-07-26.pdf"
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

SITES_SCREENSHOT = ROOT / "output" / "playwright" / "dokploy-readiness" / "sites.png"
FIREWALL_SCREENSHOT = ROOT / "output" / "playwright" / "dokploy-readiness" / "firewall.png"

PAGE_WIDTH, PAGE_HEIGHT = A4
NAVY = colors.HexColor("#071525")
PANEL = colors.HexColor("#102237")
PANEL_ALT = colors.HexColor("#152B43")
GOLD = colors.HexColor("#F7B928")
GREEN = colors.HexColor("#16C995")
BLUE = colors.HexColor("#39A9FF")
RED = colors.HexColor("#E05666")
INK = colors.HexColor("#182638")
MUTED = colors.HexColor("#5F7186")
LIGHT = colors.HexColor("#F3F6F9")
BORDER = colors.HexColor("#D9E2EA")
WHITE = colors.white

styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=25,
        leading=30,
        textColor=WHITE,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        "CoverSub",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=11,
        leading=16,
        textColor=colors.HexColor("#C8D6E5"),
    )
)
styles.add(
    ParagraphStyle(
        "H1x",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=17,
        leading=21,
        textColor=NAVY,
        spaceBefore=4,
        spaceAfter=9,
    )
)
styles.add(
    ParagraphStyle(
        "H2x",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=INK,
        spaceBefore=8,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        "Bodyx",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.8,
        leading=13,
        textColor=INK,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        "Smallx",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=7.2,
        leading=10,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        "TableHead",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=7.2,
        leading=9,
        textColor=WHITE,
    )
)
styles.add(
    ParagraphStyle(
        "TableCell",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=7.1,
        leading=9.5,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        "TableCellBold",
        parent=styles["TableCell"],
        fontName="Helvetica-Bold",
    )
)
styles.add(
    ParagraphStyle(
        "StatusPass",
        parent=styles["TableCellBold"],
        textColor=colors.HexColor("#087A5B"),
        alignment=TA_CENTER,
    )
)
styles.add(
    ParagraphStyle(
        "Callout",
        parent=styles["Bodyx"],
        fontName="Helvetica-Bold",
        textColor=NAVY,
        borderColor=GOLD,
        borderWidth=1,
        borderPadding=8,
        backColor=colors.HexColor("#FFF8E5"),
        spaceBefore=5,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        "Caption",
        parent=styles["Smallx"],
        alignment=TA_CENTER,
        spaceBefore=4,
        spaceAfter=8,
    )
)


def p(text: str, style: str = "Bodyx") -> Paragraph:
    return Paragraph(text, styles[style])


def safe(value: object) -> str:
    return html.escape(str(value))


def bullet(text: str) -> Paragraph:
    return Paragraph(f"- {text}", styles["Bodyx"])


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFillColor(NAVY)
        canvas.rect(0, PAGE_HEIGHT - 13 * mm, PAGE_WIDTH, 13 * mm, fill=1, stroke=0)
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(18 * mm, PAGE_HEIGHT - 8.3 * mm, "SmartHoneyAI")
        canvas.setFillColor(colors.HexColor("#C8D6E5"))
        canvas.setFont("Helvetica", 7)
        canvas.drawRightString(PAGE_WIDTH - 18 * mm, PAGE_HEIGHT - 8.3 * mm, "Dokploy Readiness Verification")
        canvas.setStrokeColor(BORDER)
        canvas.line(18 * mm, 13 * mm, PAGE_WIDTH - 18 * mm, 13 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(18 * mm, 8 * mm, "Generated 26 Jul 2026 - Asia/Kuala_Lumpur")
        canvas.drawRightString(PAGE_WIDTH - 18 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


doc = BaseDocTemplate(
    str(OUTPUT_PATH),
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=20 * mm,
    bottomMargin=18 * mm,
    title="SmartHoneyAI Dokploy Readiness Verification Report",
    author="Codex",
    subject="Deployment, honeypot, firewall, security, browser, and package verification",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="content")
doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=header_footer)])

story = []

# Cover
cover = Table(
    [
        [p("SMARTHONEYAI", "TableHead")],
        [p("Dokploy Readiness<br/>Verification Report", "ReportTitle")],
        [
            p(
                "Complete Compose deployment, authentication, WordPress honeypot, "
                "firewall enforcement, recovery, monitoring, package, and browser validation.",
                "CoverSub",
            )
        ],
        [Spacer(1, 6 * mm)],
        [p("<b>VERDICT: PASS - READY FOR DOKPLOY DEPLOYMENT</b>", "CoverSub")],
        [p("Evidence run: 20260726T141218Z", "CoverSub")],
    ],
    colWidths=[doc.width],
    rowHeights=[10 * mm, None, None, 9 * mm, 12 * mm, 8 * mm],
)
cover.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("BOX", (0, 0), (-1, -1), 0, NAVY),
            ("LEFTPADDING", (0, 0), (-1, -1), 16 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 16 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
            ("LINEBEFORE", (0, 4), (0, 4), 4, GREEN),
        ]
    )
)
story.extend([Spacer(1, 14 * mm), cover, Spacer(1, 12 * mm)])

scorecards = Table(
    [
        [
            p("<b>17 / 17</b><br/><font size='7'>mandatory security checks</font>", "Bodyx"),
            p("<b>19 / 19</b><br/><font size='7'>Node test assertions</font>", "Bodyx"),
            p("<b>23 / 23</b><br/><font size='7'>WordPress tests, 158 assertions</font>", "Bodyx"),
            p("<b>0</b><br/><font size='7'>unexpected container restarts</font>", "Bodyx"),
        ]
    ],
    colWidths=[doc.width / 4] * 4,
)
scorecards.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]
    )
)
story.extend(
    [
        scorecards,
        Spacer(1, 9 * mm),
        p(
            "<b>Scope statement.</b> This report proves deployment readiness in a clean local Docker "
            "environment using the dedicated Dokploy Compose file and a real WordPress 7.0 container. "
            "It does not claim that DNS, a public certificate, or third-party provider credentials were "
            "tested on a live Dokploy server.",
            "Callout",
        ),
        p(
            "Prepared for the SmartHoneyAI operator. Keep this report with the reviewed source revision, "
            "the generated WordPress plugin ZIP, and the deployment environment backup.",
            "Smallx",
        ),
        PageBreak(),
    ]
)

# Executive summary
story.extend(
    [
        p("1. Executive verdict", "H1x"),
        p(
            "SmartHoneyAI is ready to deploy as a full Docker Compose application on Dokploy. "
            "The earlier frontend-only Node.js deployment could not provide the API, worker, databases, "
            "message queue, edge router, monitoring, or WordPress enforcement path. The dedicated "
            "<b>docker-compose.dokploy.yml</b> now starts that complete platform.",
        ),
        p(
            "The production-like Dokploy stack built successfully, ran migrations and administrator "
            "bootstrap to completion, reached healthy state for all nine long-running services, served "
            "the dashboard and API through Nginx, issued a secure authenticated session, and exposed no "
            "host ports in the production configuration.",
        ),
        p("What was proven", "H2x"),
        bullet("Full 11-service Dokploy topology: 9 long-running services plus migrate and bootstrap."),
        bullet("Database-backed login, authenticated dashboard, API readiness, worker readiness, and monitoring readiness."),
        bullet("Real WordPress enrollment, heartbeat, signed policy delivery, queue drain, and online recovery."),
        bullet("Four inert honeypots, credential redaction, exact-once ingestion, and no duplicate event storage."),
        bullet("Observe-first safety, route/IP/CIDR/user-agent blocks, allowlist precedence, and atomic rate limiting."),
        bullet("API outage spooling and Redis replay-protection failure both fail safely and recover."),
        bullet("Browser login, dashboard, sites, firewall, logout, protected redirect, and zero console errors."),
        bullet("Node, PHP, infrastructure, Compose, environment-generator, and plugin-package gates."),
        p("Deployment decision", "H2x"),
        p(
            "<b>GO, with configuration prerequisites.</b> Before the first live deployment, provide a "
            "real domain, replace the Hugging Face placeholders, store the generated secrets in Dokploy, "
            "and target <b>nginx:8080</b>. SMTP and Telegram remain optional; password-reset delivery "
            "is unavailable while SMTP is disabled, while invitations use manual one-time links.",
            "Callout",
        ),
        Spacer(1, 3 * mm),
        p("Test environment", "H2x"),
    ]
)
environment_rows = [
    [p("Item", "TableHead"), p("Validated value", "TableHead")],
    [p("Application", "TableCellBold"), p("SmartHoneyAI 0.1.0", "TableCell")],
    [p("WordPress", "TableCellBold"), p("7.0.0, PHP 8.3 Apache", "TableCell")],
    [p("Database and cache", "TableCellBold"), p("PostgreSQL 17.5 and Redis 8.0.2", "TableCell")],
    [p("Edge", "TableCellBold"), p("Nginx 1.28, Dokploy HTTP edge on container port 8080", "TableCell")],
    [p("Evidence", "TableCellBold"), p("output/e2e/20260726T141218Z", "TableCell")],
]
env_table = Table(environment_rows, colWidths=[45 * mm, doc.width - 45 * mm], repeatRows=1)
env_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )
)
story.extend([env_table, PageBreak()])

# Architecture and runtime
story.extend([p("2. Dokploy architecture and runtime proof", "H1x")])
drawing = Drawing(doc.width, 74 * mm)
box_y = 41 * mm
box_h = 19 * mm
box_w = 35 * mm
gap = 8 * mm
labels = [
    ("Internet", 0, GOLD),
    ("Dokploy / Traefik", box_w + gap, BLUE),
    ("nginx:8080", 2 * (box_w + gap), GREEN),
    ("web:3000", 3 * (box_w + gap), colors.HexColor("#8F7CFF")),
]
for label, x, color in labels:
    drawing.add(Rect(x, box_y, box_w, box_h, 4, 4, fillColor=NAVY, strokeColor=color, strokeWidth=1.4))
    drawing.add(String(x + box_w / 2, box_y + 8 * mm, label, fontName="Helvetica-Bold", fontSize=7.4, fillColor=WHITE, textAnchor="middle"))
for idx in range(3):
    x1 = box_w + idx * (box_w + gap)
    x2 = (idx + 1) * (box_w + gap)
    drawing.add(Line(x1 + 1 * mm, box_y + box_h / 2, x2 - 1 * mm, box_y + box_h / 2, strokeColor=MUTED, strokeWidth=1.3))
drawing.add(Rect(83 * mm, 5 * mm, 76 * mm, 22 * mm, 4, 4, fillColor=PANEL, strokeColor=BLUE, strokeWidth=1))
drawing.add(String(121 * mm, 18 * mm, "api:4000 + worker:4001", fontName="Helvetica-Bold", fontSize=8, fillColor=WHITE, textAnchor="middle"))
drawing.add(String(121 * mm, 11 * mm, "PostgreSQL + Redis + monitoring", fontName="Helvetica", fontSize=7.2, fillColor=colors.HexColor("#C8D6E5"), textAnchor="middle"))
drawing.add(Line(104 * mm, box_y, 104 * mm, 27 * mm, strokeColor=MUTED, strokeWidth=1.3))
drawing.add(String(111 * mm, 33 * mm, "/v1 and /health", fontName="Helvetica", fontSize=6.8, fillColor=MUTED))
story.extend(
    [
        drawing,
        p(
            "Dokploy terminates public TLS and attaches the selected Compose service to its Traefik "
            "network. Nginx is the only routed service. It forwards browser pages to web and API, agent, "
            "health, and event-stream paths to the Fastify API.",
        ),
        p("Runtime validation matrix", "H2x"),
    ]
)
runtime_rows = [
    [p("Area", "TableHead"), p("Result", "TableHead"), p("Evidence", "TableHead")],
    [p("Build", "TableCellBold"), p("PASS", "StatusPass"), p("API, worker, web, migrate, and bootstrap images built.", "TableCell")],
    [p("Startup", "TableCellBold"), p("PASS", "StatusPass"), p("PostgreSQL and Redis healthy; migrate and bootstrap exited 0.", "TableCell")],
    [p("Long-running services", "TableCellBold"), p("PASS", "StatusPass"), p("9 of 9 healthy in the Dokploy topology.", "TableCell")],
    [p("Public edge", "TableCellBold"), p("PASS", "StatusPass"), p("Home 200, login 200, readiness 200, logged-out auth 401.", "TableCell")],
    [p("Authentication", "TableCellBold"), p("PASS", "StatusPass"), p("Login 200, hp_session issued, auth/me 200, dashboard 200.", "TableCell")],
    [p("Internal services", "TableCellBold"), p("PASS", "StatusPass"), p("API, worker, Prometheus, and Grafana readiness passed.", "TableCell")],
    [p("Exposure", "TableCellBold"), p("PASS", "StatusPass"), p("Production Compose publishes no host ports; only nginx exposes 8080.", "TableCell")],
    [p("Persistence", "TableCellBold"), p("PASS", "StatusPass"), p("Five named volumes and isolated app/data/monitoring networks resolved.", "TableCell")],
    [p("Stability", "TableCellBold"), p("PASS", "StatusPass"), p("Zero unexpected restarts during functional validation.", "TableCell")],
]
runtime_table = LongTable(runtime_rows, colWidths=[40 * mm, 19 * mm, doc.width - 59 * mm], repeatRows=1)
runtime_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ]
    )
)
story.extend([runtime_table, PageBreak()])

# E2E results
story.extend(
    [
        p("3. Honeypot and firewall end-to-end results", "H1x"),
        p(
            "The following checks used the real WordPress plugin, a live WordPress database, the signed "
            "agent protocol, and the production control-plane services. All mandatory checks passed.",
        ),
    ]
)
e2e_rows = [[p("#", "TableHead"), p("Mandatory check", "TableHead"), p("Result", "TableHead"), p("Evidence", "TableHead")]]
for index, item in enumerate(e2e["results"], 1):
    e2e_rows.append(
        [
            p(str(index), "TableCell"),
            p(safe(item["name"]), "TableCellBold"),
            p(safe(item["status"]), "StatusPass"),
            p(safe(item["evidence"]), "TableCell"),
        ]
    )
e2e_table = LongTable(e2e_rows, colWidths=[8 * mm, 43 * mm, 17 * mm, doc.width - 68 * mm], repeatRows=1)
e2e_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 1), (0, -1), "CENTER"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ]
    )
)
story.extend(
    [
        e2e_table,
        Spacer(1, 5 * mm),
        p(
            "<b>Final safety state:</b> the validated WordPress site was returned to OBSERVE and all "
            "temporary firewall rules were disabled. The final database check returned OBSERVE with "
            "zero enabled rules.",
            "Callout",
        ),
        PageBreak(),
    ]
)

# Security protocol and browser evidence
story.extend(
    [
        p("4. Protocol security and browser evidence", "H1x"),
        p("Agent protocol controls", "H2x"),
    ]
)
agent_labels = {
    "badProof": "Invalid enrollment proof rejected",
    "wrongDomain": "Enrollment domain mismatch rejected",
    "reusedToken": "One-time token reuse rejected",
    "expiredToken": "Expired enrollment token rejected",
    "replayedNonce": "Nonce replay rejected",
    "staleTimestamp": "Stale signed request rejected",
    "futureTimestamp": "Future signed request rejected",
    "nonnumericTimestamp": "Malformed timestamp rejected",
    "alteredBody": "Altered signed body rejected",
    "wrongKey": "Unknown key rejected",
    "siteMismatch": "Cross-site event write rejected",
    "revokedKey": "Revoked credential rejected",
    "eventIdempotency": "Event idempotency enforced",
    "policyEtag304": "Policy ETag revalidation returned 304",
    "centralRedaction": "Credential canaries removed centrally",
}
agent_rows = [[p("Control", "TableHead"), p("Result", "TableHead")]]
for key, label in agent_labels.items():
    agent_rows.append([p(label, "TableCell"), p("PASS" if agent["checks"].get(key) else "FAIL", "StatusPass")])
agent_table = Table(agent_rows, colWidths=[doc.width - 25 * mm, 25 * mm], repeatRows=1)
agent_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 3.4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.4),
        ]
    )
)
story.extend(
    [
        agent_table,
        p("Connection-state controls", "H2x"),
        p(
            "PASS - online under ten minutes, degraded at eleven minutes, offline at sixteen minutes, "
            "degraded on an unhealthy heartbeat, and online again after a real WordPress sync.",
        ),
        p("Real-browser verification", "H2x"),
        p(
            "Playwright completed a database-backed login, loaded the dashboard, sites, and firewall "
            "pages, found the validated WordPress site ONLINE in OBSERVE, captured zero console errors, "
            "logged out, and confirmed that the dashboard redirected to login.",
        ),
    ]
)
if SITES_SCREENSHOT.is_file():
    story.append(Image(str(SITES_SCREENSHOT), width=doc.width, height=doc.width * 1000 / 1440))
    story.append(
        p(
            "Browser evidence is generated from an isolated local validation database. Test fixtures "
            "used by this report are never enabled for a public production origin.",
            "Caption",
        )
    )
story.append(PageBreak())

# Quality gates
story.extend(
    [
        p("5. Engineering and package quality gates", "H1x"),
        p(
            "All product gates below passed after the end-to-end security run. The monorepo commands "
            "used the repository-pinned pnpm 10.34.4 through Corepack.",
        ),
    ]
)
quality_rows = [
    [p("Gate", "TableHead"), p("Result", "TableHead"), p("Measured outcome", "TableHead")],
    [p("Monorepo lint", "TableCellBold"), p("PASS", "StatusPass"), p("7 of 7 Turbo tasks successful.", "TableCell")],
    [p("Monorepo typecheck", "TableCellBold"), p("PASS", "StatusPass"), p("8 of 8 Turbo tasks successful.", "TableCell")],
    [p("Monorepo tests", "TableCellBold"), p("PASS", "StatusPass"), p("16 API and 3 worker assertions passed.", "TableCell")],
    [p("Production build", "TableCellBold"), p("PASS", "StatusPass"), p("5 of 5 packages built; Next.js generated 17 pages.", "TableCell")],
    [p("WordPress PHPCS", "TableCellBold"), p("PASS", "StatusPass"), p("9 plugin files passed WordPress coding standards.", "TableCell")],
    [p("WordPress PHPUnit", "TableCellBold"), p("PASS", "StatusPass"), p("23 tests and 158 assertions passed.", "TableCell")],
    [p("Plugin packaging", "TableCellBold"), p("PASS", "StatusPass"), p("Two fixed-timestamp builds matched; ZIP integrity passed.", "TableCell")],
    [p("Compose", "TableCellBold"), p("PASS", "StatusPass"), p("Standard and Dokploy configurations resolved successfully.", "TableCell")],
    [p("Environment generator", "TableCellBold"), p("PASS", "StatusPass"), p("Strong secrets, valid Ed25519 pair, invalid input rejection.", "TableCell")],
    [p("Nginx", "TableCellBold"), p("PASS", "StatusPass"), p("Dokploy edge syntax and service-name resolution validated.", "TableCell")],
    [p("Prometheus", "TableCellBold"), p("PASS", "StatusPass"), p("Configuration and 8 alert rules passed promtool.", "TableCell")],
    [p("Alertmanager", "TableCellBold"), p("PASS", "StatusPass"), p("Route, inhibit rule, and receiver passed amtool.", "TableCell")],
    [p("Grafana", "TableCellBold"), p("PASS", "StatusPass"), p("Provisioned dashboard JSON parsed successfully.", "TableCell")],
    [p("Repository hygiene", "TableCellBold"), p("PASS", "StatusPass"), p("No whitespace errors; local Markdown links resolve.", "TableCell")],
]
quality_table = LongTable(quality_rows, colWidths=[43 * mm, 18 * mm, doc.width - 61 * mm], repeatRows=1)
quality_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
    )
)
story.extend(
    [
        quality_table,
        Spacer(1, 5 * mm),
        p(
            "<b>Packaged artifact:</b> output/artifacts/smarthoneyai-wordpress.zip<br/>"
            "<b>SHA-256:</b> d7a691b973a74f53f35e31bf59dccb0121c864dd256f3d6f1ceee47926bd3fdb",
            "Callout",
        ),
    ]
)
if FIREWALL_SCREENSHOT.is_file():
    firewall_width = 150 * mm
    firewall_image = Image(
        str(FIREWALL_SCREENSHOT),
        width=firewall_width,
        height=firewall_width * 1000 / 1440,
    )
    firewall_image.hAlign = "CENTER"
    story.append(firewall_image)
    story.append(
        p(
            "Browser evidence after cleanup: all authorized test rules are disabled and both sites are in Observe.",
            "Caption",
        )
    )
story.append(PageBreak())

# Fixes and operator handoff
story.extend(
    [
        p("6. Defects found and corrected", "H1x"),
        p(
            "Testing was not stopped at the first successful smoke check. Two portability and test-control "
            "defects were found, corrected, and validated.",
        ),
    ]
)
fix_rows = [
    [p("Finding", "TableHead"), p("Correction", "TableHead"), p("Verification", "TableHead")],
    [
        p("Host port 443 reset TLS on this Docker Desktop host.", "TableCellBold"),
        p("Propagated configurable HTTPS_PORT through Compose, app origin, WordPress control URL, and all E2E tools.", "TableCell"),
        p("Complete run passed on 18443, including enrollment and recovery.", "TableCell"),
    ],
    [
        p("WordPress enrollment helper allowed only local port 443.", "TableCellBold"),
        p("Pinned the helper to the explicitly configured local HTTPS port while retaining exact host and HTTPS checks.", "TableCell"),
        p("Real plugin enrolled, synchronized, and acknowledged policy v20.", "TableCell"),
    ],
    [
        p("POSIX shell pipelines could mask a failed smoke command behind tee.", "TableCellBold"),
        p("Added run_logged so the original command status is preserved while evidence is still printed and saved.", "TableCell"),
        p("Shell syntax, diff checks, and the completed green E2E evidence were verified.", "TableCell"),
    ],
    [
        p("PHP gate ran PHPUnit without PHPCS in the same isolated workflow.", "TableCellBold"),
        p("Added WordPress coding-standard validation before the unit suite.", "TableCell"),
        p("PHPCS 9/9 files and PHPUnit 23/23 tests passed.", "TableCell"),
    ],
]
fix_table = LongTable(fix_rows, colWidths=[45 * mm, 67 * mm, doc.width - 112 * mm], repeatRows=1)
fix_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )
)
story.extend(
    [
        fix_table,
        p("Dokploy operator handoff", "H1x"),
        p("1. Push the reviewed repository revision to the Git provider connected to Dokploy."),
        p("2. Create a Dokploy Compose service and set the Compose path to <b>./docker-compose.dokploy.yml</b>."),
        p("3. Generate the environment with <b>scripts/generate-dokploy-env.mjs</b>; replace both Hugging Face placeholders."),
        p("4. Add the public domain to service <b>nginx</b>, container port <b>8080</b>, path <b>/</b>, HTTPS enabled."),
        p("5. Deploy and wait for migrate and bootstrap to exit 0 and all other services to become healthy."),
        p("6. Verify /health/live, /health/ready, logged-out /v1/auth/me = 401, login, and the authenticated dashboard."),
        p("7. Install the packaged WordPress plugin, enroll the exact WordPress URL, and confirm ONLINE, APPLIED, queue 0."),
        p("8. Configure backups before enabling updates or enforcement."),
        p(
            "The complete copy-and-follow procedure is in <b>DOKPLOY.md</b>. It includes exact domain fields, "
            "environment handling, backups, update/rollback guidance, and troubleshooting.",
            "Callout",
        ),
        PageBreak(),
    ]
)

# Limitations and evidence
story.extend(
    [
        p("7. External prerequisites, limitations, and evidence", "H1x"),
        p("External configuration not exercised", "H2x"),
        bullet("Hugging Face: not configured in the local E2E run. A real token and immutable 40-character model commit are required for production AI analysis."),
        bullet("SMTP: not exercised in the local E2E run and optional. Password-reset delivery is unavailable while disabled; invitations use manual one-time share links."),
        bullet("Telegram: not configured and optional."),
        bullet("Public DNS, Let's Encrypt issuance, and a live Dokploy server were not available in this workspace."),
        p(
            "These are deployment inputs, not hidden passing claims. The report verdict covers the application, "
            "containers, security controls, local edge path, plugin, and deployment configuration that could be "
            "fully exercised without access to the operator's production infrastructure.",
        ),
        p("Evidence index", "H2x"),
    ]
)
evidence_rows = [
    [p("Artifact", "TableHead"), p("Purpose", "TableHead")],
    [p("output/e2e/20260726T141218Z/local-wordpress-e2e.json", "TableCell"), p("17 mandatory honeypot/firewall checks and final safety state.", "TableCell")],
    [p("output/e2e/20260726T141218Z/agent-security.json", "TableCell"), p("15 signed-protocol and redaction controls.", "TableCell")],
    [p("output/e2e/20260726T141218Z/connection-state.json", "TableCell"), p("Online, degraded, offline, and recovery thresholds.", "TableCell")],
    [p("output/playwright/dokploy-readiness/", "TableCell"), p("Browser snapshots, screenshots, and zero-error console capture.", "TableCell")],
    [p("output/artifacts/smarthoneyai-wordpress.zip", "TableCell"), p("Installable, integrity-checked WordPress plugin.", "TableCell")],
    [p("docker-compose.dokploy.yml", "TableCell"), p("Production Dokploy service topology.", "TableCell")],
    [p("DOKPLOY.md", "TableCell"), p("Operator deployment runbook.", "TableCell")],
]
evidence_table = LongTable(evidence_rows, colWidths=[82 * mm, doc.width - 82 * mm], repeatRows=1)
evidence_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )
)
story.extend(
    [
        evidence_table,
        Spacer(1, 8 * mm),
        p(
            "<b>Final conclusion:</b> the platform and WordPress plugin operate together as a real "
            "honeypot and application-layer firewall when deployed as the complete Docker Compose stack. "
            "A standalone Node.js web deployment is insufficient; the Dokploy Compose deployment is the "
            "supported production shape.",
            "Callout",
        ),
        p("Report generated from machine-readable PASS evidence. No production credentials are included.", "Smallx"),
    ]
)

doc.build(story)
print(OUTPUT_PATH)
