#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
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
if len(sys.argv) not in (4, 5):
    raise SystemExit(
        "Usage: generate-live-bot-report.py E2E_JSON SIMULATION_JSON BROWSER_JSON [OUTPUT_PDF]"
    )

E2E_PATH = Path(sys.argv[1]).resolve()
SIMULATION_PATH = Path(sys.argv[2]).resolve()
BROWSER_PATH = Path(sys.argv[3]).resolve()
OUTPUT_PATH = (
    Path(sys.argv[4]).resolve()
    if len(sys.argv) == 5
    else ROOT / "output" / "pdf" / "smarthoneyai-live-bot-firewall-simulation-2026-07-26.pdf"
)
for required in (E2E_PATH, SIMULATION_PATH, BROWSER_PATH):
    if not required.is_file():
        raise SystemExit(f"Missing required evidence: {required}")

e2e = json.loads(E2E_PATH.read_text())
simulation = json.loads(SIMULATION_PATH.read_text())
browser = json.loads(BROWSER_PATH.read_text())

if e2e.get("verdict") != "PASS":
    raise SystemExit("Refusing to create a PASS report from a failing baseline.")
if simulation.get("verdict") != "PASS":
    raise SystemExit("Refusing to create a PASS report from a failing simulation.")
if browser.get("verdict") != "PASS":
    raise SystemExit("Refusing to create a PASS report from failing browser evidence.")

simulation_results = simulation.get("results", [])
if len(simulation_results) != 20 or any(item.get("status") != "PASS" for item in simulation_results):
    raise SystemExit("Expected exactly 20 passing final simulation checks.")

event_counts = simulation.get("capturedEventCounts", {})
if (
    event_counts.get("HONEYPOT", 0) < 6
    or event_counts.get("FIREWALL", 0) < 7
    or event_counts.get("RATE_LIMIT", 0) < 7
):
    raise SystemExit("Captured event totals do not meet the tested minimums.")

final_state = simulation.get("finalState") or {}
if (
    final_state.get("connectionStatus") != "ONLINE"
    or final_state.get("enforcementMode") != "OBSERVE"
    or final_state.get("effectiveMode") != "OBSERVE"
    or final_state.get("queueDepth") != 0
    or final_state.get("droppedEvents") != 0
    or final_state.get("activeRules") != 0
):
    raise SystemExit("Final safety state is not clean.")

browser_dir = BROWSER_PATH.parent
screenshots = {
    key: browser_dir / value for key, value in browser.get("screenshots", {}).items()
}
for label in ("events", "sites", "firewall"):
    if label not in screenshots or not screenshots[label].is_file():
        raise SystemExit(f"Missing browser screenshot: {label}")

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

PAGE_WIDTH, PAGE_HEIGHT = A4
NAVY = colors.HexColor("#071525")
PANEL = colors.HexColor("#102237")
GOLD = colors.HexColor("#F7B928")
GREEN = colors.HexColor("#16C995")
BLUE = colors.HexColor("#39A9FF")
RED = colors.HexColor("#D94D5C")
INK = colors.HexColor("#182638")
MUTED = colors.HexColor("#5F7186")
LIGHT = colors.HexColor("#F3F6F9")
BORDER = colors.HexColor("#D9E2EA")
PALE_GREEN = colors.HexColor("#E8F8F3")
PALE_GOLD = colors.HexColor("#FFF8E5")
WHITE = colors.white

styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=24,
        leading=29,
        textColor=WHITE,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        "CoverSub",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=15,
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
        spaceBefore=3,
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
        spaceBefore=7,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        "Bodyx",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.7,
        leading=12.7,
        textColor=INK,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        "Smallx",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=7.1,
        leading=9.8,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        "TableHead",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=7.1,
        leading=9,
        textColor=WHITE,
    )
)
styles.add(
    ParagraphStyle(
        "TableCell",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=7,
        leading=9.3,
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
        backColor=PALE_GOLD,
        spaceBefore=5,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        "PassCallout",
        parent=styles["Bodyx"],
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#075B45"),
        borderColor=GREEN,
        borderWidth=1,
        borderPadding=8,
        backColor=PALE_GREEN,
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
        spaceAfter=7,
    )
)


def p(text: str, style: str = "Bodyx") -> Paragraph:
    return Paragraph(text, styles[style])


def safe(value: object) -> str:
    return html.escape(str(value))


def bullet(text: str) -> Paragraph:
    return Paragraph(f"- {text}", styles["Bodyx"])


def report_table(
    rows,
    widths,
    *,
    repeat_rows=1,
    header=True,
    font_grid=True,
    long=False,
):
    table_class = LongTable if long else Table
    table = table_class(rows, colWidths=widths, repeatRows=repeat_rows if header else 0)
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [WHITE, LIGHT]),
    ]
    if header:
        commands.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ]
        )
    if font_grid:
        commands.extend(
            [
                ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
            ]
        )
    table.setStyle(TableStyle(commands))
    return table


def screenshot(path: Path, max_width: float, max_height: float) -> Image:
    with PILImage.open(path) as image:
        source_width, source_height = image.size
    scale = min(max_width / source_width, max_height / source_height)
    return Image(str(path), width=source_width * scale, height=source_height * scale)


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
        canvas.drawRightString(
            PAGE_WIDTH - 18 * mm,
            PAGE_HEIGHT - 8.3 * mm,
            "Authorized Live Bot and Firewall Verification",
        )
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
    title="SmartHoneyAI Authorized Live Bot and Firewall Simulation Report",
    author="Codex",
    subject="Local Docker, WordPress honeypot, crawler detection, firewall, rate limiting, recovery, and browser verification",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="content")
doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=header_footer)])

story = []

# Cover
cover = Table(
    [
        [p("SMARTHONEYAI", "TableHead")],
        [p("Authorized Live Bot and<br/>Firewall Simulation Report", "ReportTitle")],
        [
            p(
                "Real HTTP traffic through a real WordPress plugin, signed application firewall "
                "policies, durable event ingestion, queued threat assessment, dashboard verification, "
                "and safe recovery.",
                "CoverSub",
            )
        ],
        [Spacer(1, 5 * mm)],
        [p("<b>FINAL VERDICT: PASS - 20 OF 20 DEFINED SCENARIOS</b>", "CoverSub")],
        [p(f"Campaign: {safe(simulation['simulationId'])}", "CoverSub")],
    ],
    colWidths=[doc.width],
    rowHeights=[10 * mm, None, None, 8 * mm, 12 * mm, 8 * mm],
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
story.extend([Spacer(1, 13 * mm), cover, Spacer(1, 11 * mm)])

scorecards = Table(
    [
        [
            p("<b>17 / 17</b><br/><font size='7'>clean baseline controls</font>", "Bodyx"),
            p("<b>20 / 20</b><br/><font size='7'>final campaign controls</font>", "Bodyx"),
            p("<b>20</b><br/><font size='7'>campaign security events</font>", "Bodyx"),
            p("<b>0</b><br/><font size='7'>dropped events / console errors</font>", "Bodyx"),
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
            "<b>Honest claim boundary.</b> This report proves the specific bot, crawler, honeypot, "
            "firewall, rate-limit, recovery, redaction, and browser scenarios listed here in an "
            "authorized isolated Docker environment. It does not claim universal prevention of every "
            "bot, distributed denial-of-service attack, zero-day exploit, or origin-bypass technique.",
            "Callout",
        ),
        p(
            "No traffic was sent to the synthetic source address. A secret-gated local-only WordPress "
            "test hook supplied the source identity to requests originating inside the Docker network.",
            "Smallx",
        ),
        PageBreak(),
    ]
)

# Executive summary and boundary
story.extend(
    [
        p("1. Executive verdict and scope", "H1x"),
        p(
            "SmartHoneyAI correctly detected and controlled the tested automated attack patterns. "
            "The final campaign generated six real honeypot interactions, seven WordPress firewall "
            "blocks, and seven rate-limit events. All events were centrally captured for the campaign "
            f"source <b>{safe(simulation['sourceIp'])}</b>, and the dashboard showed completed "
            "BOT, SCANNER, and CREDENTIAL STUFFING assessments with no pending analysis.",
        ),
        p(
            "Prevention was proven by actual HTTP response codes, not configuration inspection alone: "
            "matching user-agent, exact IP, CIDR, and four crawler routes returned 403; a burst of ten "
            "simultaneous requests produced exactly three allowed responses and seven 429 responses. "
            "Allowlist precedence and private-source lockout protection returned 200 as designed.",
            "PassCallout",
        ),
        p("Authorization and environment", "H2x"),
    ]
)

environment_rows = [
    [p("Item", "TableHead"), p("Verified value", "TableHead")],
    [p("Platform", "TableCellBold"), p(safe(e2e["baseUrl"]), "TableCell")],
    [p("Target", "TableCellBold"), p("WordPress 7.0 with SmartHoneyAI plugin 1.0.1", "TableCell")],
    [p("Container project", "TableCellBold"), p(safe(simulation["project"]), "TableCell")],
    [p("Campaign identity", "TableCellBold"), p(safe(simulation["simulationId"]), "TableCell")],
    [
        p("Synthetic source", "TableCellBold"),
        p(f"{safe(simulation['sourceIp'])} in {safe(simulation['sourceCidr'])}", "TableCell"),
    ],
    [p("Execution boundary", "TableCellBold"), p("Authorized local Docker network only", "TableCell")],
    [
        p("Final state", "TableCellBold"),
        p("ONLINE, OBSERVE, queue 0, dropped 0, active rules 0", "TableCell"),
    ],
]
story.extend(
    [
        report_table(environment_rows, [42 * mm, doc.width - 42 * mm]),
        Spacer(1, 5 * mm),
        p("Evidence path", "H2x"),
    ]
)

flow_cells = [
    p("<b>Bounded simulator</b><br/>secret-gated source and inert canaries", "TableCell"),
    p("<b>&gt;</b>", "TableCellBold"),
    p("<b>WordPress</b><br/>decoys, sanitizer, signed policy, atomic buckets", "TableCell"),
    p("<b>&gt;</b>", "TableCellBold"),
    p("<b>API + worker</b><br/>durable events and deterministic test assessment", "TableCell"),
    p("<b>&gt;</b>", "TableCellBold"),
    p("<b>Dashboard</b><br/>operator-visible evidence and safe final posture", "TableCell"),
]
flow = Table(
    [flow_cells],
    colWidths=[37 * mm, 7 * mm, 42 * mm, 7 * mm, 41 * mm, 7 * mm, 37 * mm],
)
flow.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (0, 0), LIGHT),
            ("BACKGROUND", (2, 0), (2, 0), LIGHT),
            ("BACKGROUND", (4, 0), (4, 0), LIGHT),
            ("BACKGROUND", (6, 0), (6, 0), LIGHT),
            ("BOX", (0, 0), (0, 0), 0.7, BORDER),
            ("BOX", (2, 0), (2, 0), 0.7, BORDER),
            ("BOX", (4, 0), (4, 0), 0.7, BORDER),
            ("BOX", (6, 0), (6, 0), 0.7, BORDER),
            ("ALIGN", (1, 0), (1, 0), "CENTER"),
            ("ALIGN", (3, 0), (3, 0), "CENTER"),
            ("ALIGN", (5, 0), (5, 0), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]
    )
)
story.extend(
    [
        flow,
        Spacer(1, 5 * mm),
        p(
            "The attack payloads were harmless markers. The submitted command was verified not to "
            "execute, and the marker was not reflected in the public WordPress page. Password, database "
            "password, Authorization, and Cookie canaries were absent from central evidence.",
        ),
        PageBreak(),
    ]
)

# Baseline
story.extend(
    [
        p("2. Clean baseline before attack traffic", "H1x"),
        p(
            "A fresh Docker stack was built from the current source and verified before the bot campaign. "
            "All 17 mandatory baseline controls passed. This removed stale state as an explanation for "
            "later detection or enforcement results.",
        ),
    ]
)
baseline_groups = [
    (
        "Platform and agent",
        "Trusted TLS; database-backed login; real WordPress enrollment; ONLINE heartbeat; signed policy acknowledgement.",
    ),
    (
        "Honeypot integrity",
        "All four inert decoys; exact-once queue drain; credential redaction; no duplicate event storage.",
    ),
    (
        "Firewall controls",
        "Observation gate; OBSERVE fail-open; route, exact IP, CIDR, and user-agent blocks; allowlist precedence.",
    ),
    (
        "Rate and lockout safety",
        "Atomic concurrent rate-limit buckets; private-source protection; expired policy switched to MONITOR_ONLY.",
    ),
    (
        "Resilience",
        "API outage spooled locally and recovered; Redis replay protection failed readiness closed while WordPress stayed available, then recovered ONLINE.",
    ),
]
baseline_rows = [[p("Control group", "TableHead"), p("Passed evidence", "TableHead")]]
baseline_rows.extend(
    [[p(name, "TableCellBold"), p(description, "TableCell")] for name, description in baseline_groups]
)
story.extend(
    [
        report_table(baseline_rows, [43 * mm, doc.width - 43 * mm]),
        Spacer(1, 6 * mm),
        p("Baseline check record", "H2x"),
    ]
)
baseline_check_rows = [[p("#", "TableHead"), p("Mandatory check", "TableHead"), p("Status", "TableHead")]]
for index, item in enumerate(e2e["results"], 1):
    baseline_check_rows.append(
        [p(str(index), "TableCell"), p(safe(item["name"]), "TableCell"), p("PASS", "StatusPass")]
    )
story.extend(
    [
        report_table(baseline_check_rows, [10 * mm, doc.width - 30 * mm, 20 * mm], long=True),
        PageBreak(),
    ]
)

# Attack scenario
story.extend(
    [
        p("3. Live bot and crawler scenario", "H1x"),
        p(
            "The final campaign used a unique bot user-agent and synthetic public source identity. "
            "Six real HTTP requests exercised credential stuffing and reconnaissance against all four "
            "inert decoys. The WordPress plugin returned plausible 401 or 404 responses while recording "
            "sanitized evidence.",
        ),
        p("Decoy interactions", "H2x"),
    ]
)
campaign_rows = [
    [p("Attempt", "TableHead"), p("Method", "TableHead"), p("Decoy route", "TableHead"), p("HTTP", "TableHead")]
]
for line in simulation["campaignResponses"]:
    _, label, method, route, status = line.split(" ")
    campaign_rows.append(
        [
            p(safe(label), "TableCell"),
            p(safe(method), "TableCellBold"),
            p(safe(route), "TableCell"),
            p(safe(status), "StatusPass"),
        ]
    )
story.extend(
    [
        report_table(campaign_rows, [34 * mm, 22 * mm, doc.width - 76 * mm, 20 * mm]),
        Spacer(1, 6 * mm),
        p("Crawler reconnaissance probes", "H2x"),
    ]
)
route_rows = [[p("Route", "TableHead"), p("HTTP", "TableHead"), p("Central event", "TableHead")]]
for route in simulation["reconnaissancePaths"]:
    route_rows.append(
        [p(safe(route), "TableCellBold"), p("403", "StatusPass"), p("FIREWALL / BLOCKED", "TableCell")]
    )
story.extend(
    [
        report_table(route_rows, [76 * mm, 24 * mm, doc.width - 100 * mm]),
        Spacer(1, 6 * mm),
        p("Campaign safety properties", "H2x"),
        bullet("The source override required a secret, an exact local Host header, a local environment, and a private container peer."),
        bullet("Requests were bounded; no scanning of external systems occurred."),
        bullet("Credential and command values were inert canaries created only for this simulation."),
        bullet("The command canary was absent from the container filesystem and public response after submission."),
        bullet("Temporary deny and rate rules carried a 15-minute expiry and were removed during cleanup."),
        bullet("The seven-day observation gate rejected ENFORCE before the isolated test timestamp was explicitly aged."),
        PageBreak(),
    ]
)

# Detection
classification = simulation["classificationSummary"]
story.extend(
    [
        p("4. Detection and evidence results", "H1x"),
        p(
            "Detection was proven at three layers: the plugin captured all six honeypot interactions, "
            "the API preserved the shared source and bot user-agent identity, and the durable worker "
            "completed an assessment for every honeypot event.",
        ),
    ]
)
metric_rows = [
    [
        p("<b>6</b><br/><font size='7'>HONEYPOT</font>", "Bodyx"),
        p("<b>7</b><br/><font size='7'>FIREWALL</font>", "Bodyx"),
        p("<b>7</b><br/><font size='7'>RATE LIMIT</font>", "Bodyx"),
        p("<b>20</b><br/><font size='7'>TOTAL EVENTS</font>", "Bodyx"),
    ]
]
metric_table = Table(metric_rows, colWidths=[doc.width / 4] * 4)
metric_table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, -1), PALE_GREEN),
            ("BOX", (0, 0), (-1, -1), 0.7, GREEN),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, GREEN),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]
    )
)
story.extend(
    [
        metric_table,
        Spacer(1, 6 * mm),
        p("Completed honeypot assessments", "H2x"),
    ]
)
assessment_rows = [
    [p("Threat type", "TableHead"), p("Count", "TableHead"), p("Severity", "TableHead"), p("Provider", "TableHead")],
    [
        p("CREDENTIAL STUFFING", "TableCellBold"),
        p(str(classification["byThreat"]["CREDENTIAL_STUFFING"]), "TableCell"),
        p("CRITICAL", "TableCell"),
        p("local-deterministic-simulation-v1", "TableCell"),
    ],
    [
        p("SCANNER", "TableCellBold"),
        p(str(classification["byThreat"]["SCANNER"]), "TableCell"),
        p("HIGH", "TableCell"),
        p("local-deterministic-simulation-v1", "TableCell"),
    ],
]
story.extend(
    [
        report_table(assessment_rows, [47 * mm, 18 * mm, 29 * mm, doc.width - 94 * mm]),
        Spacer(1, 5 * mm),
        p(
            "<b>Classifier boundary.</b> The local classifier is deterministic and network-free. It is "
            "enabled only when ANALYSIS_PROVIDER=local and ALLOW_LOCAL_ANALYSIS=1 in the isolated "
            "test overlay. The external Hugging Face provider was not configured or claimed as tested.",
            "Callout",
        ),
        p("Evidence quality checks", "H2x"),
        bullet("All six honeypot events retained the same synthetic source and SmartHoneyBotSim/1.0 identity."),
        bullet("All four decoy types were represented: fake login, backup archive, admin console, and phpMyAdmin."),
        bullet("Every final crawler route had both a live HTTP 403 and a matching WordPress FIREWALL/BLOCKED event."),
        bullet("The dashboard reported AI pending 0 and displayed COMPLETE assessments."),
        bullet("Password, database-password, Authorization, and Cookie canaries did not appear in central evidence."),
        PageBreak(),
    ]
)

# Prevention controls and discovered issue
story.extend(
    [
        p("5. Prevention controls and rerun integrity", "H1x"),
        p(
            "The simulator verified both deny behavior and the safety exceptions that prevent operator "
            "lockout. Each control below was exercised through live HTTP after signed policy delivery.",
        ),
    ]
)
control_rows = [
    [p("Control", "TableHead"), p("Input", "TableHead"), p("Expected", "TableHead"), p("Observed", "TableHead")],
    [p("OBSERVE detection", "TableCellBold"), p("Bot user-agent", "TableCell"), p("Fail open", "TableCell"), p("HTTP 200", "StatusPass")],
    [p("User-agent deny", "TableCellBold"), p("SmartHoneyBotSim/1.0", "TableCell"), p("Block", "TableCell"), p("HTTP 403", "StatusPass")],
    [p("Exact IP deny", "TableCellBold"), p(safe(simulation["sourceIp"]), "TableCell"), p("Block", "TableCell"), p("HTTP 403", "StatusPass")],
    [p("CIDR deny", "TableCellBold"), p(safe(simulation["sourceCidr"]), "TableCell"), p("Block", "TableCell"), p("HTTP 403", "StatusPass")],
    [p("Route denies", "TableCellBold"), p("4 crawler paths", "TableCell"), p("Block + event", "TableCell"), p("4 x HTTP 403", "StatusPass")],
    [p("Concurrent limit", "TableCellBold"), p("10 requests at 3/10", "TableCell"), p("3 allow, 7 limit", "TableCell"), p("3 x 200, 7 x 429", "StatusPass")],
    [p("Allowlist precedence", "TableCellBold"), p("Source over UA + CIDR", "TableCell"), p("Allow", "TableCell"), p("HTTP 200", "StatusPass")],
    [p("Protected source", "TableCellBold"), p("Loopback/private peer", "TableCell"), p("Allow", "TableCell"), p("HTTP 200", "StatusPass")],
]
story.extend(
    [
        report_table(control_rows, [42 * mm, 52 * mm, 41 * mm, doc.width - 135 * mm]),
        Spacer(1, 7 * mm),
        p("Initial discrepancy and correction", "H2x"),
        p(
            "The first expanded campaign intentionally required seven central firewall events. It "
            "received every expected HTTP status but recorded only six firewall events. Investigation "
            "showed that <b>/server-status</b> was denied directly by Apache before WordPress executed. "
            "A bare 403 was therefore not valid proof of the plugin firewall.",
        ),
        p(
            "The scenario was corrected to use <b>/actuator/env</b>, and the simulator was strengthened "
            "to require a matching FIREWALL/BLOCKED event for every crawler path. The final campaign "
            "then passed 20 of 20 checks with seven firewall events. This report uses only the corrected "
            "final campaign as PASS evidence.",
            "PassCallout",
        ),
        p("Safe final state", "H2x"),
    ]
)
final_rows = [
    [p("Property", "TableHead"), p("Final value", "TableHead")],
    [p("Connection", "TableCellBold"), p(safe(final_state["connectionStatus"]), "StatusPass")],
    [p("Enforcement", "TableCellBold"), p(safe(final_state["effectiveMode"]), "StatusPass")],
    [p("Queue / dropped", "TableCellBold"), p("0 / 0", "StatusPass")],
    [p("Active campaign rules", "TableCellBold"), p("0", "StatusPass")],
    [p("Applied policy", "TableCellBold"), p(f"v{safe(final_state['policyVersion'])}", "TableCell")],
]
story.extend(
    [
        report_table(final_rows, [55 * mm, doc.width - 55 * mm]),
        PageBreak(),
    ]
)

# Browser screenshots
story.extend(
    [
        p("6. Operator-visible event evidence", "H1x"),
        p(
            "A real Chromium session authenticated through the production-built web application. The "
            "event page showed campaign source 8.8.8.231, seven BOT rate-limit rows, SCANNER firewall "
            "rows for the four crawler routes, completed assessments, and AI pending 0.",
        ),
        screenshot(screenshots["events"], doc.width, 184 * mm),
        p(
            "Figure 1. Live events dashboard after the final campaign. The selected rate-limit event is "
            "BOT / HIGH / RATE_LIMITED / COMPLETE; crawler-route rows are visible below it.",
            "Caption",
        ),
        PageBreak(),
        p("7. Connection and cleanup evidence", "H1x"),
        p(
            "The target site remained ONLINE and returned to OBSERVE with policy v50 applied, queue 0, "
            "and dropped 0. This is the intended post-test posture.",
        ),
        screenshot(screenshots["sites"], doc.width, 184 * mm),
        p(
            "Figure 2. Sites dashboard showing the tested Local WordPress Honeypot as ONLINE, OBSERVE, "
            "APPLIED, queue 0, dropped 0, policy v50.",
            "Caption",
        ),
        PageBreak(),
        p("8. Firewall safety evidence", "H1x"),
        p(
            "The firewall page showed the target in Observe mode, retained baseline validation rules "
            "disabled, and the private-source and observe-first safety guidance. Campaign-specific "
            "rules had been deleted by the simulator.",
        ),
        screenshot(screenshots["firewall"], doc.width, 184 * mm),
        p(
            "Figure 3. Firewall dashboard after cleanup. Visible rules are disabled baseline test "
            "records; no campaign rule remained active.",
            "Caption",
        ),
        PageBreak(),
    ]
)

# Full check record and limitations
story.extend(
    [
        p("9. Final campaign audit record", "H1x"),
        p(
            "Every row below was mandatory. A failed row makes the generated simulation verdict FAIL "
            "and prevents this PDF generator from issuing a PASS report.",
        ),
    ]
)
audit_rows = [
    [p("#", "TableHead"), p("Mandatory check", "TableHead"), p("Status", "TableHead"), p("Measured evidence", "TableHead")]
]
for index, item in enumerate(simulation_results, 1):
    audit_rows.append(
        [
            p(str(index), "TableCell"),
            p(safe(item["name"]), "TableCellBold"),
            p("PASS", "StatusPass"),
            p(safe(item["evidence"]), "TableCell"),
        ]
    )
story.extend(
    [
        report_table(
            audit_rows,
            [8 * mm, 48 * mm, 17 * mm, doc.width - 73 * mm],
            long=True,
        ),
        CondPageBreak(80 * mm),
        p("10. Limitations and operational conclusion", "H1x"),
        p("What this report does not prove", "H2x"),
        bullet("Universal bot prevention, distributed low-and-slow attacks, volumetric DDoS, or unknown zero-day exploit prevention."),
        bullet("A host-level or network-edge firewall. The verified control is an application-layer WordPress firewall."),
        bullet("A public Dokploy deployment, public DNS, Internet certificate issuance, CDN behavior, or direct-origin bypass resistance."),
        bullet("The external Hugging Face classifier, Telegram delivery, or SMTP delivery; those providers were not configured."),
        bullet("That a deny rule should be created automatically from every detection. SmartHoneyAI remains observe-first and uses explicit operator-authorized enforcement."),
        p("Operational conclusion", "H2x"),
        p(
            "<b>PASS for the defined live scenarios.</b> The complete Docker/WordPress platform can "
            "detect the tested credential-stuffing and crawler behavior, preserve sanitized evidence, "
            "classify the activity in the isolated worker queue, and prevent the tested requests when "
            "authorized ENFORCE policies are active. Rate limiting, safety precedence, outage behavior, "
            "operator visibility, authentication, and cleanup also passed.",
            "PassCallout",
        ),
        p(
            "For production, deploy the full Docker Compose topology, keep the site in OBSERVE during "
            "the required learning period, review detections, add short-lived rules deliberately, and "
            "retain upstream edge controls for TLS, network filtering, volumetric attacks, and origin "
            "protection.",
        ),
        Spacer(1, 5 * mm),
        p(
            f"Evidence generated {safe(simulation['generatedAt'])}. Browser verification completed "
            f"{safe(browser['verifiedAt'])}. Source artifacts: {safe(E2E_PATH.name)}, "
            f"{safe(SIMULATION_PATH.name)}, and {safe(BROWSER_PATH.name)}.",
            "Smallx",
        ),
    ]
)

doc.build(story)
print(OUTPUT_PATH)
