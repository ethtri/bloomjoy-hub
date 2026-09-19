from __future__ import annotations

from pathlib import Path
from typing import Callable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
LOGO_PATH = ROOT / "src" / "assets" / "logo.png"
EN_FONT = Path(r"C:\Windows\Fonts\NotoSans-Regular.ttf")
EN_BOLD = Path(r"C:\Windows\Fonts\NotoSans-Bold.ttf")
ZH_FONT = Path(r"C:\Windows\Fonts\simhei.ttf")

PINK = colors.HexColor("#E97191")
PINK_DARK = colors.HexColor("#B94468")
PINK_PALE = colors.HexColor("#FFF2F6")
INK = colors.HexColor("#222531")
MUTED = colors.HexColor("#626775")
BORDER = colors.HexColor("#E8DCE1")
SAGE = colors.HexColor("#4F7B70")
SAGE_PALE = colors.HexColor("#EEF7F4")
AMBER = colors.HexColor("#A86718")
AMBER_PALE = colors.HexColor("#FFF6E8")
WHITE = colors.white

APP_URL = "https://app.bloomjoyusa.com"
TIME_URL = f"{APP_URL}/portal/time"
REVIEW_URL = f"{APP_URL}/portal/time-review"
PAY_URL = f"{APP_URL}/admin/payouts"


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("BJ-Regular", str(EN_FONT)))
    pdfmetrics.registerFont(TTFont("BJ-Bold", str(EN_BOLD)))
    pdfmetrics.registerFont(TTFont("BJ-ZH", str(ZH_FONT)))


def make_styles(language: str) -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    regular = "BJ-ZH" if language == "zh" else "BJ-Regular"
    bold = "BJ-ZH" if language == "zh" else "BJ-Bold"
    cjk = "CJK" if language == "zh" else None

    def style(name: str, **kwargs) -> ParagraphStyle:
        return ParagraphStyle(name, parent=base["BodyText"], wordWrap=cjk, **kwargs)

    return {
        "cover_kicker": style(
            "cover_kicker",
            fontName=bold,
            fontSize=9,
            leading=12,
            textColor=PINK_DARK,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_title": style(
            "cover_title",
            fontName=bold,
            fontSize=28 if language == "en" else 26,
            leading=34,
            textColor=INK,
            alignment=TA_CENTER,
            spaceAfter=10,
        ),
        "cover_subtitle": style(
            "cover_subtitle",
            fontName=regular,
            fontSize=12,
            leading=18,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "page_kicker": style(
            "page_kicker",
            fontName=bold,
            fontSize=8.5,
            leading=11,
            textColor=PINK_DARK,
            spaceAfter=5,
        ),
        "page_title": style(
            "page_title",
            fontName=bold,
            fontSize=22 if language == "en" else 21,
            leading=27,
            textColor=INK,
            spaceAfter=7,
        ),
        "page_intro": style(
            "page_intro",
            fontName=regular,
            fontSize=10.3,
            leading=15.5,
            textColor=MUTED,
            spaceAfter=12,
        ),
        "section": style(
            "section",
            fontName=bold,
            fontSize=12.5,
            leading=16,
            textColor=INK,
            spaceAfter=6,
        ),
        "body": style(
            "body",
            fontName=regular,
            fontSize=9.2,
            leading=13.5,
            textColor=INK,
        ),
        "small": style(
            "small",
            fontName=regular,
            fontSize=8.1,
            leading=11.5,
            textColor=MUTED,
        ),
        "small_bold": style(
            "small_bold",
            fontName=bold,
            fontSize=8.4,
            leading=11.5,
            textColor=INK,
        ),
        "card_title": style(
            "card_title",
            fontName=bold,
            fontSize=10.2,
            leading=13,
            textColor=INK,
            spaceAfter=3,
        ),
        "card_body": style(
            "card_body",
            fontName=regular,
            fontSize=8.4,
            leading=12.2,
            textColor=MUTED,
        ),
        "link": style(
            "link",
            fontName=regular,
            fontSize=8.2,
            leading=11,
            textColor=PINK_DARK,
        ),
        "number": style(
            "number",
            fontName=bold,
            fontSize=11,
            leading=14,
            textColor=WHITE,
            alignment=TA_CENTER,
        ),
        "metric": style(
            "metric",
            fontName=bold,
            fontSize=15,
            leading=18,
            textColor=PINK_DARK,
            alignment=TA_CENTER,
        ),
        "metric_label": style(
            "metric_label",
            fontName=regular,
            fontSize=7.7,
            leading=10,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
    }


def p(text: str, styles: dict[str, ParagraphStyle], name: str = "body") -> Paragraph:
    return Paragraph(text, styles[name])


def card(title: str, body: str, styles: dict[str, ParagraphStyle], tint=PINK_PALE) -> Table:
    content = [p(title, styles, "card_title"), p(body, styles, "card_body")]
    table = Table([[content]], colWidths=[3.18 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), tint),
                ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def step(number: int, title: str, body: str, styles: dict[str, ParagraphStyle]) -> Table:
    number_cell = Table([[p(str(number), styles, "number")]], colWidths=[0.34 * inch], rowHeights=[0.34 * inch])
    number_cell.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PINK),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    text = [p(title, styles, "card_title"), p(body, styles, "card_body")]
    table = Table([[number_cell, text]], colWidths=[0.48 * inch, 6.18 * inch])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def metric(value: str, label: str, styles: dict[str, ParagraphStyle]) -> list[Paragraph]:
    return [p(value, styles, "metric"), p(label, styles, "metric_label")]


def header_block(kicker: str, title: str, intro: str, styles: dict[str, ParagraphStyle]) -> list:
    return [p(kicker.upper(), styles, "page_kicker"), p(title, styles, "page_title"), p(intro, styles, "page_intro")]


def link_line(label: str, url: str, styles: dict[str, ParagraphStyle]) -> Paragraph:
    return p(f'<b>{label}</b><br/><link href="{url}" color="#B94468">{url}</link>', styles, "link")


def page_decor(canvas, doc, language: str) -> None:
    canvas.saveState()
    width, height = letter
    canvas.setFillColor(colors.HexColor("#FFF9FB"))
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.setFillColor(PINK)
    canvas.rect(0, height - 0.12 * inch, width, 0.12 * inch, stroke=0, fill=1)
    canvas.setStrokeColor(BORDER)
    canvas.line(0.66 * inch, 0.5 * inch, width - 0.66 * inch, 0.5 * inch)
    canvas.setFont("BJ-ZH" if language == "zh" else "BJ-Regular", 7.4)
    canvas.setFillColor(MUTED)
    footer = "Bloomjoy Hub - 工时与技术员薪酬" if language == "zh" else "Bloomjoy Hub - Timekeeping & Technician Pay"
    canvas.drawString(0.66 * inch, 0.29 * inch, footer)
    canvas.drawRightString(width - 0.66 * inch, 0.29 * inch, str(doc.page))
    canvas.restoreState()


def build_document(language: str, output_path: Path) -> None:
    styles = make_styles(language)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(output_path),
        pagesize=letter,
        leftMargin=0.66 * inch,
        rightMargin=0.66 * inch,
        topMargin=0.58 * inch,
        bottomMargin=0.62 * inch,
        title="Bloomjoy Hub Timekeeping and Technician Pay User Guide"
        if language == "en"
        else "Bloomjoy Hub 工时与技术员薪酬使用指南",
        author="Bloomjoy",
        subject="Technician and manager guide",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates(
        [PageTemplate(id="guide", frames=[frame], onPage=lambda c, d: page_decor(c, d, language))]
    )

    story = build_english(styles) if language == "en" else build_chinese(styles)
    doc.build(story)


def build_cover(
    styles: dict[str, ParagraphStyle],
    language: str,
    kicker: str,
    title: str,
    subtitle: str,
    roles: tuple[tuple[str, str], tuple[str, str]],
    flow: tuple[str, str, str, str],
    links: tuple[str, str, str],
) -> list:
    logo = Image(str(LOGO_PATH), width=0.82 * inch, height=0.82 * inch)
    logo.hAlign = "CENTER"
    items: list = [Spacer(1, 0.28 * inch), logo, Spacer(1, 0.13 * inch)]
    items += [p(kicker, styles, "cover_kicker"), p(title, styles, "cover_title"), p(subtitle, styles, "cover_subtitle")]
    items.append(Spacer(1, 0.27 * inch))

    role_table = Table(
        [[card(roles[0][0], roles[0][1], styles), card(roles[1][0], roles[1][1], styles, SAGE_PALE)]],
        colWidths=[3.28 * inch, 3.28 * inch],
        hAlign="CENTER",
    )
    role_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
    items += [role_table, Spacer(1, 0.27 * inch)]

    flow_cells = []
    for index, label in enumerate(flow, start=1):
        flow_cells.append([p(f"{index:02d}", styles, "metric"), p(label, styles, "metric_label")])
    flow_table = Table([flow_cells], colWidths=[1.63 * inch] * 4, rowHeights=[0.7 * inch])
    flow_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.7, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    items += [flow_table, Spacer(1, 0.3 * inch)]

    link_labels = (
        ("App", "Technician Time", "Manager Pay Report")
        if language == "en"
        else ("应用首页", "技术员工时", "主管薪酬报告")
    )
    link_table = Table(
        [[
            link_line(link_labels[0], links[0], styles),
            link_line(link_labels[1], links[1], styles),
            link_line(link_labels[2], links[2], styles),
        ]],
        colWidths=[2.17 * inch] * 3,
    )
    link_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PINK_PALE),
                ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.7, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    items += [link_table, Spacer(1, 0.2 * inch)]
    version = "Prepared September 2026 - Current production workflow" if language == "en" else "2026 年 9 月编制 - 以当前生产流程为准"
    items += [p(version, styles, "small"), PageBreak()]
    return items


def build_english(styles: dict[str, ParagraphStyle]) -> list:
    story: list = []
    story += build_cover(
        styles,
        "en",
        "BLOOMJOY OPERATIONS GUIDE",
        "Timekeeping & Technician Pay",
        "A concise guide to recording work, reviewing time, calculating technician earnings, and publishing Pay Stubs.",
        (
            ("For Technicians", "Record completed work by machine, see the paid-shift preview, correct entries before cutoff, and download published Pay Stubs."),
            ("For Managers & Super Admins", "Set up access and pay rules, review or correct time, monitor calculation readiness, and publish accurate Pay Stubs."),
        ),
        ("Record time", "Review", "Calculate pay", "Publish Pay Stub"),
        (APP_URL, TIME_URL, PAY_URL),
    )

    story += header_block(
        "Technician experience",
        "A simple weekly workflow",
        "Technicians use one mobile-friendly calendar to record completed work. They only see their own entries and the machines assigned to them.",
        styles,
    )
    tech_steps = [
        ("Open Timekeeping", f'Sign in at <link href="{TIME_URL}" color="#B94468">{TIME_URL}</link>. The weekly calendar opens to the current week.'),
        ("Choose a day and add time", "Select Add time, choose the work date and assigned machine, then enter the actual start and end time. Times use that machine location's timezone."),
        ("Check the pay preview", "Before saving, the app shows actual worked time and the calculated paid shifts. Each entry rounds up independently to the next started hour."),
        ("Review or correct the week", "The calendar shows each entry by day. The technician may edit or remove an entry while the month remains open."),
        ("Download Pay Stubs", "Published Pay Stubs appear below the weekly calendar. The technician can view only their own current statement for each period."),
    ]
    for i, (title, body) in enumerate(tech_steps, 1):
        story.append(step(i, title, body, styles))

    example = Table(
        [[metric("3h 10m", "actual work", styles), metric("4", "paid shifts", styles), metric("1 entry", "one machine", styles)]],
        colWidths=[2.17 * inch] * 3,
    )
    example.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.8, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.8, BORDER), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story += [Spacer(1, 0.08 * inch), p("Paid-shift example", styles, "section"), example, Spacer(1, 0.13 * inch)]
    notes = Table(
        [[
            card("Keep entries separate", "Work on different machines should be entered separately so the pay calculation and machine history stay clear.", styles, AMBER_PALE),
            card("After month close", "Technician editing closes after the fourth calendar day following month-end. A manager can still correct or add missing time.", styles, SAGE_PALE),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    notes.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
    story += [notes, PageBreak()]

    story += header_block(
        "Manager & Super Admin experience",
        "Set up, review, and publish",
        "Managers have two working views: Time Review for the source time entries, and Technician Pay Report for pay setup, calculations, exceptions, and Pay Stubs.",
        styles,
    )
    manager_cards = Table(
        [[
            card("Time Review", f'Open <link href="{REVIEW_URL}" color="#B94468">{REVIEW_URL}</link><br/>Filter by month, technician, or machine. Correct existing entries or add missed completed work on a technician\'s behalf. Changes retain audit history.', styles),
            card("Technician Pay Report", f'Open <link href="{PAY_URL}" color="#B94468">{PAY_URL}</link><br/>See worked time, paid shifts, rates, machine sales, refunds, estimated sales tax, commission, other earnings, totals, and publication status.', styles, SAGE_PALE),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    manager_cards.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
    story += [manager_cards, Spacer(1, 0.19 * inch)]

    setup_steps = [
        ("Activate Timekeeping", "Choose the technician, effective start date, email/name, and every machine where they may record time."),
        ("Set machine-specific pay", "For each machine, enter pay per started hour and choose no commission, 3% after three months, or a custom percentage and start date."),
        ("Review source time", "Check actual time and paid shifts. Correct mistakes or add a missed entry, including after the technician cutoff."),
        ("Resolve calculation blockers", "The report identifies missing rates, assignment gaps, or stale/missing sales inputs that would make a Pay Stub incomplete."),
        ("Publish or regenerate", "Publish when the calculation is complete. Later source corrections require a new immutable Pay Stub version; older versions remain available for manager audit."),
    ]
    for i, (title, body) in enumerate(setup_steps, 1):
        story.append(step(i, title, body, styles))

    story += [Spacer(1, 0.03 * inch)]
    scope = Table(
        [[
            card("Manager scope", "Managers see only the technicians and machines in their effective authority. Machine-only managers can review time but do not automatically receive account-level pay access.", styles, AMBER_PALE),
            card("Super Admin overview", "A Super Admin can see the full report, set up technicians across authorized accounts, maintain pay inputs, investigate exceptions, and publish Pay Stubs.", styles, SAGE_PALE),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    scope.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
    story += [scope, PageBreak()]

    story += header_block(
        "Monthly pay lifecycle",
        "From completed work to Pay Stub",
        "The app connects technician-entered time with authorized pay rules and machine reporting data. It creates a clear calculation record without pretending to be a bank or payroll processor.",
        styles,
    )

    lifecycle_rows = [
        ["1", "During the month", "Technicians add completed work by machine. Managers can review and correct entries as needed."],
        ["2", "Month-end + 4 days", "Technicians retain a short correction window through the fourth calendar day after month-end."],
        ["3", "After cutoff", "Manager corrections remain available. The report checks rates, assignments, sales freshness, taxes, commissions, and other earnings."],
        ["4", "Publication", "A complete calculation can be published as a private Pay Stub. Incomplete records remain blocked and explain what is missing."],
        ["5", "After publication", "A later correction marks the statement for regeneration and creates a new version rather than overwriting history."],
    ]
    lifecycle = Table(
        [[p("STEP", styles, "small_bold"), p("WHEN", styles, "small_bold"), p("WHAT HAPPENS", styles, "small_bold")]]
        + [[p(a, styles, "small_bold"), p(b, styles, "small_bold"), p(c, styles, "small")] for a, b, c in lifecycle_rows],
        colWidths=[0.47 * inch, 1.42 * inch, 4.64 * inch],
        repeatRows=1,
    )
    lifecycle.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), PINK_PALE), ("BOX", (0, 0), (-1, -1), 0.7, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story += [lifecycle, Spacer(1, 0.18 * inch)]

    pay_components = Table(
        [[
            card("Shift earnings", "Each machine-specific entry rounds up to paid shifts. The effective rate for that technician and machine is applied to each shift.", styles),
            card("Commission", "Commissionable Sales are calculated from machine sales minus refunds and estimated sales tax, then multiplied by the effective commission rate.", styles, SAGE_PALE),
        ], [
            card("Other earnings", "Managers may add authorized Bonus, Supply Credit, Expense Reimbursement, or another clearly described adjustment.", styles, AMBER_PALE),
            card("Private Pay Stub", "The statement shows the current period and year-to-date totals. Technicians see only their own published files; managers retain audit history.", styles),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    pay_components.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [pay_components, Spacer(1, 0.14 * inch)]
    story += [p("Important boundary", styles, "section"), p("The app calculates and publishes contractor Pay Stubs. It does not send money, mark a technician as paid, calculate payroll tax withholding, file tax forms, or replace manager review of missing source data.", styles, "body"), Spacer(1, 0.16 * inch)]
    story += [p("Quick links", styles, "section"), link_line("Technician Time", TIME_URL, styles), Spacer(1, 0.04 * inch), link_line("Manager Time Review", REVIEW_URL, styles), Spacer(1, 0.04 * inch), link_line("Technician Pay Report", PAY_URL, styles)]
    return story


def build_chinese(styles: dict[str, ParagraphStyle]) -> list:
    story: list = []
    story += build_cover(
        styles,
        "zh",
        "BLOOMJOY 运营指南",
        "工时与技术员薪酬",
        "简明介绍如何记录工作、审核工时、计算技术员薪酬并发布工资单。",
        (
            ("技术员使用", "按机器记录已完成的工作，保存前查看计薪班次，可在截止前更正记录，并下载已发布的工资单。"),
            ("主管与超级管理员使用", "开通权限并设置薪酬规则，审核或更正工时，检查计算是否完整，发布准确的工资单。"),
        ),
        ("记录工时", "主管审核", "计算薪酬", "发布工资单"),
        (APP_URL, TIME_URL, PAY_URL),
    )

    story += header_block(
        "技术员体验",
        "简单清楚的每周工时流程",
        "技术员通过适合手机操作的周历记录已完成的工作。他们只能查看自己的记录，以及主管分配给自己的机器。",
        styles,
    )
    tech_steps = [
        ("打开工时页面", f'登录 <link href="{TIME_URL}" color="#B94468">{TIME_URL}</link>。页面会自动显示本周周历。'),
        ("选择日期并添加工时", "点击“添加工时”，选择工作日期和已分配机器，再填写实际开始与结束时间。系统会使用该机器所在地点的时区。"),
        ("查看计薪预览", "保存前，系统会显示实际工作时长和计薪班次数。每条记录都会单独向上取整到下一个已开始小时。"),
        ("查看或更正本周记录", "周历会按日期显示每条记录。只要当月仍开放，技术员可以修改或删除自己的记录。"),
        ("下载工资单", "已发布的工资单会显示在周历下方。技术员只能查看和下载自己的工资单。"),
    ]
    for i, (title, body) in enumerate(tech_steps, 1):
        story.append(step(i, title, body, styles))

    example = Table(
        [[metric("3 小时 10 分", "实际工作", styles), metric("4", "计薪班次", styles), metric("1 条记录", "一台机器", styles)]],
        colWidths=[2.17 * inch] * 3,
    )
    example.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.8, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.8, BORDER), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story += [Spacer(1, 0.08 * inch), p("计薪班次示例", styles, "section"), example, Spacer(1, 0.13 * inch)]
    notes = Table(
        [[
            card("不同机器分开记录", "如果同一天在不同机器上工作，请分别添加记录，方便系统正确计算薪酬并保留清楚的机器历史。", styles, AMBER_PALE),
            card("月度截止后", "月末后的第 4 个日历日结束后，技术员不能再修改当月工时，但主管仍可更正或补录遗漏工时。", styles, SAGE_PALE),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    notes.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
    story += [notes, PageBreak()]

    story += header_block(
        "主管与超级管理员体验",
        "设置、审核与发布",
        "主管主要使用两个页面：“工时报告”用于审核源工时记录；“技术员薪酬报告”用于设置薪酬、查看计算结果与异常，并发布工资单。",
        styles,
    )
    manager_cards = Table(
        [[
            card("工时报告", f'打开 <link href="{REVIEW_URL}" color="#B94468">{REVIEW_URL}</link><br/>可按月份、技术员或机器筛选。主管可以更正现有记录，或代技术员补录遗漏的已完成工作。所有变更都会保留审计记录。', styles),
            card("技术员薪酬报告", f'打开 <link href="{PAY_URL}" color="#B94468">{PAY_URL}</link><br/>查看实际工时、计薪班次、费率、机器销售额、退款、预估销售税、佣金、其他收入、总额和工资单状态。', styles, SAGE_PALE),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    manager_cards.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
    story += [manager_cards, Spacer(1, 0.19 * inch)]

    setup_steps = [
        ("开通工时功能", "选择技术员、开始日期、邮箱和姓名，并勾选技术员可以记录工时的全部机器。"),
        ("按机器设置薪酬", "为每台机器填写每个已开始小时的薪酬，并选择无佣金、满三个月后 3% 佣金，或自定义佣金比例和开始日期。"),
        ("审核源工时", "检查实际工时和计薪班次。主管可以更正错误或补录遗漏记录，包括技术员截止日期之后。"),
        ("解决计算阻止项", "报告会指出缺少费率、机器分配日期不完整、销售数据缺失或过期等问题，避免发布不完整的工资单。"),
        ("发布或重新生成", "计算完整后即可发布。若之后源数据发生更正，系统会要求重新生成新版本，不会覆盖以前的审计历史。"),
    ]
    for i, (title, body) in enumerate(setup_steps, 1):
        story.append(step(i, title, body, styles))

    scope = Table(
        [[
            card("主管权限范围", "主管只能查看其有效权限范围内的技术员和机器。只有机器管理权限的主管可以审核工时，但不会自动获得账户级薪酬权限。", styles, AMBER_PALE),
            card("超级管理员总览", "超级管理员可以查看完整报告，跨授权账户设置技术员、维护薪酬输入、处理异常，并发布工资单。", styles, SAGE_PALE),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    scope.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
    story += [scope, PageBreak()]

    story += header_block(
        "月度薪酬流程",
        "从已完成工作到工资单",
        "系统把技术员工时、授权薪酬规则和机器销售数据连接起来，形成清楚可查的计算记录。它不会冒充银行或完整的工资发放系统。",
        styles,
    )

    lifecycle_rows = [
        ["1", "月内", "技术员按机器添加已完成工作。主管可随时审核并在需要时更正。"],
        ["2", "月末后 4 天", "技术员仍有一个简短的更正窗口，可在月末后的第 4 个日历日结束前修改当月记录。"],
        ["3", "截止后", "主管仍可更正工时。报告会检查费率、分配日期、销售数据、税费、佣金和其他收入。"],
        ["4", "发布", "计算完整后可发布私人工资单。若资料不完整，系统会阻止发布并说明缺少什么。"],
        ["5", "发布后", "之后若发生更正，系统会标记需要重新生成，并创建新版本，而不是覆盖历史记录。"],
    ]
    lifecycle = Table(
        [[p("步骤", styles, "small_bold"), p("时间", styles, "small_bold"), p("系统行为", styles, "small_bold")]]
        + [[p(a, styles, "small_bold"), p(b, styles, "small_bold"), p(c, styles, "small")] for a, b, c in lifecycle_rows],
        colWidths=[0.47 * inch, 1.42 * inch, 4.64 * inch],
        repeatRows=1,
    )
    lifecycle.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), PINK_PALE), ("BOX", (0, 0), (-1, -1), 0.7, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story += [lifecycle, Spacer(1, 0.18 * inch)]

    pay_components = Table(
        [[
            card("计薪班次收入", "每条机器工时记录会独立向上取整为计薪班次，再应用该技术员与机器在工作日期生效的费率。", styles),
            card("佣金", "可计佣销售额等于机器销售额减去退款和预估销售税，再乘以当时生效的佣金比例。", styles, SAGE_PALE),
        ], [
            card("其他收入", "主管可添加已授权的奖金、物料补贴、费用报销，或其他说明清楚的调整项目。", styles, AMBER_PALE),
            card("私人工资单", "工资单显示本期与本年度累计金额。技术员只能查看自己的已发布文件；主管可保留完整审计历史。", styles),
        ]],
        colWidths=[3.28 * inch, 3.28 * inch],
    )
    pay_components.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [pay_components, Spacer(1, 0.14 * inch)]
    story += [p("重要说明", styles, "section"), p("本系统用于计算并发布承包商工资单。它不会自动付款，不会把技术员标记为已付款，不计算工资税预扣，不提交税表，也不能代替主管对缺失源数据的审核。", styles, "body"), Spacer(1, 0.16 * inch)]
    story += [p("快速链接", styles, "section"), link_line("技术员工时", TIME_URL, styles), Spacer(1, 0.04 * inch), link_line("主管工时报告", REVIEW_URL, styles), Spacer(1, 0.04 * inch), link_line("技术员薪酬报告", PAY_URL, styles)]
    return story


def main() -> None:
    register_fonts()
    build_document("en", OUTPUT_DIR / "bloomjoy-timekeeping-user-guide-en.pdf")
    build_document("zh", OUTPUT_DIR / "bloomjoy-timekeeping-user-guide-zh-cn.pdf")
    print(f"Created {OUTPUT_DIR / 'bloomjoy-timekeeping-user-guide-en.pdf'}")
    print(f"Created {OUTPUT_DIR / 'bloomjoy-timekeeping-user-guide-zh-cn.pdf'}")


if __name__ == "__main__":
    main()
