"""Build both guides from their editable Markdown sources.

Requires reportlab and TrueType fonts. Defaults to Windows Arial / Microsoft
YaHei; pass --font-dir for another folder containing the same font files.
No network access or application changes are performed.
"""
import argparse
import html
import re
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = 864, 648
MARGIN = 34
INK, MUTED, ACCENT = HexColor('#222b32'), HexColor('#5b646d'), HexColor('#a93755')


def inline(text):
    text = html.escape(text)
    text = re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)', r'<a href="\2" color="#a93755"><u>\1</u></a>', text)
    return re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)


def build(language, destination):
    source = HERE / f'finance-guide.{language}.md'
    text = source.read_text(encoding='utf-8')
    chinese = language == 'zh-CN'
    regular, bold = ('CJK', 'CJKBold') if chinese else ('Arial', 'ArialBold')
    style = ParagraphStyle('body', fontName=regular, fontSize=11.3, leading=15.2,
                           textColor=INK, wordWrap='CJK' if chinese else None)
    small = ParagraphStyle('small', parent=style, fontSize=9.3, leading=12, textColor=MUTED)
    title = ParagraphStyle('title', parent=style, fontName=bold, fontSize=22, leading=27)
    pages = re.split(r'\n---\n', text)
    doc = canvas.Canvas(str(destination), pagesize=(WIDTH, HEIGHT), invariant=1)
    doc.setTitle('Bloomjoy 财务团队使用指南' if chinese else 'Bloomjoy Finance team guide')
    doc.setAuthor('Bloomjoy')
    for number, page in enumerate(pages, 1):
        lines = page.strip().splitlines()
        heading = next(line[3:] for line in lines if line.startswith('## '))
        start = next(index for index, line in enumerate(lines) if line.startswith('## '))
        lines = lines[start + 1:]
        image_line = next(line for line in lines if line.startswith('!['))
        alt, image_path = re.fullmatch(r'!\[([^\]]+)\]\(([^)]+)\)', image_line).groups()
        image_index = lines.index(image_line)
        before = '\n'.join(lines[:image_index]).strip()
        body = '\n'.join(lines[image_index + 1:]).strip()
        blocks = []
        for block in re.split(r'\n\s*\n', body):
            if block.startswith('- '):
                blocks.extend((line[2:], True) for line in block.splitlines() if line.startswith('- '))
            elif block:
                blocks.append((block.replace('\n', ' '), False))
        body_objects = [Paragraph(('• ' if bullet else '') + inline(value), style) for value, bullet in blocks]
        body_heights = [obj.wrap(WIDTH - 2 * MARGIN, HEIGHT)[1] + 7 for obj in body_objects]
        doc.setFillColor(ACCENT)
        doc.setFont(bold, 10)
        doc.drawString(MARGIN, HEIGHT - 25, 'BLOOMJOY  /  财务使用指南' if chinese else 'BLOOMJOY  /  FINANCE TEAM GUIDE')
        doc.setFillColor(MUTED)
        doc.setFont(regular, 9)
        doc.drawRightString(WIDTH - MARGIN, HEIGHT - 25, '2026-10-03')
        doc.setStrokeColor(HexColor('#e6dce0'))
        doc.line(MARGIN, HEIGHT - 35, WIDTH - MARGIN, HEIGHT - 35)
        y = HEIGHT - 49
        heading_object = Paragraph(inline(heading), title)
        _, th = heading_object.wrap(WIDTH - 2 * MARGIN, HEIGHT)
        heading_object.drawOn(doc, MARGIN, y - th)
        y -= th + 9
        if before:
            paragraph = Paragraph(inline(before), style)
            _, ph = paragraph.wrap(WIDTH - 2 * MARGIN, HEIGHT)
            paragraph.drawOn(doc, MARGIN, y - ph)
            y -= ph + 8
        caption = Paragraph(('示例截图：实际应用界面，使用合成数据。与公司实际结果不同。' if chinese else
                             'Illustrative sample: actual application screen with synthetic data. Values differ from company results.'), small)
        _, ch = caption.wrap(WIDTH - 2 * MARGIN, HEIGHT)
        image = ImageReader(str(HERE / image_path))
        iw, ih = image.getSize()
        available_height = y - 37 - sum(body_heights) - ch - 18
        scale = min((WIDTH - 2 * MARGIN) / iw, 350 / ih, available_height / ih)
        if scale <= 0:
            raise ValueError(f'Page {number} has no space for its screenshot')
        dw, dh = iw * scale, ih * scale
        doc.drawImage(image, (WIDTH - dw) / 2, y - dh, dw, dh)
        y -= dh + 5
        caption.drawOn(doc, MARGIN, y - ch)
        y -= ch + 11
        for paragraph, ph in zip(body_objects, body_heights):
            paragraph.drawOn(doc, MARGIN, y - (ph - 7))
            y -= ph
        if y < 34:
            raise ValueError(f'Page {number} content overlaps the footer ({y})')
        doc.setFont(regular, 8.5)
        doc.setFillColor(MUTED)
        doc.drawString(MARGIN, 19, '登录后使用页面链接。截图为示例数据。' if chinese else 'Sign in to use the live links. Screenshots contain sample data.')
        doc.drawRightString(WIDTH - MARGIN, 19, f'{number} / {len(pages)}')
        doc.showPage()
    doc.save()
    print(f'{destination}: {len(pages)} pages')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--font-dir', type=Path, default=Path('C:/Windows/Fonts'))
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'output/pdf')
    args = parser.parse_args()
    for name, filename in [('Arial', 'arial.ttf'), ('ArialBold', 'arialbd.ttf'),
                           ('CJK', 'msyh.ttc'), ('CJKBold', 'msyhbd.ttc')]:
        pdfmetrics.registerFont(TTFont(name, str(args.font_dir / filename), subfontIndex=0))
    pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='ArialBold', italic='Arial', boldItalic='ArialBold')
    pdfmetrics.registerFontFamily('CJK', normal='CJK', bold='CJKBold', italic='CJK', boldItalic='CJKBold')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for language in ['en', 'zh-CN']:
        build(language, args.output_dir / f'bloomjoy-finance-guide.{language}.pdf')
