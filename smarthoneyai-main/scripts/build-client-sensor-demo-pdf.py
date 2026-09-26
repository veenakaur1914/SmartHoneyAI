#!/usr/bin/env python3
"""Build the visually verified SmartHoneyAI two-package demonstration guide."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from PIL import Image as PILImage

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "SmartHoneyAI-Client-Sensor-Demo-Guide.pdf"
NORMAL_EVIDENCE = ROOT / "output" / "demo" / "normal-hosting-demo.json"
DOCKER_EVIDENCE = ROOT / "output" / "demo" / "docker-sensor-demo.json"
SCREENSHOTS = ROOT / "output" / "playwright"
LIVE = ROOT / "output" / "live-production"

NAVY = colors.HexColor("#071321")
PANEL = colors.HexColor("#102236")
PANEL_2 = colors.HexColor("#162d45")
GOLD = colors.HexColor("#f6b93b")
MINT = colors.HexColor("#63e6be")
INK = colors.HexColor("#142033")
MUTED = colors.HexColor("#607189")
LINE = colors.HexColor("#d7e0ea")
SOFT = colors.HexColor("#f3f7fb")
RED = colors.HexColor("#c84655")


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


normal = load_json(NORMAL_EVIDENCE)
docker = load_json(DOCKER_EVIDENCE)
live_normal = load_json(LIVE / "normal-hosting-live.json")
live_block = load_json(LIVE / "normal-block-live.json")
live_docker = load_json(LIVE / "docker-hybrid-live.json")
live_telegram = load_json(LIVE / "docker-telegram-live.json")
live_provider = load_json(LIVE / "docker-telegram-provider-test.json")


def create_crop(source_name: str, target_name: str, box: tuple[int, int, int, int]) -> None:
    source = SCREENSHOTS / source_name
    target = SCREENSHOTS / target_name
    with PILImage.open(source) as source_image:
        source_image.crop(box).save(target, "PNG")


create_crop("live-production/01-wordpress-plugin-ready.png", "live-production/01-wordpress-plugin-ready-crop.png", (0, 0, 1440, 980))
create_crop("live-production/03-wordpress-enforce-policy.png", "live-production/03-wordpress-enforce-policy-crop.png", (180, 120, 1410, 950))
create_crop("live-production/04-wordpress-cleanup-observe.png", "live-production/04-wordpress-cleanup-observe-crop.png", (180, 120, 1410, 950))
create_crop("live-production/06-correlated-critical-incident.png", "live-production/06-correlated-critical-incident-crop.png", (0, 0, 1280, 720))
create_crop("live-production/07-telegram-connected-live.png", "live-production/07-telegram-connected-live-crop.png", (250, 100, 1270, 720))
create_crop("live-production/08-four-protocol-live-events.png", "live-production/08-four-protocol-live-events-crop.png", (250, 820, 1110, 1780))

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=30, leading=34, textColor=colors.white, alignment=TA_LEFT, spaceAfter=10))
styles.add(ParagraphStyle(name="CoverSub", parent=styles["BodyText"], fontName="Helvetica", fontSize=13, leading=19, textColor=colors.HexColor("#b7c9dc")))
styles.add(ParagraphStyle(name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=21, leading=25, textColor=INK, spaceBefore=2, spaceAfter=10))
styles.add(ParagraphStyle(name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=INK, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="Bodyx", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.4, leading=14, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name="Smallx", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.7, leading=11, textColor=MUTED, spaceAfter=4))
styles.add(ParagraphStyle(name="Captionx", parent=styles["BodyText"], fontName="Helvetica-Oblique", fontSize=7.6, leading=10, textColor=MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=8))
styles.add(ParagraphStyle(name="Calloutx", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=9.2, leading=14, textColor=INK))
styles.add(ParagraphStyle(name="Codex", parent=styles["Code"], fontName="Courier", fontSize=7.5, leading=10.5, textColor=colors.HexColor("#eaf3fc")))
styles.add(ParagraphStyle(name="Cell", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.7, leading=10.5, textColor=INK))
styles.add(ParagraphStyle(name="CellWhite", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=7.7, leading=10, textColor=colors.white))


def p(text: str, style: str = "Bodyx") -> Paragraph:
    return Paragraph(text, styles[style])


def bullet(text: str) -> Paragraph:
    return Paragraph(f"<font color='#f0a900'>•</font>&nbsp;&nbsp;{text}", styles["Bodyx"])


def code(text: str) -> Table:
    block = Preformatted(text, styles["Codex"])
    table = Table([[block]], colWidths=[171 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("BOX", (0, 0), (-1, -1), 0.5, PANEL_2),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def callout(title: str, text: str, accent=MINT) -> Table:
    body = Paragraph(f"<b>{title}</b><br/>{text}", styles["Bodyx"])
    table = Table([["", body]], colWidths=[4 * mm, 167 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), accent),
        ("BACKGROUND", (1, 0), (1, 0), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (1, 0), (1, 0), 10),
        ("RIGHTPADDING", (1, 0), (1, 0), 10),
        ("TOPPADDING", (1, 0), (1, 0), 8),
        ("BOTTOMPADDING", (1, 0), (1, 0), 8),
    ]))
    return table


def result_table(evidence: dict, limit: int | None = None) -> Table:
    rows = [[p("Gate", "CellWhite"), p("Verified result", "CellWhite")]]
    steps = evidence["steps"][:limit] if limit else evidence["steps"]
    for item in steps:
        rows.append([p(f"PASS - {item['name']}", "Cell"), p(item["detail"], "Cell")])
    table = Table(rows, colWidths=[50 * mm, 121 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def screenshot(name: str, caption: str, max_height=112 * mm) -> list:
    path = SCREENSHOTS / name
    img = Image(str(path))
    width = 171 * mm
    ratio = img.imageHeight / img.imageWidth
    height = width * ratio
    if height > max_height:
        height = max_height
        width = height / ratio
    img.drawWidth = width
    img.drawHeight = height
    img.hAlign = "CENTER"
    return [img, p(caption, "Captionx")]


class Architecture(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 171 * mm
        self.height = 76 * mm

    def draw_box(self, canvas, x, y, w, h, title, lines, fill):
        canvas.setFillColor(fill)
        canvas.setStrokeColor(colors.HexColor("#31506d"))
        canvas.roundRect(x, y, w, h, 7, stroke=1, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(x + 9, y + h - 17, title)
        canvas.setFillColor(colors.HexColor("#b9c9d8"))
        canvas.setFont("Helvetica", 7.5)
        for index, line in enumerate(lines):
            canvas.drawString(x + 9, y + h - 31 - index * 11, line)

    def draw_arrow(self, canvas, x1, y1, x2, y2, label):
        canvas.setStrokeColor(GOLD)
        canvas.setFillColor(GOLD)
        canvas.setLineWidth(1.5)
        canvas.line(x1, y1, x2, y2)
        canvas.line(x2, y2, x2 - 6, y2 + 3)
        canvas.line(x2, y2, x2 - 6, y2 - 3)
        canvas.setFont("Helvetica-Bold", 6.7)
        canvas.drawCentredString((x1 + x2) / 2, y1 + 5, label)

    def draw(self):
        c = self.canv
        left_w = 47 * mm
        middle_w = 47 * mm
        right_w = 54 * mm
        gap = 12 * mm
        y_top = 43 * mm
        self.draw_box(c, 0, y_top, left_w, 29 * mm, "Normal hosting", ["WordPress plugin", "HTTP decoys + local block"], PANEL)
        self.draw_box(c, 0, 3 * mm, left_w, 29 * mm, "Docker WordPress", ["Same plugin", "Application-layer block"], PANEL)
        self.draw_box(c, left_w + gap, 3 * mm, middle_w, 29 * mm, "Client sensor", ["OpenCanary + agent", "SSH / MySQL / Redis"], PANEL_2)
        self.draw_box(c, left_w + middle_w + 2 * gap, 23 * mm, right_w, 39 * mm, "SmartHoneyAI control plane", ["Signed ingestion", "Correlation + incidents", "Telegram + signed policy"], NAVY)
        self.draw_arrow(c, left_w, y_top + 14 * mm, left_w + middle_w + 2 * gap, y_top + 14 * mm, "HTTPS telemetry")
        self.draw_arrow(c, left_w, 17 * mm, left_w + middle_w + 2 * gap, 31 * mm, "HTTPS telemetry")
        self.draw_arrow(c, left_w + gap + middle_w, 17 * mm, left_w + middle_w + 2 * gap, 30 * mm, "signed batch")
        c.setFillColor(RED)
        c.setFont("Helvetica-Bold", 7.2)
        c.drawCentredString(38 * mm, 0, "Blocking stays inside each WordPress installation")


def page_header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, 17 * mm, 190 * mm, 17 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 11 * mm, "SmartHoneyAI client sensor demonstration | Authorized local + production evidence")
    canvas.drawRightString(190 * mm, 11 * mm, f"Page {doc.page}")
    canvas.restoreState()


def cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
    canvas.setFillColor(GOLD)
    canvas.roundRect(22 * mm, 244 * mm, 22 * mm, 22 * mm, 5, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 16)
    canvas.drawCentredString(33 * mm, 251 * mm, "SH")
    canvas.setFillColor(MINT)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(22 * mm, 226 * mm, "VERIFIED LOCAL + PRODUCTION DEMONSTRATION")
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 29)
    canvas.drawString(22 * mm, 195 * mm, "SmartHoneyAI Client Sensors")
    canvas.drawString(22 * mm, 181 * mm, "Setup, Attack & Evidence Guide")
    canvas.setFillColor(colors.HexColor("#b7c9dc"))
    canvas.setFont("Helvetica", 12)
    canvas.drawString(22 * mm, 162 * mm, "Normal WordPress hosting + Docker WordPress with OpenCanary")
    canvas.setFillColor(PANEL)
    canvas.roundRect(22 * mm, 92 * mm, 166 * mm, 50 * mm, 8, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(31 * mm, 127 * mm, "What this report proves")
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(colors.HexColor("#cbd9e7"))
    lines = [
        "Two separately runnable, loopback-only attack demonstrations",
        "WordPress 403 enforcement and scoped 200 recovery",
        "SSH / MySQL / Redis telemetry and CRITICAL correlation",
        "Telegram incident and blocked-access delivery with redaction",
        "Reproducible client packages with production safety gates",
    ]
    for index, line in enumerate(lines):
        canvas.setFillColor(MINT)
        canvas.circle(33 * mm, (118 - index * 7) * mm, 1.4 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor("#cbd9e7"))
        canvas.drawString(38 * mm, (116.5 - index * 7) * mm, line)
    canvas.setFillColor(GOLD)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(22 * mm, 61 * mm, "Updated 4 September 2026 | Asia/Kuala_Lumpur")
    canvas.setFillColor(colors.HexColor("#8499ad"))
    canvas.setFont("Helvetica", 8)
    canvas.drawString(22 * mm, 52 * mm, "OpenCanary detects. The WordPress plugin enforces. The VPS control plane does not run the client sensor.")
    canvas.restoreState()


story = [Spacer(1, 245 * mm), PageBreak()]

story += [
    p("Outcome and verified scope", "H1x"),
    p("Both supported client models completed the full local demonstration and a live production verification against smarthoneyai.xyz and the authorized Hostinger site demo.finalyearproject.my. The normal-hosting path detected WordPress decoys, blocked at the application layer, delivered Telegram, and restored access. The Docker path additionally ingested OpenCanary SSH, MySQL and Redis signals, formed a two-asset/four-protocol CRITICAL incident, delivered Telegram, returned 403 under a scoped signed policy, removed only its own rule, and returned 200."),
    callout("Important boundary", "The Docker sensor is detection-only. Neither OpenCanary nor the SmartHoneyAI control-plane VPS performs host firewall blocking. Enforcement protects the linked WordPress installation only.", GOLD),
    Spacer(1, 5 * mm),
    p("Run summary", "H2x"),
    Table([
        [p("Package", "CellWhite"), p("Result", "CellWhite"), p("Key proof", "CellWhite")],
        [p("Normal WordPress Hosting", "Cell"), p("PASS", "Cell"), p("Provider test SENT; 3 decoys; fourth request 403; attack alert SENT; cleanup 200", "Cell")],
        [p("Docker WordPress + Sensor", "Cell"), p("PASS", "Cell"), p("Provider test SENT; 6 signals; CRITICAL + blocked alerts SENT; policy 403; cleanup 200", "Cell")],
        [p("Baseline acceptance", "Cell"), p("19 / 19", "Cell"), p("Full local E2E gates passed before the attack demonstrations", "Cell")],
        [p("Release reproducibility", "Cell"), p("PASS", "Cell"), p("Both 1.1.0 artifacts produced identical SHA-256 values on consecutive builds", "Cell")],
    ], colWidths=[53 * mm, 25 * mm, 93 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])),
    Spacer(1, 7 * mm),
    p("Architecture after implementation", "H2x"),
    Architecture(),
    p("The control plane accepts signed client telemetry, correlates incidents, sends Telegram, and issues signed WordPress policies. The standalone sensor has separate ingress/internal/egress networks and never joins WordPress, database, Traefik, Dokploy, app, data, or monitoring networks.", "Smallx"),
    PageBreak(),
]

story += [
    p("Package A - Normal WordPress Hosting", "H1x"),
    p("Use this package for Hostinger, shared hosting, cPanel, managed WordPress, and conventional hosting where Docker or host ports are unavailable."),
    p("Setup", "H2x"),
    bullet("In SmartHoneyAI Sites, select <b>Normal WordPress Hosting</b>, enter the owned site URL, and create the site."),
    bullet("Download <b>smarthoneyai-wordpress-1.1.0.zip</b> and compare it with SHA256SUMS."),
    bullet("Upload and activate the plugin in WordPress. Open Settings - SmartHoneyAI."),
    bullet("Confirm PHP Sodium, outbound HTTPS, WP-Cron or the explicit external runner, pretty permalinks, and database queue are ready."),
    bullet("Paste the HTTPS control-plane URL and one-time enrollment token. Enroll, then press Sync now."),
    bullet("Connect Telegram in SmartHoneyAI Settings, verify Active, and press Send test notification."),
    p("Local demonstration", "H2x"),
    code("# Baseline (one time)\nRESET_E2E=1 CI=true pnpm demo:local:e2e\n\n# Safety preview\nCI=true pnpm demo:attack:wordpress\n\n# Execute fixed loopback targets\nCI=true pnpm demo:attack:wordpress -- --execute"),
    callout("Expected", "The provider test is SENT; the first three inert decoys return 401/401/404; the fourth returns 403; a separate attack alert is SENT; cleanup restores HTTP 200."),
    p("Observed result", "H2x"),
    result_table(normal),
    PageBreak(),
]

story += [
    p("Normal-hosting screenshots", "H1x"),
    *screenshot("wordpress-plugin-status.png", "WordPress plugin 1.1.0: ONLINE, queue 0, Sodium/HTTPS/cron/permalinks/database readiness, and an explicit application-layer protection boundary.", 108 * mm),
    *screenshot("telegram-deliveries.png", "Normal-hosting Telegram proof: connection, named provider test, and the separate blocked-access alert. Source identity is hashed/masked.", 103 * mm),
    PageBreak(),
]

story += [
    p("Package B - Docker WordPress + Network Sensor", "H1x"),
    p("Use this bundle only when the client controls the Docker host. It contains the same WordPress plugin plus a separate OpenCanary/agent Compose project."),
    p("Production installation", "H2x"),
    bullet("Create the WordPress site as Docker WordPress + Network Sensor; install and enroll the included plugin ZIP."),
    bullet("Create a paired sensor in Sensor modules and copy the one-time enrollment token."),
    bullet("Extract the tar.gz, copy .env.example to .env, and set the exact sensor name, token, HTTPS control-plane URL, allowlisted source IPs, and high ports."),
    bullet("At the provider firewall, allow TCP 2222, 13306 and 16379 only from the same authorized IP addresses."),
    bullet("Keep PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED=NO until verified. Then set YES and run preflight, install and health."),
    code("./scripts/preflight.sh\n./scripts/install.sh\n./scripts/health.sh\n\n# Remove the one-time enrollment token from .env after first heartbeat"),
    p("Mandatory preflight", "H2x"),
    Table([
        [p("Gate", "CellWhite"), p("Requirement", "CellWhite")],
        [p("Exposure", "Cell"), p("Provider firewall allowlist confirmed; no arbitrary Internet exposure", "Cell")],
        [p("Ports", "Cell"), p("2222, 13306 and 16379 unused in Docker inventory and host sockets", "Cell")],
        [p("Capacity", "Cell"), p("At least 1 GiB free memory and 5 GiB free disk", "Cell")],
        [p("Isolation", "Cell"), p("Separate Compose project; no WordPress/database/reverse-proxy network membership", "Cell")],
        [p("Secrets", "Cell"), p("One-time token removed after enrollment; credential/spool volume retained", "Cell")],
    ], colWidths=[44 * mm, 127 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])),
    Spacer(1, 8 * mm),
    *screenshot("sensor-modules.png", "Dashboard proof: client module linked to Docker WordPress, ONLINE, DEMO_OVERRIDE visibly labelled, SSH/MySQL/Redis, agent 1.1.0, queue 0 and dropped 0.", 75 * mm),
    PageBreak(),
]

story += [
    p("Docker hybrid attack demonstration", "H1x"),
    code("# Safety preview\nCI=true pnpm demo:attack:docker\n\n# Execute fixed loopback targets\nCI=true pnpm demo:attack:docker -- --execute"),
    p("What the script does", "H2x"),
    bullet("Creates a 15-minute scoped self-test and pairs a fresh client sensor."),
    bullet("Starts isolated OpenCanary listeners bound only to 127.0.0.1 and waits for real protocol responses."),
    bullet("Sends a harmless SSH banner, MySQL handshake and Redis PING, then one inert WordPress /env request."),
    bullet("Requires one CRITICAL incident with two assets and four protocols."),
    bullet("Requires a provider test, an incident Telegram message, and a blocked-access Telegram message."),
    bullet("Applies a 24-hour WordPress rule, proves HTTP 403, removes only that rule, proves HTTP 200, stops containers, and restores the original mode."),
    p("Observed result", "H2x"),
    result_table(docker),
    PageBreak(),
]

story += [
    p("Correlation and containment screenshots", "H1x"),
    *screenshot("incidents-hybrid.png", "Incidents dashboard: normal WordPress CRITICAL evidence and a multi-sensor CRITICAL incident with 2 assets across SSH, Redis, MySQL and HTTP.", 115 * mm),
    callout("Containment proof", f"Run {docker['steps'][2]['detail']} The owned rule returned WordPress HTTP 403, Telegram confirmed blocked access, cleanup disabled only that rule, and normal HTTP 200 returned.", GOLD),
    Spacer(1, 5 * mm),
    p("Sensor evidence counters", "H2x"),
    Table([
        [p("Received frames", "CellWhite"), p("Accepted", "CellWhite"), p("Invalid", "CellWhite"), p("Dropped", "CellWhite"), p("Last protocol logtype", "CellWhite")],
        [p(str(docker["sensorHealthAfterProbes"]["receivedFrames"]), "Cell"), p(str(docker["sensorHealthAfterProbes"]["acceptedSignals"]), "Cell"), p(str(docker["sensorHealthAfterProbes"]["invalidFrames"]), "Cell"), p("0", "Cell"), p(str(docker["sensorHealthAfterProbes"]["lastSignalShape"]["logtype"]), "Cell")],
    ], colWidths=[34.2 * mm] * 5, style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])),
    PageBreak(),
]

story += [
    p("Telegram verification", "H1x"),
    p("Each script first sends a named provider test and then requires attack-generated deliveries from the worker. The local test API verifies getMe, getUpdates and sendMessage repeatably; production rejects a custom origin and uses the official Telegram Bot API."),
    *screenshot("telegram-active.png", "SmartHoneyAI Settings: the linked chat is Active and Send test notification gives an immediate delivery check.", 99 * mm),
    *screenshot("telegram-deliveries-docker.png", "Docker hybrid proof: provider test SENT, sensor incident escalated to CRITICAL, and containment produced a blocked-access message.", 99 * mm),
    PageBreak(),
]

checksum_rows = []
for checksum_line in (ROOT / "output" / "releases" / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
    digest, filename = checksum_line.split(maxsplit=1)
    checksum_rows.extend([digest, f"  {filename}"])
checksums = "\n".join(checksum_rows)
story += [
    p("Verification, artifacts and safety", "H1x"),
    p("Automated gates completed", "H2x"),
    bullet("Full local acceptance: 19 / 19 gates."),
    bullet("Repository TypeScript/Next typecheck: 9 / 9 tasks."),
    bullet("Repository tests: API 31, worker 13, sensor 3, contracts 3, database 6 - all passed."),
    bullet("WordPress plugin: coding standards 9 / 9; PHPUnit 29 tests and 192 assertions - all passed."),
    bullet("Isolated sensor package test: API outage/retry, exactly one accepted event, redaction PASS."),
    bullet("Consecutive client builds produced identical checksums; production tar excludes credentials, local Compose override and all DEMO_OVERRIDE code."),
    p("Release checksums", "H2x"),
    code(checksums),
    p("Data handling", "H2x"),
    bullet("The network agent strips usernames, passwords, tokens, session values and Redis arguments before spool or transport."),
    bullet("Telegram uses masked source hashes and sanitized templates; raw source IP and submitted credentials are not included."),
    bullet("DEMO_OVERRIDE is presentation-only, visibly labelled, loopback-bound, scoped to one 15-minute run, and absent from production artifacts."),
    p("Rollback", "H2x"),
    code("# Stop client sensor; keep credentials/spool\n./scripts/uninstall.sh\n\n# Purge only with explicit confirmation\nPURGE_SENSOR_DATA_CONFIRMED=YES ./scripts/uninstall.sh --purge\n\n# Stop local acceptance stack without deleting volumes\ndocker compose -p honeypot-ai-e2e -f \"$PWD/docker-compose.yml\" \\\n  -f \"$PWD/docker-compose.wordpress-demo.yml\" down"),
    callout("Shared-VPS statement", "SmartHoneyAI production remains control-plane only. No OpenCanary service, sensor high port, or sensor network is deployed on the SmartHoneyAI Dokploy VPS. This preserves unrelated websites and global Traefik routing."),
    PageBreak(),
]

story += [
    p("Live production verification - Normal Hosting", "H1x"),
    p("Verified 4 September 2026 (MYT) against the deployed SmartHoneyAI control plane and the authorized Hostinger WordPress site. Evidence below is from the official production APIs and the installed WordPress plugin, not the local mock."),
    Table([
        [p("Gate", "CellWhite"), p("Production result", "CellWhite")],
        [p("Plugin readiness", "Cell"), p("ONLINE; plugin 1.1.0; PHP Sodium, outbound HTTPS, WP-Cron, pretty permalinks and database queue ready; queue 0; dropped 0", "Cell")],
        [p("Decoy detection", "Cell"), p(f"POST /database/query returned {live_normal['decoy']['httpStatus']}; {live_normal['event']['assessment']['threatType']} assessed {live_normal['event']['assessment']['severity']}", "Cell")],
        [p("Incident Telegram", "Cell"), p(f"{live_normal['telegram']['status']} at {live_normal['telegram']['sentAt']}; delivery {live_normal['telegram']['deliveryId']}", "Cell")],
        [p("WordPress block", "Cell"), p(f"Run-owned signed rule returned HTTP {live_block['httpStatus']}; blocked-access Telegram {live_block['telegram']['status']}", "Cell")],
        [p("Cleanup", "Cell"), p("Only the test-owned rule was disabled; site returned to OBSERVE and the same source recovered to HTTP 200", "Cell")],
    ], colWidths=[43 * mm, 128 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ])),
    Spacer(1, 6 * mm),
    *screenshot("live-production/01-wordpress-plugin-ready-crop.png", "Production WordPress plugin: ONLINE, policy state, zero queue/drops, and five readiness checks passed.", 105 * mm),
    *screenshot("live-production/02-normal-hosting-critical-incident.png", "Production incident row: the normal-hosting SQL injection decoy was classified CRITICAL.", 24 * mm),
    PageBreak(),
]

story += [
    p("Live application containment and recovery", "H1x"),
    p("These screenshots bracket the same owned test rule. Blocking is at the WordPress application layer; neither Hostinger's network firewall nor the SmartHoneyAI VPS firewall was modified."),
    *screenshot("live-production/03-wordpress-enforce-policy-crop.png", "Temporary production containment: signed ENFORCE policy applied and the authorized source received HTTP 403.", 85 * mm),
    *screenshot("live-production/04-wordpress-cleanup-observe-crop.png", "Cleanup: test rule disabled, OBSERVE restored, queue/drops remain zero, and HTTP 200 access returned.", 85 * mm),
    callout("Authoritative automation evidence", f"Normal hosting status {live_normal['status']}; block status {live_block['status']}; blocked-access Telegram {live_block['telegram']['status']}. Raw source addresses and credentials are excluded from this report.", MINT),
    PageBreak(),
]

story += [
    p("Live production verification - Docker Sensor", "H1x"),
    p("A local Docker sensor enrolled to the deployed control plane while listeners remained bound to 127.0.0.1. The presentation-only DEMO_OVERRIDE was explicitly labelled and the production client bundle still contains no demo override code."),
    Table([
        [p("Gate", "CellWhite"), p("Production result", "CellWhite")],
        [p("Network module", "Cell"), p("ONLINE; agent 1.1.0; SSH, MYSQL, REDIS; queue 0; dropped 0", "Cell")],
        [p("Hybrid incident", "Cell"), p("CRITICAL; 2 assets; 4 protocols (SSH, MYSQL, REDIS, HTTP); ten-minute correlated timeline", "Cell")],
        [p("Containment", "Cell"), p(f"Scoped rule {live_docker['containmentRuleId']} produced 403 and policy acknowledgement", "Cell")],
        [p("Recovery", "Cell"), p("Owned rule removed; HTTP 200 restored; all local containers, networks and host-port bindings removed", "Cell")],
        [p("Telegram provider", "Cell"), p(f"Official provider test {live_provider['status']}; provider message {live_provider['providerMessageId']}; attack deliveries {live_telegram['status']}", "Cell")],
    ], colWidths=[43 * mm, 128 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ])),
    Spacer(1, 6 * mm),
    *screenshot("live-production/05-docker-sensor-module-live.png", "Production Sensor modules: paired site, ONLINE, DEMO_OVERRIDE, three services, agent 1.1.0, queue 0 and dropped 0.", 100 * mm),
    PageBreak(),
]

story += [
    p("Live four-protocol incident and Telegram", "H1x"),
    *screenshot("live-production/06-correlated-critical-incident-crop.png", "Production incident timeline: 2 assets and SSH, MYSQL, REDIS plus HTTP, with the WordPress /database/query event visible.", 105 * mm),
    *screenshot("live-production/07-telegram-connected-live-crop.png", "Production Telegram channel is Active. Official provider delivery and worker AlertDelivery rows both reached SENT.", 90 * mm),
    PageBreak(),
]

story += [
    p("Live sanitized sensor telemetry", "H1x"),
    *screenshot("live-production/08-four-protocol-live-events-crop.png", "Production Live events shows SQL_INJECTION, SERVICE_ABUSE and SCANNER telemetry from WordPress and the paired sensor module. Evidence is sanitized before ingestion.", 195 * mm),
    callout("Final production state", f"Hybrid incident {live_docker['incidentId']} completed every gate and cleanup={str(live_docker['cleanup']).upper()}. WordPress access recovered, the scoped rule is disabled, and no local sensor container or published port remains active.", MINT),
    PageBreak(),
]

story += [
    p("Troubleshooting and presentation checklist", "H1x"),
    p("If a gate fails", "H2x"),
    bullet("No listener response: wait for actual SSH/MySQL/Redis protocol response; container process health alone is not listener readiness."),
    bullet("No sensor events: verify the OpenCanary config is mounted at /etc/opencanaryd/opencanary.conf and that sensor_ingress exists for published host ports."),
    bullet("No CRITICAL incident: verify network and WordPress events share organization and IP hash, occur within ten minutes, and the network event carries the active selfTestRunId."),
    bullet("Policy acknowledged but no 403: WordPress must be ENFORCE. The local Docker script temporarily enables it and always restores the original mode."),
    bullet("No Telegram: press Send test notification. If it fails, reconnect the chat or restore bot permission/token; if it succeeds, confirm the worker is healthy and AlertDelivery reaches SENT."),
    p("Presentation sequence", "H2x"),
    Table([
        [p("1", "CellWhite"), p("Show WordPress plugin readiness and protection boundary.", "CellWhite")],
        [p("2", "Cell"), p("Run normal script; point out fourth-request 403, Telegram SENT and cleanup 200.", "Cell")],
        [p("3", "Cell"), p("Show Sensor modules ONLINE with SSH/MySQL/Redis and queue 0.", "Cell")],
        [p("4", "Cell"), p("Run Docker script; point out six sanitized signals and CRITICAL correlation.", "Cell")],
        [p("5", "Cell"), p("Show incident timeline, Telegram delivery, 403 containment and 200 recovery.", "Cell")],
        [p("6", "Cell"), p("State clearly: sensor detects; WordPress blocks; control plane stays separate.", "Cell")],
    ], colWidths=[13 * mm, 158 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ])),
    Spacer(1, 10 * mm),
    p("Source references", "H2x"),
    p("Docker Compose networking: https://docs.docker.com/compose/how-tos/networking/<br/>Docker port publishing: https://docs.docker.com/engine/network/port-publishing/<br/>Project implementation/runbook: docs/client-sensor-demo-guide.md", "Smallx"),
    Spacer(1, 18 * mm),
    callout("Final verified state", f"Normal demo: {normal['status']}. Docker hybrid demo: {docker['status']}. Docker containment cleanup: {str(docker.get('cleanup')).upper()}. No self-test-owned rule remains active.", MINT),
]

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    rightMargin=20 * mm,
    leftMargin=20 * mm,
    topMargin=20 * mm,
    bottomMargin=22 * mm,
    title="SmartHoneyAI Client Sensor Setup, Attack & Evidence Guide",
    author="SmartHoneyAI",
    subject="Verified normal-hosting and Docker WordPress sensor demonstration",
)
doc.build(story, onFirstPage=cover, onLaterPages=page_header_footer)
print(OUTPUT)
