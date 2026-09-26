#!/usr/bin/env python3
"""Generate the SmartHoneyAI admin, user, and WordPress installation guide."""

from __future__ import annotations

import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "SmartHoneyAI-Complete-Admin-User-WordPress-Guide.pdf"
DASHBOARD_SCREEN = ROOT / "output" / "playwright" / "production-audit-dashboard.png"
WORDPRESS_SCREEN = ROOT / "output" / "playwright" / "wordpress-agent-settings.png"

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN_X = 18 * mm
MARGIN_TOP = 20 * mm
MARGIN_BOTTOM = 17 * mm
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X

NAVY = colors.HexColor("#071524")
NAVY_2 = colors.HexColor("#0E2238")
INK = colors.HexColor("#172235")
MUTED = colors.HexColor("#5F6E80")
LINE = colors.HexColor("#D9E1E8")
PAPER = colors.HexColor("#F6F8FA")
YELLOW = colors.HexColor("#F6B92B")
YELLOW_PALE = colors.HexColor("#FFF4D6")
GREEN = colors.HexColor("#0B8F6A")
GREEN_PALE = colors.HexColor("#E9F8F2")
BLUE = colors.HexColor("#1878B8")
BLUE_PALE = colors.HexColor("#EAF5FC")
RED = colors.HexColor("#B64242")
RED_PALE = colors.HexColor("#FDEEEE")
WHITE = colors.white


sample = getSampleStyleSheet()
styles = {
    "body": ParagraphStyle(
        "GuideBody",
        parent=sample["BodyText"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=13.6,
        textColor=INK,
        spaceAfter=6,
    ),
    "small": ParagraphStyle(
        "GuideSmall",
        parent=sample["BodyText"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.5,
        textColor=MUTED,
    ),
    "caption": ParagraphStyle(
        "GuideCaption",
        parent=sample["BodyText"],
        fontName="Helvetica-Oblique",
        fontSize=7.2,
        leading=10,
        textColor=MUTED,
        spaceBefore=3,
        spaceAfter=7,
    ),
    "h1": ParagraphStyle(
        "Heading1",
        parent=sample["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=NAVY,
        spaceBefore=0,
        spaceAfter=8,
        keepWithNext=True,
    ),
    "h2": ParagraphStyle(
        "Heading2",
        parent=sample["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        textColor=NAVY,
        spaceBefore=8,
        spaceAfter=5,
        keepWithNext=True,
    ),
    "h3": ParagraphStyle(
        "GuideH3",
        parent=sample["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=10.2,
        leading=13,
        textColor=INK,
        spaceBefore=6,
        spaceAfter=3,
        keepWithNext=True,
    ),
    "label": ParagraphStyle(
        "GuideLabel",
        parent=sample["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=7.2,
        leading=9,
        textColor=BLUE,
        spaceAfter=4,
    ),
    "cover_brand": ParagraphStyle(
        "CoverBrand",
        parent=sample["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        textColor=WHITE,
    ),
    "cover_title": ParagraphStyle(
        "CoverTitle",
        parent=sample["Title"],
        fontName="Helvetica-Bold",
        fontSize=31,
        leading=35,
        textColor=WHITE,
        alignment=TA_LEFT,
        spaceAfter=12,
    ),
    "cover_sub": ParagraphStyle(
        "CoverSub",
        parent=sample["BodyText"],
        fontName="Helvetica",
        fontSize=12,
        leading=18,
        textColor=colors.HexColor("#C7D4E0"),
        spaceAfter=12,
    ),
    "white_small": ParagraphStyle(
        "WhiteSmall",
        parent=sample["BodyText"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#C7D4E0"),
    ),
    "step_num": ParagraphStyle(
        "StepNumber",
        parent=sample["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        alignment=TA_CENTER,
        textColor=NAVY,
    ),
    "step_title": ParagraphStyle(
        "StepTitle",
        parent=sample["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=9.2,
        leading=12,
        textColor=INK,
        spaceAfter=2,
    ),
    "table_head": ParagraphStyle(
        "TableHead",
        parent=sample["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=WHITE,
    ),
    "table_body": ParagraphStyle(
        "TableBody",
        parent=sample["BodyText"],
        fontName="Helvetica",
        fontSize=7.2,
        leading=10,
        textColor=INK,
    ),
    "code": ParagraphStyle(
        "GuideCode",
        parent=sample["Code"],
        fontName="Courier",
        fontSize=7.4,
        leading=10.2,
        textColor=colors.HexColor("#DDE7F2"),
        wordWrap="CJK",
    ),
    "toc_title": ParagraphStyle(
        "TocTitle",
        parent=sample["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=NAVY,
        spaceAfter=12,
    ),
}


def safe(text: str) -> str:
    """Use characters available in the built-in PDF font set."""
    return (
        text.replace("—", "-")
        .replace("–", "-")
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("•", "-")
        .replace("→", "->")
        .replace("✓", "PASS")
        .replace("·", "-")
    )


def P(text: str, style: str = "body") -> Paragraph:
    return Paragraph(safe(text), styles[style])


def section(label: str, title: str, intro: str = "") -> list:
    parts = [P(label.upper(), "label"), P(title, "h1")]
    if intro:
        parts.append(P(intro))
    parts.extend([HRFlowable(width="100%", thickness=0.6, color=LINE), Spacer(1, 3 * mm)])
    return parts


def sub(title: str) -> Paragraph:
    return P(title, "h2")


def bullets(items: list[str], color=INK, gap: float = 2.2 * mm) -> Table:
    rows = []
    for item in items:
        rows.append([
            Paragraph("-", ParagraphStyle("BulletMark", parent=styles["body"], fontName="Helvetica-Bold", textColor=color)),
            P(item),
        ])
    table = Table(rows, colWidths=[5 * mm, CONTENT_WIDTH - 5 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), gap),
    ]))
    return table


def checklist(items: list[str]) -> Table:
    rows = []
    for item in items:
        rows.append([P("[ ]", "small"), P(item)])
    table = Table(rows, colWidths=[10 * mm, CONTENT_WIDTH - 10 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def callout(title: str, text: str, kind: str = "info") -> Table:
    palette = {
        "info": (BLUE_PALE, BLUE),
        "success": (GREEN_PALE, GREEN),
        "warning": (YELLOW_PALE, colors.HexColor("#9A6500")),
        "danger": (RED_PALE, RED),
    }
    bg, accent = palette[kind]
    content = P(f"<b>{title}</b><br/>{text}")
    table = Table([[content]], colWidths=[CONTENT_WIDTH])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.7, accent),
        ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def steps(items: list[tuple[str, str]]) -> Table:
    rows = []
    for index, (title, body) in enumerate(items, 1):
        rows.append([
            P(f"{index:02d}", "step_num"),
            Paragraph(safe(f"<b>{title}</b><br/>{body}"), styles["body"]),
        ])
    table = Table(rows, colWidths=[13 * mm, CONTENT_WIDTH - 13 * mm], repeatRows=0)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), YELLOW_PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def cards(items: list[tuple[str, str]], columns: int = 2) -> Table:
    cells = []
    for title, body in items:
        cells.append(Paragraph(safe(f"<b>{title}</b><br/><font color='#5F6E80'>{body}</font>"), styles["body"]))
    while len(cells) % columns:
        cells.append("")
    rows = [cells[i:i + columns] for i in range(0, len(cells), columns)]
    gap = 4 * mm
    col_width = (CONTENT_WIDTH - (columns - 1) * gap) / columns
    table_rows = []
    for row in rows:
        expanded = []
        for i, cell in enumerate(row):
            expanded.append(cell)
            if i < columns - 1:
                expanded.append("")
        table_rows.append(expanded)
    widths = []
    for i in range(columns):
        widths.append(col_width)
        if i < columns - 1:
            widths.append(gap)
    table = Table(table_rows, colWidths=widths)
    style_cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    for col in range(0, columns * 2 - 1, 2):
        style_cmds.extend([
            ("BACKGROUND", (col, 0), (col, -1), PAPER),
            ("BOX", (col, 0), (col, -1), 0.5, LINE),
            ("LEFTPADDING", (col, 0), (col, -1), 8),
            ("RIGHTPADDING", (col, 0), (col, -1), 8),
            ("TOPPADDING", (col, 0), (col, -1), 8),
            ("BOTTOMPADDING", (col, 0), (col, -1), 8),
        ])
    table.setStyle(TableStyle(style_cmds))
    return table


def data_table(headers: list[str], rows: list[list[str]], widths: list[float] | None = None) -> Table:
    if widths is None:
        widths = [CONTENT_WIDTH / len(headers)] * len(headers)
    content = [[P(h, "table_head") for h in headers]]
    content.extend([[P(cell, "table_body") for cell in row] for row in rows])
    table = Table(content, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY_2),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PAPER]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def code_block(text: str) -> Table:
    table = Table([[P(text.replace("\n", "<br/>"), "code")]], colWidths=[CONTENT_WIDTH])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_2),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#2F4961")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def flow_diagram(items: list[tuple[str, str]]) -> Table:
    row = []
    widths = []
    box_width = (CONTENT_WIDTH - (len(items) - 1) * 7 * mm) / len(items)
    for index, (title, body) in enumerate(items):
        row.append(Paragraph(safe(f"<b>{title}</b><br/><font size='7' color='#5F6E80'>{body}</font>"), styles["body"]))
        widths.append(box_width)
        if index < len(items) - 1:
            row.append(P("->", "step_num"))
            widths.append(7 * mm)
    table = Table([row], colWidths=widths)
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for col in range(0, len(row), 2):
        cmds.extend([
            ("BACKGROUND", (col, 0), (col, 0), PAPER),
            ("BOX", (col, 0), (col, 0), 0.6, LINE),
        ])
    table.setStyle(TableStyle(cmds))
    return table


def screenshot(path: Path, caption: str) -> list:
    if not path.exists():
        return [callout("Screenshot unavailable", f"Expected verification image: {path}", "warning")]
    from PIL import Image as PILImage

    with PILImage.open(path) as image:
        width_px, height_px = image.size
    width = CONTENT_WIDTH
    height = width * height_px / width_px
    max_height = 150 * mm
    if height > max_height:
        scale = max_height / height
        width *= scale
        height *= scale
    return [Image(str(path), width=width, height=height), P(caption, "caption")]


class GuideDocument(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=MARGIN_X,
            rightMargin=MARGIN_X,
            topMargin=MARGIN_TOP,
            bottomMargin=MARGIN_BOTTOM,
            title="SmartHoneyAI Complete Admin, User, and WordPress Guide",
            author="SmartHoneyAI",
            subject="Administration, daily use, and WordPress plugin installation",
            creator="SmartHoneyAI production readiness workflow",
        )
        frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            CONTENT_WIDTH,
            PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
            id="content",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=self.draw_page)])

    def draw_page(self, canvas, doc):
        canvas.saveState()
        if doc.page == 1:
            canvas.setFillColor(NAVY)
            canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
            canvas.setFillColor(YELLOW)
            canvas.rect(0, 0, 11 * mm, PAGE_HEIGHT, fill=1, stroke=0)
            canvas.setFillColor(colors.HexColor("#0B2A45"))
            canvas.circle(PAGE_WIDTH - 18 * mm, 36 * mm, 43 * mm, fill=1, stroke=0)
        else:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.5)
            canvas.line(MARGIN_X, PAGE_HEIGHT - 12 * mm, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 12 * mm)
            canvas.setFont("Helvetica-Bold", 7.6)
            canvas.setFillColor(NAVY)
            canvas.drawString(MARGIN_X, PAGE_HEIGHT - 9 * mm, "SmartHoneyAI")
            canvas.setFont("Helvetica", 7.2)
            canvas.setFillColor(MUTED)
            canvas.drawRightString(PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 9 * mm, "Admin, User, and WordPress Guide - Release 1.0")
            canvas.setStrokeColor(LINE)
            canvas.line(MARGIN_X, 11 * mm, PAGE_WIDTH - MARGIN_X, 11 * mm)
            canvas.setFont("Helvetica", 7.2)
            canvas.setFillColor(MUTED)
            canvas.drawString(MARGIN_X, 7 * mm, "smarthoneyai.xyz")
            canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 7 * mm, f"Page {doc.page}")
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style_name = flowable.style.name
            if style_name in ("Heading1", "Heading2"):
                level = 0 if style_name == "Heading1" else 1
                text = flowable.getPlainText()
                key = f"section-{self.page}-{abs(hash(text))}"
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=level, closed=False)
                self.notify("TOCEntry", (level, text, self.page, key))


def build_story() -> list:
    story = []

    # Cover
    story.extend([
        Spacer(1, 23 * mm),
        Table([[P("SMART", "cover_brand"), P("HONEY", "cover_brand"), P("AI", "cover_brand")]],
              colWidths=[24 * mm, 31 * mm, 12 * mm],
              style=TableStyle([
                  ("BACKGROUND", (0, 0), (0, 0), YELLOW),
                  ("TEXTCOLOR", (0, 0), (0, 0), NAVY),
                  ("LEFTPADDING", (0, 0), (-1, -1), 6),
                  ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                  ("TOPPADDING", (0, 0), (-1, -1), 6),
                  ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
              ])),
        Spacer(1, 20 * mm),
        P("Complete Admin, User, and WordPress Guide", "cover_title"),
        P("A practical production tutorial for operating the SmartHoneyAI control plane, investigating threats, and installing the WordPress agent safely.", "cover_sub"),
        Spacer(1, 8 * mm),
        Table([
            [P("ADMIN", "white_small"), P("USERS", "white_small"), P("WORDPRESS", "white_small")],
            [P("Organization setup, sites, policies, incidents, backups", "white_small"),
             P("Daily monitoring, investigations, escalation, reporting", "white_small"),
             P("ZIP installation, enrollment, verification, updates", "white_small")],
        ], colWidths=[CONTENT_WIDTH / 3] * 3, style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY_2),
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#31516A")),
            ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#31516A")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ])),
        Spacer(1, 28 * mm),
        P("Release 1.0 - 17 July 2026", "white_small"),
        P("Plugin package: smarthoneyai-wordpress-1.0.1.zip", "white_small"),
        P("Production origin: https://smarthoneyai.xyz", "white_small"),
    ])
    story.append(PageBreak())

    # Read first
    story.extend(section("Start here", "Read this before you begin", "This guide is written for the production release candidate and the SmartHoneyAI Agent 1.0.1 WordPress plugin."))
    story.append(callout(
        "Deployment gate",
        "At the time this guide was produced, smarthoneyai.xyz served the website but the control-plane API was not deployed because the Hostinger account had no compatible VPS. Do not install production agents until https://smarthoneyai.xyz/health/ready returns ready and an unauthenticated request to /v1/auth/me returns 401, not 404.",
        "warning",
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(cards([
        ("Platform administrator", "Owns organizations, users, sites, enrollment, policies, alert channels, backups, and incident authority."),
        ("Security operator", "Monitors events, investigates incidents, recommends rules, validates impact, and reports outcomes."),
        ("WordPress administrator", "Installs and enrolls the plugin, verifies cron and connectivity, selects decoys, and manages updates."),
        ("Read-only stakeholder", "Reviews dashboards and reports without changing sites, rules, or team access."),
    ]))
    story.append(sub("Required before production use"))
    story.append(checklist([
        "The control plane is deployed on a supported VPS with PostgreSQL, Redis, API, worker, web, and reverse proxy healthy.",
        "TLS is valid for smarthoneyai.xyz and HTTP redirects to HTTPS.",
        "A named administrator and incident contact are available.",
        "WordPress and database backups have been tested on staging.",
        "The target WordPress site is supported, healthy, and uses HTTPS plus pretty permalinks.",
        "The plugin ZIP checksum matches the release value on the final page.",
    ]))
    story.append(callout("Security rule", "Never paste enrollment tokens, API credentials, session cookies, or signing keys into tickets, chat, screenshots, or this guide.", "danger"))
    story.append(PageBreak())

    # TOC
    story.append(P("Contents", "toc_title"))
    story.append(P("Use the PDF bookmarks or the page list below to jump to a topic."))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOCLevel1", fontName="Helvetica-Bold", fontSize=9.4, leading=14, textColor=NAVY, leftIndent=0, firstLineIndent=0, spaceBefore=4),
        ParagraphStyle("TOCLevel2", fontName="Helvetica", fontSize=8.1, leading=12, textColor=MUTED, leftIndent=10 * mm, firstLineIndent=0),
    ]
    story.append(toc)
    story.append(PageBreak())

    # Overview
    story.extend(section("Orientation", "How SmartHoneyAI works", "The WordPress plugin is an inert sensor and local policy agent. The control plane receives sanitized evidence, analyzes it asynchronously, and distributes signed, expiring policies."))
    story.append(flow_diagram([
        ("WordPress", "Decoys and local rule matches"),
        ("API", "Authentication, tenancy, evidence"),
        ("Worker", "Classification and grouping"),
        ("Operators", "Review and safe response"),
    ]))
    story.append(Spacer(1, 5 * mm))
    story.append(sub("Safety properties"))
    story.append(cards([
        ("No synchronous dependency", "Normal visitors never wait for the central control plane. Local cached rules are used in the request path."),
        ("Signed and expiring", "The plugin accepts only verified policy documents and fails open after a policy expires."),
        ("Observe first", "New sites begin in OBSERVE. Enforcement is a deliberate operator action after validation."),
        ("Sanitized evidence", "Credentials, cookies, authorization headers, and common token fields are removed before delivery."),
        ("Private sources protected", "Loopback, private, and reserved ranges are protected from accidental blocking."),
        ("Tenant isolated", "Users, sites, events, policies, and incidents are scoped to an organization."),
    ]))
    story.append(sub("Status language"))
    story.append(data_table(
        ["Status", "Meaning", "Operator action"],
        [
            ["ONLINE", "Recent authenticated heartbeat and acknowledged policy.", "No action if queue and drops are normal."],
            ["DEGRADED", "Heartbeat or policy acknowledgement is late, or an error was recently resolved.", "Check the plugin status, cron, network, and queue."],
            ["OFFLINE", "No valid heartbeat inside the expected window.", "Treat as an operational incident."],
            ["OBSERVE", "Rules record matches without blocking visitors.", "Use this mode during validation and tuning."],
            ["ENFORCE", "Valid local rules may block or rate-limit matching public traffic.", "Use only after review, expiry, and rollback are prepared."],
        ],
        [25 * mm, 78 * mm, CONTENT_WIDTH - 103 * mm],
    ))
    story.append(PageBreak())

    # Admin login
    story.extend(section("Administrator", "First login and secure setup", "Start from a clean browser session and verify the production origin before entering credentials."))
    story.append(steps([
        ("Open the secure origin", "Go directly to https://smarthoneyai.xyz/login. Confirm the padlock and exact hostname. Do not follow a login link from an unexpected message."),
        ("Sign in", "Enter your assigned email and password. The dashboard should load and show Authenticated control plane."),
        ("Check organization context", "Read the organization name and All sites context in the top bar before making changes."),
        ("Review your role", "Open Team or Settings and confirm you have only the permissions required for your job."),
        ("Secure the account", "Use a unique password stored in an approved password manager. Enable MFA as soon as it is available and never share an administrator account."),
        ("Record the session", "For high-impact changes, record the ticket or incident reference, intended result, and rollback owner."),
    ]))
    story.append(sub("Stop immediately if"))
    story.append(bullets([
        "The browser shows a certificate warning or a hostname other than smarthoneyai.xyz.",
        "The page says LIVE but /health/ready is not healthy.",
        "Your organization, site count, or role is unexpected.",
        "A password manager proposes credentials for a different domain.",
    ], color=RED))
    story.append(callout("Session hygiene", "Log out at the end of an administrative task. Do not leave the dashboard open on a shared workstation.", "info"))
    story.append(PageBreak())

    # Teams
    story.extend(section("Administrator", "Organizations, roles, and invitations", "Use the smallest role that allows a person to complete their work. Review membership on a schedule and after every staffing change."))
    story.append(data_table(
        ["Role pattern", "Use for", "Avoid"],
        [
            ["Owner / administrator", "Organization settings, membership, sites, policy authority, critical incident ownership.", "Routine monitoring by every team member."],
            ["Operator", "Events, incidents, site status, rule preparation, and operational response.", "Changing organization ownership unless approved."],
            ["Viewer / stakeholder", "Dashboards, reports, audit evidence, and management visibility.", "Any write operation."],
        ],
        [38 * mm, 68 * mm, CONTENT_WIDTH - 106 * mm],
    ))
    story.append(sub("Invite a user"))
    story.append(steps([
        ("Open Team", "Select Team in the Manage section."),
        ("Enter the verified email", "Use the person's organizational email. Verify spelling through a second source."),
        ("Choose the minimum role", "Grant the lowest level that supports their responsibilities."),
        ("Create the invitation", "Copy the generated one-time message or link immediately and share it only with the intended recipient."),
        ("Replace a lost owner link", "A platform administrator can open Organizations and generate a replacement for an ownerless tenant. The previous owner link is revoked."),
        ("Confirm acceptance", "Ask the person to use the single-use link and set their own password. Existing accounts keep their current password."),
        ("Review and expire", "Remove stale invitations and offboard users immediately when access is no longer required."),
    ]))
    story.append(callout("Do not forward invitations", "Invitation tokens are single-use credentials. If the recipient or address is wrong, revoke the invitation and issue a new one.", "danger"))
    story.append(PageBreak())

    # Add site
    story.extend(section("Administrator", "Add a WordPress site and create enrollment", "Create the platform site record before touching the WordPress plugin. Each one-time enrollment token belongs to exactly one site."))
    story.append(steps([
        ("Open Sites", "Choose Sites from the Monitor section, then select Add site."),
        ("Name the site", "Use a stable business name such as Malaysia Storefront, not a temporary nickname."),
        ("Enter the canonical URL", "Use the public HTTPS origin only, for example https://store.example.com. Do not include credentials, a path, query string, or fragment."),
        ("Create the record", "Confirm the displayed hostname and organization before saving."),
        ("Generate enrollment", "Create a one-time enrollment token. Copy it directly into WordPress; do not store it in a document."),
        ("Complete WordPress enrollment", "Follow the WordPress chapter in this guide before the token expires or is used."),
        ("Verify identity", "Compare the site URL and returned Site ID in the dashboard and WordPress settings."),
    ]))
    story.append(callout("URL validation", "Production site URLs must use HTTPS. Localhost and private targets are rejected unless a development-only flag was explicitly enabled.", "info"))
    story.append(sub("Enrollment evidence to keep"))
    story.append(checklist([
        "Site name and canonical HTTPS URL.",
        "Platform Site ID after enrollment.",
        "WordPress connection status and first successful heartbeat time.",
        "Initial policy version and OBSERVE mode.",
        "Operator name, change ticket, and completion time.",
    ]))
    story.append(PageBreak())

    # Dashboard screenshot
    story.extend(section("Administrator", "Verify the control plane and site health", "The overview is the first operational checkpoint. Counts are useful, but connection state, queue depth, dropped events, and policy acknowledgement are the decisive signals."))
    story.extend(screenshot(DASHBOARD_SCREEN, "Validated release-candidate dashboard with sample data. Production values will differ."))
    story.append(data_table(
        ["Widget", "Healthy signal", "Investigate when"],
        [
            ["Agent connection", "ONLINE and recent heartbeat.", "DEGRADED, OFFLINE, or an unexpected site appears."],
            ["Queue", "Zero or draining normally.", "Queue rises continuously or dropped events are non-zero."],
            ["Policy", "Expected version is acknowledged.", "Site remains behind the active platform version."],
            ["Protection mode", "OBSERVE during onboarding; approved ENFORCE later.", "A site enforces without a recorded change."],
        ],
        [40 * mm, 60 * mm, CONTENT_WIDTH - 100 * mm],
    ))
    story.append(PageBreak())

    # Observe
    story.extend(section("Administrator", "Observe-first onboarding", "A newly enrolled site must collect normal operational evidence before any blocking rule is enabled."))
    story.append(steps([
        ("Keep the site in OBSERVE", "Confirm the protection mode and the matching value shown in WordPress."),
        ("Wait through the observation window", "Monitor representative business traffic, login behavior, scheduled jobs, payment callbacks, APIs, and administrator access."),
        ("Review detections", "Separate hostile decoy activity from legitimate scanners, uptime services, office networks, and integration callbacks."),
        ("Protect trusted ranges", "Create narrowly scoped allow rules for approved sources only. Document the owner and review date."),
        ("Draft one bounded rule", "Start with a precise match, short expiry, and the least disruptive action."),
        ("Preview impact", "Estimate recent matches, affected sites, and business routes. Confirm rollback access."),
        ("Approve enforcement", "Only an authorized operator should publish the signed policy."),
        ("Watch acknowledgement", "Confirm the agent receives the new version and remains ONLINE with no queue growth."),
    ]))
    story.append(callout("Default decision", "When evidence is incomplete, remain in OBSERVE. Detection value is preserved without risking visitor availability.", "success"))
    story.append(PageBreak())

    # Firewall
    story.extend(section("Administrator", "Create safe firewall policies", "SmartHoneyAI rules are declarative, signed, versioned, and time-limited. Use the smallest scope and shortest useful duration."))
    story.append(data_table(
        ["Rule", "Good use", "Required guardrail"],
        [
            ["ALLOW_IP", "Known office, monitoring, or integration source.", "Verified owner, narrow IP/CIDR, scheduled review."],
            ["DENY_IP", "Confirmed hostile public source.", "Short expiry and evidence reference."],
            ["DENY_CIDR", "Confirmed hostile network range.", "Peer review; never use broad ranges casually."],
            ["DENY_ROUTE", "Abuse targeting a specific public route.", "Exact bounded path and regression test."],
            ["DENY_USER_AGENT", "Distinct malicious automation signature.", "Specific pattern; avoid generic browser terms."],
            ["RATE_LIMIT", "Repeated requests that should be slowed, not fully blocked.", "Burst test and explicit window."],
        ],
        [31 * mm, 63 * mm, CONTENT_WIDTH - 94 * mm],
    ))
    story.append(sub("Publish checklist"))
    story.append(checklist([
        "Evidence and incident reference are attached.",
        "The rule does not target loopback, private, or reserved sources.",
        "Allowlist precedence is understood.",
        "Match value, action, priority, sites, and expiry were peer reviewed.",
        "Observation and impact preview are complete.",
        "Rollback owner and rollback trigger are recorded.",
        "The new policy version is acknowledged by every intended site.",
    ]))
    story.append(callout("Never create permanent emergency rules", "Use a short expiry during incident response. Renew only after evidence review; do not turn a temporary block into forgotten policy.", "warning"))
    story.append(PageBreak())

    # Events incidents
    story.extend(section("Administrator", "Events, incidents, and evidence", "An event is a sanitized detection. An incident groups related activity into a case that needs an owner and outcome."))
    story.append(flow_diagram([
        ("Event", "Sanitized request evidence"),
        ("Triage", "Severity, confidence, context"),
        ("Incident", "Owner, status, linked evidence"),
        ("Response", "Observe, allow, limit, or deny"),
    ]))
    story.append(sub("Investigation sequence"))
    story.append(steps([
        ("Confirm the site and time", "Check timezone, site, route, method, and received time."),
        ("Read the action", "OBSERVED, BLOCKED, or RATE_LIMITED describes what the local site did."),
        ("Assess evidence quality", "Use threat type, confidence, severity, source context, and repeat count. Never infer identity from IP alone."),
        ("Look for a pattern", "Compare adjacent events across the same site and portfolio."),
        ("Open or update an incident", "Assign an owner, status, severity, and summary that can be understood without raw secrets."),
        ("Choose a response", "No action, continue observation, allow trusted traffic, rate-limit, or create a bounded deny rule."),
        ("Document the outcome", "Record the decision, evidence, policy version, result, and follow-up date."),
    ]))
    story.append(callout("Evidence handling", "The platform sanitizes common secrets, but operators must still avoid copying payloads into uncontrolled systems.", "info"))
    story.append(PageBreak())

    # Alerts reports monitoring
    story.extend(section("Administrator", "Alerts, reports, and monitoring", "Alert delivery is a signal, not the source of truth. The platform and site status remain authoritative."))
    story.append(cards([
        ("In-app", "Primary operator queue for ownership, status, and linked evidence."),
        ("Email", "Password-reset delivery depends on configured SMTP. Invitations use operator-shared one-time links."),
        ("Telegram", "Optional incident notification. The bot token is a runtime secret and is never stored in organization settings."),
        ("Prometheus", "Collects API and worker health and supports alert rules."),
        ("Grafana", "Operational dashboards. Protect the administrator password and do not expose it anonymously."),
        ("External uptime", "Monitor HTTPS readiness from outside the VPS so a total host outage is still detected."),
    ]))
    story.append(sub("Daily administrator review"))
    story.append(checklist([
        "Public HTTPS and /health/ready are available.",
        "API, worker, PostgreSQL, Redis, and reverse proxy are healthy.",
        "All expected WordPress sites are ONLINE or have an assigned incident.",
        "No site has unexpected enforcement, queue growth, or dropped events.",
        "Critical incidents and failed alert deliveries have owners.",
        "Backup jobs and certificate expiry are within policy.",
    ]))
    story.append(PageBreak())

    # Backup offboarding
    story.extend(section("Administrator", "Backups, recovery, and offboarding", "Production readiness is not complete until restoration has been practiced on the actual hosting environment."))
    story.append(data_table(
        ["Asset", "Back up", "Restore proof"],
        [
            ["PostgreSQL", "Encrypted database dump to off-host storage.", "Restore to an isolated database and verify counts and login."],
            ["Redis", "Persistence volume if operational continuity requires it.", "Start a replacement service and verify queues safely."],
            ["Secrets", "Approved secret manager or encrypted offline copy.", "Confirm documented key and password recovery without exposing values."],
            ["TLS", "Certificate and private key according to certificate policy.", "Validate hostname, chain, and expiry on staging."],
            ["Monitoring", "Grafana, Prometheus, and Alertmanager persistent data/configuration.", "Bring up dashboards and rules in isolation."],
            ["WordPress", "Database plus wp-content and provider-specific configuration.", "Restore a staging clone and complete agent sync."],
        ],
        [30 * mm, 68 * mm, CONTENT_WIDTH - 98 * mm],
    ))
    story.append(sub("Offboard a site"))
    story.append(steps([
        ("Freeze policy changes", "Confirm no active response depends on the site."),
        ("Disconnect WordPress", "Use Settings > SmartHoneyAI > Disconnect to remove local credentials."),
        ("Decide data retention", "Follow the organization's incident and audit policy before deleting platform history."),
        ("Remove the platform site", "Revoke enrollment and agent access."),
        ("Uninstall the plugin", "Select delete-data only when authorized; then deactivate and delete."),
        ("Close the record", "Document completion, retained evidence, backup location, and responsible operator."),
    ]))
    story.append(PageBreak())

    # User daily
    story.extend(section("Users and operators", "Daily workflow", "Operators should begin with posture, then move from the highest-risk unresolved item toward documented closure."))
    story.append(steps([
        ("Check scope", "Confirm the organization and All sites or selected site context."),
        ("Check connection health", "Review ONLINE, DEGRADED, and OFFLINE sites before event volume."),
        ("Review critical incidents", "Take ownership or escalate anything unassigned."),
        ("Scan recent detections", "Look for new routes, sudden volume, repeated sources, and blocked business traffic."),
        ("Investigate", "Use the event workflow on the next page. Keep notes concise and evidence based."),
        ("Recommend a response", "Operators may recommend policy; only authorized roles should publish it."),
        ("Verify outcome", "Confirm the site remains ONLINE, the queue drains, and policy acknowledgement is current."),
        ("Hand over", "Record open incidents, expiring rules, and watch items for the next shift."),
    ]))
    story.append(callout("Do not chase volume alone", "A small number of high-confidence events on a sensitive route can matter more than thousands of harmless probes.", "info"))
    story.append(PageBreak())

    # User event investigation
    story.extend(section("Users and operators", "Investigate an event", "Use the same order every time so decisions are repeatable and auditable."))
    story.append(data_table(
        ["Question", "What to inspect", "Why it matters"],
        [
            ["Where?", "Organization, site, route, and HTTP method.", "Prevents applying a portfolio-wide conclusion to one site."],
            ["When?", "Received time, site timezone, and sequence.", "Correlates the event with releases and business activity."],
            ["What happened?", "HONEYPOT, FIREWALL, RATE_LIMIT, action, and status.", "Separates detection from actual blocking."],
            ["How certain?", "Threat type, confidence, severity, and explanation.", "Supports proportional response."],
            ["How broad?", "Repeat count, related sources, routes, sites, and incidents.", "Shows whether this is isolated or coordinated."],
            ["What could break?", "Trusted integrations, administrators, APIs, callbacks, and payment flows.", "Prevents security action from becoming an outage."],
        ],
        [31 * mm, 73 * mm, CONTENT_WIDTH - 104 * mm],
    ))
    story.append(sub("Close with one of these outcomes"))
    story.append(cards([
        ("Benign / expected", "Document why and create a narrow allow rule only when needed."),
        ("Observe", "Keep collecting evidence; set a review time."),
        ("Rate-limit", "Use when traffic is abusive but a hard block is too disruptive."),
        ("Deny", "Use confirmed evidence, precise match, short expiry, and peer review."),
        ("Escalate", "Assign an incident when scope, impact, or certainty needs deeper handling."),
        ("Platform issue", "Create an operational incident for connectivity, queues, policy lag, or dropped events."),
    ]))
    story.append(PageBreak())

    # User incident
    story.extend(section("Users and operators", "Manage incidents and handoffs", "A good incident record lets the next person understand the risk, decision, and current state without reconstructing the case."))
    story.append(sub("Minimum incident record"))
    story.append(checklist([
        "Clear title naming the site, behavior, and impact.",
        "Owner, severity, status, opened time, and next review time.",
        "Short timeline using platform timestamps.",
        "Linked events and explanation of why they are related.",
        "Known customer or business impact.",
        "Actions taken, policy version, expiry, and acknowledgement state.",
        "Rollback conditions and responsible operator.",
        "Resolution, lessons, and follow-up work.",
    ]))
    story.append(sub("Suggested status flow"))
    story.append(flow_diagram([
        ("OPEN", "New and unowned or awaiting triage"),
        ("INVESTIGATING", "Owner gathering evidence"),
        ("CONTAINED", "Risk controlled and monitored"),
        ("RESOLVED", "Outcome verified and documented"),
    ]))
    story.append(Spacer(1, 5 * mm))
    story.append(callout("Handoff test", "If the next operator cannot state what is happening, what was changed, and what to watch in under two minutes, the record needs a clearer summary.", "success"))
    story.append(PageBreak())

    # WP preflight
    story.extend(section("WordPress administrator", "Pre-installation checklist", "Install on staging first. The plugin is deliberately inert, but enrollment and policy delivery still require a controlled change."))
    story.append(checklist([
        "WordPress 6.2 or later. Release validation used WordPress 7.0 and PHP 8.3.",
        "PHP 7.4 or later with the sodium extension available.",
        "The site uses a valid HTTPS public origin.",
        "Pretty permalinks are enabled and rewrite rules work.",
        "A current WordPress database and wp-content backup is restorable.",
        "The administrator can install plugins and edit Settings.",
        "Outbound HTTPS to smarthoneyai.xyz is allowed.",
        "A reliable WordPress cron mechanism runs at least every minute so signed honeypot routes synchronize promptly.",
        "Caching and security layers are documented so decoy routes can be excluded if necessary.",
        "The platform site record and one-time enrollment token are ready.",
    ]))
    story.append(sub("Release file"))
    story.append(code_block(
        "File: smarthoneyai-wordpress-1.0.1.zip\n"
        "SHA-256: 6d373d97974ea27d128648f5f6af08e4c001d3d0fcba7df0b0607917ab01b859"
    ))
    story.append(callout("Backup is not optional", "Do not install or update a security plugin on a production WordPress site without a tested rollback path.", "danger"))
    story.append(PageBreak())

    # WP install
    story.extend(section("WordPress administrator", "Install the plugin ZIP", "Use the WordPress administration interface unless your hosting change process requires WP-CLI."))
    story.append(steps([
        ("Verify the ZIP", "Compare the SHA-256 checksum with the value in this guide. Stop if it differs."),
        ("Open WordPress Admin", "Sign in to the target site's /wp-admin using an administrator account."),
        ("Open Add Plugin", "Choose Plugins > Add Plugin, then Upload Plugin."),
        ("Select the release", "Choose smarthoneyai-wordpress-1.0.1.zip. Do not unzip and edit the package."),
        ("Install", "Select Install Now and wait for WordPress to report a successful installation."),
        ("Activate", "Select Activate Plugin. If activation fails, copy the error to the change record and roll back."),
        ("Open settings", "Go to Settings > SmartHoneyAI or use the Settings link beside the plugin."),
    ]))
    story.append(sub("Optional WP-CLI installation"))
    story.append(code_block(
        "wp plugin install /secure/path/smarthoneyai-wordpress-1.0.1.zip --activate\n"
        "wp plugin status honeypot-ai"
    ))
    story.append(callout("Expected initial state", "Before enrollment, Connection is not ONLINE and the page displays Control plane URL plus One-time enrollment token fields.", "info"))
    story.append(PageBreak())

    # WP connect
    story.extend(section("WordPress administrator", "Enroll the WordPress agent", "Complete this step in one controlled session. The enrollment token is sent once and is never stored by WordPress."))
    story.append(steps([
        ("Confirm the platform is ready", "Open https://smarthoneyai.xyz/health/ready and require a ready response."),
        ("Copy the one-time token", "In SmartHoneyAI Sites, open the correct site and generate enrollment. Keep the token only in the clipboard."),
        ("Enter the control plane URL", "In WordPress Settings > SmartHoneyAI, enter https://smarthoneyai.xyz with no path or trailing credentials."),
        ("Enter the token", "Paste the one-time enrollment token into the password-style field."),
        ("Enroll site", "Select Enroll site once. Do not refresh or resubmit while the request is processing."),
        ("Verify returned identity", "The page should show the expected Site ID, control plane, and initial policy."),
        ("Destroy temporary copies", "Clear any clipboard history if required by policy. The token cannot be reused."),
    ]))
    story.append(callout("If enrollment fails", "Do not repeatedly retry the same token. Check the exact error, platform readiness, site URL, TLS, outbound HTTPS, PHP sodium, and time synchronization. Revoke and create a new token when needed.", "warning"))
    story.append(PageBreak())

    # WP verify screenshot
    story.extend(section("WordPress administrator", "Verify ONLINE status", "A successful form submission is not enough. Confirm connection, queue, policy, cron, and the platform view."))
    story.extend(screenshot(WORDPRESS_SCREEN, "Validated WordPress 7.0 agent settings screen with sample local data. Production control plane must read https://smarthoneyai.xyz."))
    story.append(data_table(
        ["Field", "Expected after enrollment"],
        [
            ["Connection", "ONLINE after the first successful heartbeat."],
            ["Control plane", "https://smarthoneyai.xyz in production."],
            ["Site ID", "Matches the platform site record."],
            ["Event spool", "Normally 0 and below both event and byte limits."],
            ["Dropped events", "0."],
            ["Policy", "A version, OBSERVE mode, and future expiry."],
            ["Last agent error", "Empty or clearly marked resolved."],
        ],
        [45 * mm, CONTENT_WIDTH - 45 * mm],
    ))
    story.append(PageBreak())

    # Decoys cron
    story.extend(section("WordPress administrator", "Configure decoys and cron", "The four built-in routes are inert. They never authenticate, expose backups, open consoles, or execute submitted content."))
    story.append(data_table(
        ["Setting", "Decoy route"],
        [
            ["Fake administration login", "/secure-admin-login"],
            ["Backup archive", "/wp-content/backups/site-backup.zip"],
            ["Internal console", "/internal/admin-console"],
            ["Database administration", "/phpmyadmin"],
        ],
        [70 * mm, CONTENT_WIDTH - 70 * mm],
    ))
    story.append(steps([
        ("Choose decoys", "Keep all four enabled unless a route conflicts with a documented business requirement."),
        ("Save settings", "Select Save settings. Flush permalinks once if routes do not resolve."),
        ("Exclude from caching", "Do not let a CDN or page cache serve stored decoy responses across requests."),
        ("Configure cron", "If WP-Cron is disabled, schedule wp cron event run --due-now at least every minute."),
        ("Sync", "Use Sync now after network recovery or when validating a policy acknowledgement."),
        ("Watch the spool", "A rising queue means delivery is failing. The site remains available, but an operator must investigate."),
    ]))
    story.append(code_block("*/5 * * * * cd /var/www/html && wp cron event run --due-now --quiet"))
    story.append(callout("Do not probe production casually", "Testing a decoy creates security evidence. Use a documented staging test or an approved production test window.", "warning"))
    story.append(PageBreak())

    # Updates rollback uninstall
    story.extend(section("WordPress administrator", "Update, roll back, disconnect, and uninstall", "Treat every plugin update as a security change with a backup, maintenance window, and verification checklist."))
    story.append(sub("Update procedure"))
    story.append(steps([
        ("Review release notes", "Confirm WordPress/PHP support, migration notes, and the new checksum."),
        ("Test on staging", "Enroll staging, verify heartbeat, queue, signed policy, decoys, and fail-open behavior."),
        ("Back up production", "Capture database and wp-content according to the site runbook."),
        ("Install the update", "Use the approved ZIP or deployment method. Do not edit plugin files in WordPress."),
        ("Verify", "Require ONLINE, queue 0, drops 0, expected policy, and normal public pages."),
        ("Observe", "Keep the change open through the agreed monitoring window."),
    ]))
    story.append(sub("Rollback or removal"))
    story.append(bullets([
        "Rollback: restore the prior approved plugin package and verify the site before closing the incident.",
        "Disconnect: Settings > SmartHoneyAI > Disconnect removes local enrollment credentials but leaves the plugin installed.",
        "Retain data on uninstall: leave the delete-data box clear, then deactivate and delete.",
        "Erase plugin data on uninstall: select the delete-data box only with explicit retention approval, save, then deactivate and delete.",
    ]))
    story.append(callout("Destructive choice", "Delete-data removes plugin settings, credentials, cached policy, and queued events. Confirm evidence retention before selecting it.", "danger"))
    story.append(PageBreak())

    # Troubleshooting
    story.extend(section("Troubleshooting", "Fast diagnosis matrix", "Start with readiness and exact status. Avoid repeated destructive retries."))
    story.append(data_table(
        ["Symptom", "Likely cause", "Action"],
        [
            ["Enrollment token invalid", "Wrong, expired, reused, or truncated token.", "Revoke it, confirm the site, and create a new one-time token."],
            ["Control plane URL rejected", "Not HTTPS, includes path/query/credentials, or wrong host.", "Use exactly https://smarthoneyai.xyz."],
            ["TLS / HTTP error", "Certificate, DNS, proxy, egress, or clock problem.", "Verify with curl from the WordPress host and inspect certificate dates."],
            ["DEGRADED", "Late heartbeat, recent error, policy lag, or cron delay.", "Run due cron, Sync now, and check the detailed error."],
            ["OFFLINE", "No valid heartbeat.", "Check cron, outbound HTTPS, DNS, TLS, plugin activation, and platform health."],
            ["Queue increasing", "API outage or delivery failure.", "Keep the site available; restore connectivity and confirm exact-once drain."],
            ["Dropped events > 0", "Queue row/byte limits were exceeded.", "Open an incident, restore delivery, and assess evidence loss."],
            ["Policy not updating", "Signature/time issue, expired document, replay protection, or stale cron.", "Check system time, Sync now, platform health, and last agent error."],
            ["Unexpected block", "Rule too broad or missing allowlist.", "Roll back/expire the rule, return to OBSERVE, and document impact."],
            ["Decoy is 404", "Permalinks/rewrite rules not flushed or decoy disabled.", "Save Permalinks once and verify the enabled checkbox."],
            ["Normal site is slow", "Not normally caused by control plane because requests use local policy.", "Profile WordPress; check database/cache and rule count, then compare with plugin disabled on staging."],
            ["API path returns 404", "Only the frontend is deployed.", "Stop production enrollment and deploy the full VPS topology."],
        ],
        [35 * mm, 56 * mm, CONTENT_WIDTH - 91 * mm],
    ))
    story.append(PageBreak())

    # Security privacy
    story.extend(section("Security and privacy", "Operational rules that protect the platform", "SmartHoneyAI reduces collected data, but good operator behavior remains essential."))
    story.append(cards([
        ("Secrets", "Use runtime secret mounts or an approved manager. Never commit secrets or place them in organization configuration."),
        ("Enrollment", "One token, one site, one use. Revoke on doubt."),
        ("Evidence", "Treat all event data as security-sensitive even after sanitization."),
        ("Policies", "Use signed, expiring, narrow rules with allowlist precedence and rollback."),
        ("Access", "Use named accounts and minimum roles. Review membership and sessions."),
        ("Host", "Keep PostgreSQL and Redis private. Expose only the reverse proxy to the internet."),
        ("Backups", "Encrypt off-host backups and practice restoration."),
        ("Updates", "Track Node, WordPress, plugin, container base, and dependency advisories."),
    ]))
    story.append(sub("Data SmartHoneyAI should never receive"))
    story.append(bullets([
        "Passwords, password reset secrets, API keys, private keys, or enrollment tokens.",
        "Session cookies, authorization headers, or full payment data.",
        "Unnecessary form bodies or database exports.",
        "Unredacted customer evidence copied manually by an operator.",
    ], color=RED))
    story.append(callout("Commercial launch gate", "Require MFA for privileged accounts and complete an independent penetration test before expanding beyond the controlled pilot.", "warning"))
    story.append(PageBreak())

    # Go live
    story.extend(section("Go-live", "Final production checklist", "The release is live only when the full control plane is healthy, a staging agent succeeds, and operators can recover from failure."))
    story.append(checklist([
        "A Hostinger VPS exists and meets the approved CPU, memory, storage, and backup requirements.",
        "Production secrets, Ed25519 signing keys, model revision, optional password-reset SMTP, and optional Telegram token are configured.",
        "TLS hostname and expiry checks pass for smarthoneyai.xyz.",
        "Docker Compose starts PostgreSQL, Redis, migrations, API, worker, web, Nginx, and monitoring healthy.",
        "https://smarthoneyai.xyz/health/ready returns ready.",
        "An unauthenticated https://smarthoneyai.xyz/v1/auth/me returns 401, not 404.",
        "Database-backed administrator login works and the organization is correct.",
        "A staging WordPress site enrolls, reaches ONLINE, sends events exactly once, and receives a signed OBSERVE policy.",
        "API outage and Redis replay tests fail safely and recover.",
        "Off-host backup and restore proof is attached to the launch record.",
        "External uptime monitoring and incident alerts are active.",
        "The public DNS cutover and rollback owner are confirmed.",
    ]))
    story.append(sub("Release integrity"))
    story.append(code_block(
        "smarthoneyai-wordpress-1.0.1.zip\n"
        "SHA-256  6d373d97974ea27d128648f5f6af08e4c001d3d0fcba7df0b0607917ab01b859"
    ))
    story.append(callout("Support bundle", "When escalating, include time, site ID, connection state, policy version, queue/drops, sanitized error code, and the relevant incident ID. Never include credentials or tokens.", "info"))
    story.append(Spacer(1, 8 * mm))
    story.append(P("End of guide", "h2"))
    story.append(P("This manual is based on the audited SmartHoneyAI release candidate dated 17 July 2026. Update the manual when roles, screens, plugin fields, security controls, or deployment topology change."))
    return story


def main() -> None:
    os.umask(0o077)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = GuideDocument(str(OUTPUT))
    document.multiBuild(build_story())
    print(OUTPUT)


if __name__ == "__main__":
    main()
