from __future__ import annotations

from pathlib import Path

from PIL import Image as PILImage, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
RAW_SHOTS = ROOT / "tmp" / "screenshots" / "raw"
SCREENSHOT_DIR = ROOT / "Docs" / "screenshots" / "timekeeping-user-guide"
LOGO_PATH = ROOT / "src" / "assets" / "logo.png"

EN_FONT = Path(r"C:\Windows\Fonts\NotoSans-Regular.ttf")
EN_BOLD = Path(r"C:\Windows\Fonts\NotoSans-Bold.ttf")
ZH_FONT = Path(r"C:\Windows\Fonts\simhei.ttf")

APP_URL = "https://app.bloomjoyusa.com"
TIME_URL = f"{APP_URL}/portal/time"
REVIEW_URL = f"{APP_URL}/portal/time-review"
PAY_URL = f"{APP_URL}/admin/payouts"
PEOPLE_URL = f"{APP_URL}/admin/access"

PINK = colors.HexColor("#E6678A")
PINK_DARK = colors.HexColor("#B43B60")
PINK_PALE = colors.HexColor("#FFF1F5")
INK = colors.HexColor("#20232B")
MUTED = colors.HexColor("#606572")
BORDER = colors.HexColor("#E7DDE1")
SAGE_PALE = colors.HexColor("#EDF7F4")
AMBER_PALE = colors.HexColor("#FFF6E7")
WHITE = colors.white


SHOT_SPECS = {
    "technician-access": {
        "source": "technician-setup-required.png",
        "crop": (278, 72, 1810, 620),
        "markers": [(1, 810, 128), (2, 850, 220), (3, 760, 408)],
    },
    "time-entry-form": {
        "source": "manager-add-missed-time.png",
        "crop": (760, 155, 1290, 920),
        "markers": [(1, 490, 165), (2, 490, 320), (3, 490, 430), (4, 490, 535), (5, 490, 690)],
        "redactions": [
            ((42, 145, 486, 190), "Example Technician"),
            ((42, 326, 486, 370), "Example machine - Location"),
        ],
    },
    "people-permissions": {
        "source": "people-permissions.png",
        "crop": (278, 72, 2050, 500),
        "markers": [(1, 1380, 246), (2, 430, 320), (3, 355, 390)],
    },
    "time-review": {
        "source": "manager-time-review.png",
        "crop": (278, 72, 2050, 700),
        "markers": [(1, 1360, 120), (2, 760, 352), (3, 810, 475), (4, 350, 575)],
    },
    "pay-summary": {
        "source": "manager-pay-report.png",
        "crop": (278, 72, 2050, 700),
        "markers": [(1, 1640, 48), (2, 830, 235), (3, 500, 342), (4, 850, 455), (5, 350, 560)],
    },
    "pay-card": {
        "source": "manager-pay-report.png",
        "crop": (600, 700, 2050, 1075),
        "markers": [(1, 890, 52), (2, 1080, 52), (3, 1325, 52), (4, 720, 275)],
    },
}


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("BJ-Regular", str(EN_FONT)))
    pdfmetrics.registerFont(TTFont("BJ-Bold", str(EN_BOLD)))
    pdfmetrics.registerFont(TTFont("BJ-ZH", str(ZH_FONT)))


def prepare_screenshot_assets() -> None:
    """Create privacy-safe, numbered crops from live production screenshots."""
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    marker_font = ImageFont.truetype(str(EN_BOLD), 28)
    redaction_font = ImageFont.truetype(str(EN_FONT), 21)
    for name, spec in SHOT_SPECS.items():
        target = SCREENSHOT_DIR / f"{name}.jpg"
        source = RAW_SHOTS / spec["source"]
        if not source.exists():
            if target.exists():
                continue
            raise FileNotFoundError(f"Missing screenshot source: {source}")

        image = PILImage.open(source).convert("RGB").crop(spec["crop"])
        draw = ImageDraw.Draw(image)
        for rect, label in spec.get("redactions", []):
            draw.rounded_rectangle(rect, radius=8, fill="#FFFFFF", outline="#D8DADD", width=2)
            draw.text((rect[0] + 12, rect[1] + 9), label, font=redaction_font, fill="#343640")
        for number, x, y in spec["markers"]:
            radius = 22
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill="#E6678A", outline="#FFFFFF", width=4)
            label = str(number)
            bounds = draw.textbbox((0, 0), label, font=marker_font)
            draw.text(
                (x - (bounds[2] - bounds[0]) / 2, y - (bounds[3] - bounds[1]) / 2 - 2),
                label,
                font=marker_font,
                fill="#FFFFFF",
            )
        image.save(target, quality=82, optimize=True, progressive=True)


def make_styles(language: str) -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    regular = "BJ-ZH" if language == "zh" else "BJ-Regular"
    bold = "BJ-ZH" if language == "zh" else "BJ-Bold"
    wrap = "CJK" if language == "zh" else None

    def style(name: str, **kwargs) -> ParagraphStyle:
        return ParagraphStyle(name, parent=sample["BodyText"], wordWrap=wrap, **kwargs)

    return {
        "cover_kicker": style("cover_kicker", fontName=bold, fontSize=9, leading=12, textColor=PINK_DARK, alignment=TA_CENTER),
        "cover_title": style("cover_title", fontName=bold, fontSize=27 if language == "en" else 25, leading=33, textColor=INK, alignment=TA_CENTER),
        "cover_subtitle": style("cover_subtitle", fontName=regular, fontSize=11.5, leading=17, textColor=MUTED, alignment=TA_CENTER),
        "kicker": style("kicker", fontName=bold, fontSize=8.2, leading=10, textColor=PINK_DARK, spaceAfter=4),
        "title": style("title", fontName=bold, fontSize=20.5 if language == "en" else 19.5, leading=25, textColor=INK, spaceAfter=5),
        "intro": style("intro", fontName=regular, fontSize=9.4, leading=13.6, textColor=MUTED, spaceAfter=9),
        "section": style("section", fontName=bold, fontSize=11.2, leading=14, textColor=INK, spaceAfter=4),
        "body": style("body", fontName=regular, fontSize=8.5, leading=12.2, textColor=INK),
        "small": style("small", fontName=regular, fontSize=7.6, leading=10.6, textColor=MUTED),
        "small_bold": style("small_bold", fontName=bold, fontSize=7.8, leading=10.6, textColor=INK),
        "card_title": style("card_title", fontName=bold, fontSize=9.1, leading=12, textColor=INK, spaceAfter=2),
        "card_body": style("card_body", fontName=regular, fontSize=7.7, leading=10.8, textColor=MUTED),
        "number": style("number", fontName=bold, fontSize=8.5, leading=11, textColor=WHITE, alignment=TA_CENTER),
        "legend": style("legend", fontName=regular, fontSize=7.5, leading=10.5, textColor=INK),
        "link": style("link", fontName=regular, fontSize=7.5, leading=10, textColor=PINK_DARK),
    }


def para(text: str, styles: dict[str, ParagraphStyle], style: str = "body") -> Paragraph:
    return Paragraph(text, styles[style])


def page_header(kicker: str, title: str, intro: str, styles: dict[str, ParagraphStyle]) -> list:
    return [para(kicker.upper(), styles, "kicker"), para(title, styles, "title"), para(intro, styles, "intro")]


def card(title: str, body: str, styles: dict[str, ParagraphStyle], tint=PINK_PALE, width=3.2 * inch) -> Table:
    table = Table([[[para(title, styles, "card_title"), para(body, styles, "card_body")]]], colWidths=[width])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), tint),
        ("BOX", (0, 0), (-1, -1), 0.65, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return table


def number_badge(number: int, styles: dict[str, ParagraphStyle]) -> Table:
    badge = Table([[para(str(number), styles, "number")]], colWidths=[0.28 * inch], rowHeights=[0.28 * inch])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PINK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return badge


def step(number: int, title: str, body: str, styles: dict[str, ParagraphStyle], width=6.45 * inch) -> Table:
    text = [para(title, styles, "card_title")]
    if body:
        text.append(para(body, styles, "card_body"))
    table = Table([[number_badge(number, styles), text]], colWidths=[0.42 * inch, width - 0.42 * inch])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def screenshot(name: str, width: float) -> Image:
    path = SCREENSHOT_DIR / f"{name}.jpg"
    image = PILImage.open(path)
    height = width * image.height / image.width
    return Image(str(path), width=width, height=height)


def legend(items: list[str], styles: dict[str, ParagraphStyle], columns: int = 2) -> Table:
    cells = []
    for index, item in enumerate(items, 1):
        cells.append(Table(
            [[number_badge(index, styles), para(item, styles, "legend")]],
            colWidths=[0.35 * inch, (6.5 / columns - 0.35) * inch],
            style=TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]),
        ))
    rows = []
    for start in range(0, len(cells), columns):
        row = cells[start:start + columns]
        while len(row) < columns:
            row.append(Spacer(1, 0))
        rows.append(row)
    table = Table(rows, colWidths=[(6.55 / columns) * inch] * columns)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def paired(left, right, widths=(3.2 * inch, 3.35 * inch)) -> Table:
    table = Table([[left, right]], colWidths=list(widths))
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def link_line(label: str, url: str, styles: dict[str, ParagraphStyle]) -> Paragraph:
    return para(f'<b>{label}</b>  <link href="{url}" color="#B43B60">{url}</link>', styles, "link")


def page_decor(canvas, doc, language: str) -> None:
    width, height = letter
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#FFFAFB"))
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.setFillColor(PINK)
    canvas.rect(0, height - 0.1 * inch, width, 0.1 * inch, stroke=0, fill=1)
    canvas.setStrokeColor(BORDER)
    canvas.line(0.65 * inch, 0.49 * inch, width - 0.65 * inch, 0.49 * inch)
    canvas.setFont("BJ-ZH" if language == "zh" else "BJ-Regular", 7)
    canvas.setFillColor(MUTED)
    footer = "Bloomjoy Hub - 工时与技术员薪酬" if language == "zh" else "Bloomjoy Hub - Timekeeping & Technician Pay"
    canvas.drawString(0.65 * inch, 0.28 * inch, footer)
    canvas.drawRightString(width - 0.65 * inch, 0.28 * inch, str(doc.page))
    canvas.restoreState()


TEXT = {
    "en": {
        "cover": ("BLOOMJOY OPERATIONS GUIDE", "Timekeeping & Technician Pay", "Screenshot-led instructions for Technicians, Managers, and Super Admins."),
        "roles": [
            ("Technician", "Record completed work by machine, confirm the paid-shift preview, correct open entries, and download published Pay Stubs."),
            ("Manager / Super Admin", "Invite and activate Technicians, assign machines, set pay rules, correct time, resolve blockers, and publish Pay Stubs."),
        ],
        "p2": ("TECHNICIAN 1 OF 3", "First sign-in and access", "A Technician sees Time only after an invitation is accepted and an active pay profile exists."),
        "p2_leg": ["This message means the account can sign in, but Timekeeping is not active yet.", "The missing item is the Technician pay profile, not a password problem.", "Return to the dashboard; ask a Manager or Super Admin to finish setup."],
        "p2_steps": [
            ("Manager sends the invitation", "Use People & Permissions, select the Technician preset, assign machines, and include a clear audit reason."),
            ("Technician accepts and signs in once", "The first sign-in connects the person to the invitation."),
            ("Manager activates Timekeeping", "Set the start date, contact details, machine assignments, and pay rules."),
            ("Technician opens Time", f'Go to <link href="{TIME_URL}" color="#B43B60">{TIME_URL}</link>. Only assigned machines appear.'),
        ],
        "p3": ("TECHNICIAN 2 OF 3", "Record completed work", "The Technician entry uses the same Date, Machine, Start, End, preview, and Notes pattern shown in this production correction form."),
        "p3_leg": ["Confirm the correct Technician/account context.", "Choose the work date and assigned machine.", "Enter actual start and end times in the machine location's timezone.", "Check actual duration and paid shifts before saving.", "Add a brief note only when it helps explain an exception, then save."],
        "p3_rules": [
            ("One machine per entry", "If work moves between machines, create separate entries."),
            ("Actual time, not rounded time", "Enter the real start and end. The app performs the pay rounding."),
            ("Each entry rounds independently", "61 minutes = 2 paid shifts. Two separate 31-minute entries = 2 paid shifts total."),
        ],
        "p4": ("TECHNICIAN 3 OF 3", "Review, correct, and retrieve Pay Stubs", "A short weekly routine keeps month-end corrections small and pay calculations clean."),
        "p4_steps": [
            ("After each job", "Confirm the machine, date, start, end, and preview before saving."),
            ("Before the week ends", "Scan the weekly calendar for missing, duplicate, or overlapping entries."),
            ("Before the monthly cutoff", "Edit or remove incorrect entries. Technician editing closes after the fourth calendar day following month-end."),
            ("After cutoff", "Tell a Manager what is missing. Managers can still add or correct completed time with audit history."),
            ("After publication", "Open the Pay Stub section and download the published statement. Technicians see only their own files."),
        ],
        "p5": ("MANAGER 1 OF 4", "Invite people and control access", "People & Permissions is the starting point for access, role, scope, machine assignment, and invitation status."),
        "p5_leg": ["Add person starts the invite or existing-user access flow.", "Search and filter by role, account, status, or machine.", "Use All, Needs attention, and Invited to find unfinished setup quickly."],
        "p5_steps": [
            ("Choose Technician", "Use the Technician access preset; do not grant broader admin access just to enable Timekeeping."),
            ("Assign only the correct machines", "These machines determine where the Technician can enter time."),
            ("Activate the pay profile", "Set the effective start date and contact details."),
            ("Set pay per machine", "Enter pay per started hour and choose no commission, 3% after three months, or a custom rate/start date."),
        ],
        "p6": ("MANAGER 2 OF 4", "Review and correct source time", "Time Report is the source-of-truth view for completed Technician work. No approval queue is required."),
        "p6_leg": ["Add missed time works even after the Technician cutoff and remains in audit history.", "Filter by month, Technician, or managed machine.", "Compare Actual Time with independently rounded Paid Shifts.", "Open each row to correct a date, machine, start, end, or note."],
        "p6_form": ["Select the Technician and machine.", "Use the actual work date and local start/end times.", "Review the pay preview before adding the entry."],
        "p7": ("MANAGER 3 OF 4", "Understand the pay report", "Technician Pay Report combines source time, dated pay rules, and imported machine sales into a publishable calculation."),
        "p7_leg": ["Set up Technician opens profile, assignment, and pay configuration.", "Filter the report by month or Technician.", "Sales freshness explains whether the month is still changing.", "Summary cards show shifts, commissionable sales, totals, and Technician count.", "Publishing blockers identify missing or stale inputs that must be fixed first."],
        "p7_calc": [
            ("Shift pay", "Paid shifts x the effective per-started-hour rate for that machine."),
            ("Commission", "(Machine sales - refunds - estimated sales tax) x the effective commission rate."),
            ("Other earnings", "Authorized bonus, supply credit, expense reimbursement, or another clearly described adjustment."),
        ],
        "p8": ("MANAGER 4 OF 4", "Publish with confidence", "Review the calculation, clear blockers, and publish only when the month and source data are complete."),
        "p8_leg": ["Assignment dates decide which time and sales belong to the Technician.", "Adjust pay maintains dated rates, commission, and other earnings.", "Publish Pay Stub stays disabled while the month is open or blockers remain.", "Review shifts, time, shift pay, commission, other earnings, and total together."],
        "p8_check": ["Technician edit window is closed.", "Machine assignments and effective dates are correct.", "Every worked machine has a dated pay rate.", "Sales data is current; refunds and estimated sales tax are included.", "Commission and other earnings have supporting details.", "No publishing blockers remain; totals match the source records."],
        "boundary": "The app calculates and publishes contractor Pay Stubs. It does not send money, mark a Technician as paid, calculate payroll withholding, file tax forms, or replace Manager review.",
    },
    "zh": {
        "cover": ("BLOOMJOY 运营指南", "工时与技术员薪酬", "通过实际界面截图，快速了解技术员、主管和超级管理员的完整流程。"),
        "roles": [
            ("技术员", "按机器记录已完成工作，确认计薪预览，在开放期内更正记录，并下载已发布的工资单。"),
            ("主管 / 超级管理员", "邀请并开通技术员，分配机器，设置薪酬规则，更正工时，解决阻止项，并发布工资单。"),
        ],
        "p2": ("技术员 1 / 3", "首次登录与权限", "技术员接受邀请并拥有有效的薪酬档案后，才能进入工时页面。"),
        "p2_leg": ["看到此页面表示账号可以登录，但工时功能尚未开通。", "缺少的是技术员薪酬档案，并不是密码问题。", "返回首页，并请主管或超级管理员完成设置。"],
        "p2_steps": [
            ("主管发送邀请", "在“人员与权限”中选择“技术员”，分配机器，并填写清楚的授权原因。"),
            ("技术员接受邀请并登录一次", "首次登录会把本人账号与邀请记录关联。"),
            ("主管开通工时功能", "设置开始日期、联系方式、机器分配和薪酬规则。"),
            ("技术员打开工时页面", f'进入 <link href="{TIME_URL}" color="#B43B60">{TIME_URL}</link>，页面只显示已分配的机器。'),
        ],
        "p3": ("技术员 2 / 3", "记录已完成工作", "技术员录入页面使用与下图相同的日期、机器、开始、结束、计薪预览和备注字段。下图为生产环境中的主管补录界面。"),
        "p3_leg": ["确认正确的技术员和账户范围。", "选择实际工作日期和已分配机器。", "按机器所在地时区填写真实开始与结束时间。", "保存前核对实际时长和计薪班次。", "只有在有助于说明例外情况时才填写备注，然后保存。"],
        "p3_rules": [
            ("每台机器单独记录", "如果工作过程中更换机器，请分别创建工时记录。"),
            ("填写实际时间", "不要自行把时间取整；系统会自动完成计薪取整。"),
            ("每条记录独立取整", "61 分钟 = 2 个计薪班次；两条各 31 分钟的记录合计也是 2 个计薪班次。"),
        ],
        "p4": ("技术员 3 / 3", "检查、更正与下载工资单", "坚持简短的每周检查，可以减少月末遗漏并保持薪酬计算清楚。"),
        "p4_steps": [
            ("每次工作完成后", "保存前确认机器、日期、开始、结束和计薪预览。"),
            ("每周结束前", "检查周历中是否有遗漏、重复或时间重叠的记录。"),
            ("月度截止前", "修改或删除错误记录。月末后的第 4 个日历日结束后，技术员不能再修改当月记录。"),
            ("截止后", "把遗漏内容告诉主管。主管仍可补录或更正，并保留审计历史。"),
            ("发布后", "在工资单区域下载已发布文件。技术员只能查看自己的工资单。"),
        ],
        "p5": ("主管 1 / 4", "邀请人员并管理权限", "“人员与权限”是管理登录权限、角色、范围、机器分配和邀请状态的起点。"),
        "p5_leg": ["点击“添加人员”开始邀请或现有用户授权流程。", "可按角色、账户、状态或机器搜索和筛选。", "使用“全部 / 需要处理 / 已邀请”快速找到未完成设置。"],
        "p5_steps": [
            ("选择“技术员”", "请使用技术员权限模板；不要为了开通工时而授予更广泛的管理员权限。"),
            ("只分配正确的机器", "这些机器决定技术员可以在哪里记录工时。"),
            ("开通薪酬档案", "设置生效日期和联系方式。"),
            ("按机器设置薪酬", "填写每个已开始小时的费率，并选择无佣金、满三个月后 3%，或自定义比例和开始日期。"),
        ],
        "p6": ("主管 2 / 4", "审核并更正源工时", "“工时报告”是已完成技术员工作的源记录页面，不需要等待审批队列。"),
        "p6_leg": ["“补录遗漏工时”在技术员截止后仍可使用，并保留审计历史。", "按月份、技术员或所管理的机器筛选。", "比较实际时长与每条记录独立取整后的计薪班次。", "打开单条记录，更正日期、机器、开始、结束或备注。"],
        "p6_form": ["选择技术员和机器。", "使用真实工作日期和当地开始/结束时间。", "添加前先核对计薪预览。"],
        "p7": ("主管 3 / 4", "看懂技术员薪酬报告", "“技术员薪酬报告”把源工时、按日期生效的薪酬规则和导入的机器销售数据汇总为可发布的计算记录。"),
        "p7_leg": ["“设置技术员”用于维护档案、机器分配和薪酬设置。", "按月份或技术员筛选报告。", "销售数据状态说明当月数字是否仍在变化。", "汇总卡显示计薪班次、可计佣销售额、总额和技术员人数。", "发布阻止项会指出必须先修复的缺失或过期资料。"],
        "p7_calc": [
            ("班次收入", "计薪班次 × 该机器在工作日期生效的每个已开始小时费率。"),
            ("佣金", "（机器销售额 - 退款 - 预估销售税）× 生效佣金比例。"),
            ("其他收入", "已授权的奖金、物料补贴、费用报销，或说明清楚的其他调整。"),
        ],
        "p8": ("主管 4 / 4", "确认无误后发布", "核对计算结果、清除阻止项，并且只在月份和源数据完整时发布工资单。"),
        "p8_leg": ["机器分配日期决定哪些工时和销售额属于该技术员。", "“调整薪酬”用于维护按日期生效的费率、佣金和其他收入。", "当月份仍开放或存在阻止项时，“发布工资单”会保持不可用。", "请一起核对班次、工时、班次收入、佣金、其他收入和总额。"],
        "p8_check": ["技术员修改窗口已经关闭。", "机器分配及生效日期正确。", "每台有工时的机器都有按日期生效的费率。", "销售数据已更新，并包含退款和预估销售税。", "佣金和其他收入有清楚的说明依据。", "没有发布阻止项；总额与源记录一致。"],
        "boundary": "本系统用于计算并发布承包商工资单。它不会自动付款，不会把技术员标记为已付款，不计算工资税预扣，不提交税表，也不能代替主管审核。",
    },
}


def build_story(language: str, styles: dict[str, ParagraphStyle]) -> list:
    t = TEXT[language]
    story: list = []

    logo = Image(str(LOGO_PATH), width=0.78 * inch, height=0.78 * inch)
    logo.hAlign = "CENTER"
    story += [Spacer(1, 0.25 * inch), logo, Spacer(1, 0.12 * inch)]
    story += [para(t["cover"][0], styles, "cover_kicker"), Spacer(1, 0.06 * inch), para(t["cover"][1], styles, "cover_title"), Spacer(1, 0.1 * inch), para(t["cover"][2], styles, "cover_subtitle"), Spacer(1, 0.25 * inch)]
    story += [paired(card(*t["roles"][0], styles), card(*t["roles"][1], styles, tint=SAGE_PALE)), Spacer(1, 0.22 * inch)]
    flow_labels = ["Invite / 邀请", "Record / 记录", "Review / 审核", "Calculate / 计算", "Publish / 发布"]
    flow = Table([[para(f"{i + 1}<br/>{label}", styles, "small_bold") for i, label in enumerate(flow_labels)]], colWidths=[1.31 * inch] * 5)
    flow.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.7, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER), ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story += [flow, Spacer(1, 0.22 * inch)]
    story += [link_line("Bloomjoy Hub", APP_URL, styles), link_line("Technician Time / 技术员工时", TIME_URL, styles), link_line("Manager Time Report / 主管工时报告", REVIEW_URL, styles), link_line("Technician Pay Report / 技术员薪酬报告", PAY_URL, styles), Spacer(1, 0.1 * inch)]
    prepared = "Prepared September 2026 - current production interface" if language == "en" else "2026 年 9 月编制 - 以当前生产界面为准"
    story += [para(prepared, styles, "small"), PageBreak()]

    story += page_header(*t["p2"], styles)
    story += [screenshot("technician-access", 6.55 * inch), Spacer(1, 0.05 * inch), legend(t["p2_leg"], styles, columns=1), Spacer(1, 0.08 * inch)]
    for i, (title, body) in enumerate(t["p2_steps"], 1):
        story.append(step(i, title, body, styles))
    story += [card("Access boundary" if language == "en" else "权限边界", "A Technician sees only their assigned machines, their own time entries, and their own published Pay Stubs." if language == "en" else "技术员只能看到已分配给自己的机器、自己的工时记录，以及自己的已发布工资单。", styles, tint=AMBER_PALE, width=6.55 * inch), PageBreak()]

    story += page_header(*t["p3"], styles)
    story += [paired(screenshot("time-entry-form", 3.2 * inch), [para("Screenshot guide" if language == "en" else "截图说明", styles, "section"), legend(t["p3_leg"], styles, columns=1)], widths=(3.3 * inch, 3.25 * inch)), Spacer(1, 0.12 * inch)]
    story += [para("Three rules that prevent pay errors" if language == "en" else "避免薪酬错误的三条规则", styles, "section")]
    rules = Table([[card(title, body, styles, tint=(PINK_PALE, SAGE_PALE, AMBER_PALE)[i], width=2.12 * inch) for i, (title, body) in enumerate(t["p3_rules"])]], colWidths=[2.18 * inch] * 3)
    rules.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    story += [rules, Spacer(1, 0.12 * inch), card("Time zone" if language == "en" else "时区", "Use the machine location's local time, even when the phone or laptop is in a different timezone." if language == "en" else "即使手机或电脑位于不同时区，也请使用机器所在地的当地时间。", styles, width=6.55 * inch), PageBreak()]

    story += page_header(*t["p4"], styles)
    for i, (title, body) in enumerate(t["p4_steps"], 1):
        story.append(step(i, title, body, styles))
    timeline = Table([
        [para("During month" if language == "en" else "月内", styles, "small_bold"), para("Through day 4 after month-end" if language == "en" else "月末后第 4 天结束前", styles, "small_bold"), para("After cutoff" if language == "en" else "截止后", styles, "small_bold")],
        [para("Technician can edit" if language == "en" else "技术员可修改", styles, "small"), para("Final Technician correction window" if language == "en" else "技术员最后更正窗口", styles, "small"), para("Manager corrections only" if language == "en" else "仅主管可更正", styles, "small")],
    ], colWidths=[2.18 * inch] * 3)
    timeline.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), PINK_PALE), ("BOX", (0, 0), (-1, -1), 0.7, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story += [Spacer(1, 0.14 * inch), para("Monthly timing" if language == "en" else "月度时间安排", styles, "section"), timeline, Spacer(1, 0.15 * inch)]
    story += [paired(card("Fix immediately" if language == "en" else "立即更正", "Wrong machine, wrong date, duplicate entry, missing break between separate jobs, or start/end entered in the wrong timezone." if language == "en" else "机器错误、日期错误、重复记录、不同工作未分开，或开始/结束时间使用了错误时区。", styles, tint=AMBER_PALE), card("Pay Stub visibility" if language == "en" else "工资单可见范围", "Published statements appear in the Technician's Time area. Draft or blocked calculations are never shown as final Pay Stubs." if language == "en" else "已发布工资单会显示在技术员工时区域。草稿或存在阻止项的计算不会显示为最终工资单。", styles, tint=SAGE_PALE)), PageBreak()]

    story += page_header(*t["p5"], styles)
    story += [screenshot("people-permissions", 6.55 * inch), Spacer(1, 0.04 * inch), legend(t["p5_leg"], styles), Spacer(1, 0.08 * inch)]
    for i, (title, body) in enumerate(t["p5_steps"], 1):
        story.append(step(i, title, body, styles))
    story += [card("Super Admin view" if language == "en" else "超级管理员视角", "Super Admins can see global access and complete setup across authorized accounts. Scoped Managers remain limited to their effective accounts and machines." if language == "en" else "超级管理员可查看全局权限并在授权账户内完成设置；范围主管仍只限于其有效账户和机器。", styles, tint=SAGE_PALE, width=6.55 * inch), PageBreak()]

    story += page_header(*t["p6"], styles)
    story += [screenshot("time-review", 6.55 * inch), Spacer(1, 0.04 * inch), legend(t["p6_leg"], styles), Spacer(1, 0.08 * inch)]
    form_steps = [step(i, body, "", styles, width=4.2 * inch) for i, body in enumerate(t["p6_form"], 1)]
    story += [paired(screenshot("time-entry-form", 2.25 * inch), [para("Adding missed time" if language == "en" else "补录遗漏工时", styles, "section"), *form_steps], widths=(2.35 * inch, 4.2 * inch)), Spacer(1, 0.08 * inch)]
    story += [card("Audit trail" if language == "en" else "审计历史", "Manager-added and corrected records remain attributable. Use Notes for the business reason when the change is not self-explanatory." if language == "en" else "主管补录和更正会保留责任归属；若变更原因不明显，请在备注中写清业务原因。", styles, tint=AMBER_PALE, width=6.55 * inch), PageBreak()]

    story += page_header(*t["p7"], styles)
    story += [screenshot("pay-summary", 6.55 * inch), Spacer(1, 0.04 * inch), legend(t["p7_leg"], styles), Spacer(1, 0.08 * inch)]
    calc = Table([[card(title, body, styles, tint=(PINK_PALE, SAGE_PALE, AMBER_PALE)[i], width=2.12 * inch) for i, (title, body) in enumerate(t["p7_calc"])]], colWidths=[2.18 * inch] * 3)
    calc.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    story += [para("How the total is built" if language == "en" else "总额如何组成", styles, "section"), calc, Spacer(1, 0.12 * inch)]
    story += [card("Month in progress" if language == "en" else "月份进行中", "Current-month totals are estimates. Publishing remains unavailable until the Technician edit window closes and required source data is complete." if language == "en" else "当月总额属于估算值。在技术员修改窗口关闭且必要源数据完整之前，系统不会允许发布。", styles, width=6.55 * inch), PageBreak()]

    story += page_header(*t["p8"], styles)
    story += [screenshot("pay-card", 6.55 * inch), Spacer(1, 0.04 * inch), legend(t["p8_leg"], styles), Spacer(1, 0.08 * inch)]
    story += [para("Pre-publish checklist" if language == "en" else "发布前检查清单", styles, "section")]
    checklist = Table([[number_badge(index, styles), para(item, styles, "body")] for index, item in enumerate(t["p8_check"], 1)], colWidths=[0.4 * inch, 6.1 * inch])
    checklist.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [checklist, Spacer(1, 0.1 * inch), card("Important boundary" if language == "en" else "重要边界", t["boundary"], styles, tint=AMBER_PALE, width=6.55 * inch), Spacer(1, 0.1 * inch)]
    story += [para("Quick links" if language == "en" else "快速链接", styles, "section"), link_line("People & Permissions / 人员与权限", PEOPLE_URL, styles), link_line("Manager Time Report / 主管工时报告", REVIEW_URL, styles), link_line("Technician Pay Report / 技术员薪酬报告", PAY_URL, styles)]
    return story


def build_document(language: str, output_path: Path) -> None:
    styles = make_styles(language)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(output_path),
        pagesize=letter,
        leftMargin=0.65 * inch,
        rightMargin=0.65 * inch,
        topMargin=0.56 * inch,
        bottomMargin=0.61 * inch,
        title="Bloomjoy Hub Timekeeping and Technician Pay User Guide" if language == "en" else "Bloomjoy Hub 工时与技术员薪酬使用指南",
        author="Bloomjoy",
        subject="Screenshot-led Technician and Manager guide",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=lambda c, d: page_decor(c, d, language))])
    doc.build(build_story(language, styles))


def main() -> None:
    register_fonts()
    prepare_screenshot_assets()
    build_document("en", OUTPUT_DIR / "bloomjoy-timekeeping-user-guide-en.pdf")
    build_document("zh", OUTPUT_DIR / "bloomjoy-timekeeping-user-guide-zh-cn.pdf")
    print(f"Created {OUTPUT_DIR / 'bloomjoy-timekeeping-user-guide-en.pdf'}")
    print(f"Created {OUTPUT_DIR / 'bloomjoy-timekeeping-user-guide-zh-cn.pdf'}")


if __name__ == "__main__":
    main()
