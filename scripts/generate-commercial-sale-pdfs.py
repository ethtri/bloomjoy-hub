from __future__ import annotations

import argparse
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, BooleanObject, DictionaryObject, IndirectObject, NameObject
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_DIR = ROOT / "tmp" / "pdfs" / "base"
DEFAULT_OUTPUT_DIR = ROOT / "output" / "pdf"

PDFS = {
    "Commercial Machine Sale Agreement.pdf": (
        "sale",
        "Bloomjoy Commercial Machine Sale Agreement - Fillable.pdf",
    ),
    "Delivery and Commissioning Certificate.pdf": (
        "delivery",
        "Bloomjoy Delivery and Commissioning Certificate - Fillable.pdf",
    ),
    "Permitted Operations and Commissary Agreement.pdf": (
        "operations",
        "Bloomjoy Permitted Operations and Commissary Agreement - Fillable.pdf",
    ),
}

PINK = HexColor("#B8AAB0")
PALE_PINK = HexColor("#FCFAFB")
TEXT = HexColor("#202020")
MULTILINE_FLAG = 1 << 12


@dataclass(frozen=True)
class FieldSpec:
    page_index: int
    kind: str
    rect: tuple[float, float, float, float]
    name: str
    tooltip: str
    multiline: bool = False
    default_value: str = ""


def slugify(value: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", normalized).strip("_").lower()
    return (normalized[:48] or fallback).strip("_")


def unique_name(prefix: str, page_number: int, kind: str, context: str, counter: int) -> str:
    return f"{prefix}_p{page_number}_{kind}_{slugify(context, kind)}_{counter:03d}"


def bbox_contains(cell: tuple[float, float, float, float], x: float, top: float) -> bool:
    x0, y0, x1, y1 = cell
    return x0 - 0.5 <= x <= x1 + 0.5 and y0 - 0.5 <= top <= y1 + 0.5


def words_in_bbox(words: list[dict], bbox: tuple[float, float, float, float]) -> list[dict]:
    return [
        word
        for word in words
        if bbox_contains(
            bbox,
            (float(word["x0"]) + float(word["x1"])) / 2,
            (float(word["top"]) + float(word["bottom"])) / 2,
        )
    ]


def sort_words(words: list[dict]) -> list[dict]:
    return sorted(words, key=lambda word: (round(float(word["top"]) / 2) * 2, float(word["x0"])))


def placeholder_spans(words: list[dict]) -> list[tuple[tuple[float, float, float, float], str]]:
    spans: list[tuple[tuple[float, float, float, float], str]] = []
    active: list[tuple[dict, int, int | None]] | None = None
    for word in sort_words(words):
        text = str(word["text"])
        cursor = 0
        while cursor < len(text):
            if active is None:
                start = text.find("[", cursor)
                if start < 0:
                    break
                end = text.find("]", start + 1)
                if end >= 0:
                    active = [(word, start, end + 1)]
                    cursor = end + 1
                else:
                    active = [(word, start, None)]
                    break
            else:
                end = text.find("]", cursor)
                active.append((word, cursor, end + 1 if end >= 0 else None))
                if end >= 0:
                    cursor = end + 1
                else:
                    break

            if active and active[-1][2] is not None:
                pieces = []
                x_values: list[float] = []
                tops: list[float] = []
                bottoms: list[float] = []
                for token, start_idx, end_idx in active:
                    token_text = str(token["text"])
                    token_width = max(float(token["x1"]) - float(token["x0"]), 0.1)
                    denom = max(len(token_text), 1)
                    left = float(token["x0"]) + token_width * start_idx / denom
                    right_index = end_idx if end_idx is not None else len(token_text)
                    right = float(token["x0"]) + token_width * right_index / denom
                    x_values.extend([left, right])
                    tops.append(float(token["top"]))
                    bottoms.append(float(token["bottom"]))
                    pieces.append(token_text[start_idx:right_index])
                spans.append(((min(x_values), min(tops), max(x_values), max(bottoms)), " ".join(pieces)))
                active = None
    return spans


def pure_placeholder(text: str) -> bool:
    compact = re.sub(r"\s+", " ", text).strip()
    return bool(re.fullmatch(r"\(?\$?\s*\[[^\]]*\]\)?[.,;:]?", compact))


def context_for_rect(page_words: list[dict], rect: tuple[float, float, float, float], fallback: str) -> str:
    x0, top, _x1, bottom = rect
    center = (top + bottom) / 2
    same_line = [
        word
        for word in page_words
        if float(word["x1"]) <= x0 + 1
        and abs(((float(word["top"]) + float(word["bottom"])) / 2) - center) <= max(7, bottom - top)
    ]
    if same_line:
        return " ".join(str(word["text"]) for word in sorted(same_line, key=lambda word: float(word["x0"]))[-7:])
    return fallback


def page_field_specs(page, page_index: int, prefix: str, counter_start: int) -> tuple[list[FieldSpec], int]:
    page_words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    tables = page.find_tables()
    cell_bboxes: list[tuple[float, float, float, float]] = []
    fields: list[FieldSpec] = []
    counter = counter_start

    for table in tables:
        for cell in table.cells:
            cell_bboxes.append(cell)
            cell_words = words_in_bbox(page_words, cell)
            if not cell_words:
                continue
            cell_text = page.crop(cell).extract_text() or ""
            spans = placeholder_spans(cell_words)
            if len(spans) == 1 and pure_placeholder(cell_text):
                spans = [((cell[0] + 2.5, cell[1] + 2.0, cell[2] - 2.5, cell[3] - 2.0), spans[0][1])]
            for rect, placeholder in spans:
                counter += 1
                context = context_for_rect(page_words, rect, cell_text.replace(placeholder, ""))
                multiline = rect[3] - rect[1] > 17 or cell[3] - cell[1] > 25
                fields.append(
                    FieldSpec(
                        page_index,
                        "text",
                        rect,
                        unique_name(prefix, page_index + 1, "text", context, counter),
                        f"{context.strip() or 'Complete field'}",
                        multiline,
                        default_value="None" if placeholder.strip() == "[None]" else "",
                    )
                )

    non_cell_words = [
        word
        for word in page_words
        if not any(
            bbox_contains(
                cell,
                (float(word["x0"]) + float(word["x1"])) / 2,
                (float(word["top"]) + float(word["bottom"])) / 2,
            )
            for cell in cell_bboxes
        )
    ]
    lines: dict[int, list[dict]] = {}
    for word in non_cell_words:
        lines.setdefault(round(float(word["top"]) / 2), []).append(word)
    for line_words in lines.values():
        for rect, placeholder in placeholder_spans(line_words):
            counter += 1
            context = context_for_rect(page_words, rect, placeholder)
            fields.append(
                FieldSpec(
                    page_index,
                    "text",
                    rect,
                    unique_name(prefix, page_index + 1, "text", context, counter),
                    context.strip() or "Complete field",
                    rect[3] - rect[1] > 17,
                )
            )

    for char in page.chars:
        if char.get("text") != "☐":
            continue
        counter += 1
        rect = (float(char["x0"]), float(char["top"]), float(char["x1"]), float(char["bottom"]))
        context = context_for_rect(page_words, rect, "Select option")
        fields.append(
            FieldSpec(
                page_index,
                "checkbox",
                rect,
                unique_name(prefix, page_index + 1, "check", context, counter),
                context.strip() or "Select option",
            )
        )

    for word in page_words:
        text = str(word["text"])
        for match in re.finditer(r"_{5,}", text):
            counter += 1
            width = max(float(word["x1"]) - float(word["x0"]), 0.1)
            rect = (
                float(word["x0"]) + width * match.start() / max(len(text), 1),
                float(word["top"]),
                float(word["x0"]) + width * match.end() / max(len(text), 1),
                float(word["bottom"]),
            )
            context = context_for_rect(page_words, rect, "Signature detail")
            fields.append(
                FieldSpec(
                    page_index,
                    "text",
                    rect,
                    unique_name(prefix, page_index + 1, "signature", context, counter),
                    context.strip() or "Signature detail",
                )
            )

    return fields, counter


def collect_fields(base_pdf: Path, prefix: str) -> tuple[list[FieldSpec], list[tuple[float, float]]]:
    fields: list[FieldSpec] = []
    page_sizes: list[tuple[float, float]] = []
    counter = 0
    with pdfplumber.open(base_pdf) as pdf:
        for page_index, page in enumerate(pdf.pages):
            page_sizes.append((float(page.width), float(page.height)))
            page_fields, counter = page_field_specs(page, page_index, prefix, counter)
            fields.extend(page_fields)
    return fields, page_sizes


def draw_text_field(form, page_height: float, field: FieldSpec) -> None:
    x0, top, x1, bottom = field.rect
    width = max(x1 - x0, 10)
    height = max(bottom - top + 2.0, 10.5)
    y = page_height - bottom - 1.0
    form.textfield(
        name=field.name,
        tooltip=field.tooltip[:120],
        x=x0 - 1.0,
        y=y,
        width=width + 2.0,
        height=height,
        value=field.default_value,
        borderColor=PINK,
        fillColor=PALE_PINK,
        textColor=TEXT,
        borderWidth=0.55,
        borderStyle="solid",
        forceBorder=True,
        annotationFlags="print",
        fieldFlags=MULTILINE_FLAG if field.multiline else 0,
        maxlen=500 if field.multiline else 160,
        fontName="Helvetica",
        fontSize=7.5 if height < 12 else 8.5,
    )


def draw_checkbox(form, page_height: float, field: FieldSpec) -> None:
    x0, top, x1, bottom = field.rect
    size = max(min(max(x1 - x0, bottom - top), 11), 8.5)
    form.checkbox(
        name=field.name,
        tooltip=field.tooltip[:120],
        x=x0 - 0.2,
        y=page_height - bottom - 0.2,
        size=size,
        checked=False,
        buttonStyle="check",
        shape="square",
        borderColor=PINK,
        fillColor=PALE_PINK,
        textColor=TEXT,
        borderWidth=0.6,
        borderStyle="solid",
        forceBorder=True,
        annotationFlags="print",
        fieldFlags="",
    )


def build_overlay(path: Path, fields: list[FieldSpec], page_sizes: list[tuple[float, float]]) -> None:
    by_page: dict[int, list[FieldSpec]] = {}
    for field in fields:
        by_page.setdefault(field.page_index, []).append(field)

    pdf = canvas.Canvas(str(path), pagesize=page_sizes[0], pageCompression=1)
    for page_index, (width, height) in enumerate(page_sizes):
        pdf.setPageSize((width, height))
        for field in by_page.get(page_index, []):
            if field.kind == "checkbox":
                draw_checkbox(pdf.acroForm, height, field)
            else:
                draw_text_field(pdf.acroForm, height, field)
        pdf.showPage()
    pdf.save()


def merge_base_under_form(base_pdf: Path, overlay_pdf: Path, output_pdf: Path) -> None:
    base = PdfReader(str(base_pdf))
    overlay = PdfReader(str(overlay_pdf))
    if len(base.pages) != len(overlay.pages):
        raise ValueError(f"Page count mismatch for {base_pdf.name}")
    writer = PdfWriter()
    writer.append(base)
    for target_page, form_page in zip(writer.pages, overlay.pages):
        target_page.merge_page(form_page, over=True)

    widget_refs = ArrayObject()
    for page in writer.pages:
        for annotation_ref in page.get("/Annots", []):
            annotation = annotation_ref.get_object()
            if annotation.get("/Subtype") == "/Widget":
                widget_refs.append(annotation_ref)

    source_acroform = overlay.trailer["/Root"]["/AcroForm"].get_object()
    acroform = DictionaryObject()
    for key, value in source_acroform.items():
        if key in ("/Fields", "/CO", "/NeedAppearances"):
            continue
        acroform[NameObject(key)] = value.clone(writer) if hasattr(value, "clone") else value
    acroform[NameObject("/Fields")] = widget_refs
    acroform[NameObject("/NeedAppearances")] = BooleanObject(False)
    writer.root_object[NameObject("/AcroForm")] = writer._add_object(acroform)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    with output_pdf.open("wb") as stream:
        writer.write(stream)


def appearance_is_nonempty(annotation: DictionaryObject) -> bool:
    appearance = annotation.get("/AP")
    if isinstance(appearance, IndirectObject):
        appearance = appearance.get_object()
    if not appearance or "/N" not in appearance:
        return False
    normal = appearance["/N"]
    if isinstance(normal, IndirectObject):
        normal = normal.get_object()
    if isinstance(normal, DictionaryObject) and "/Subtype" not in normal:
        return bool(normal)
    try:
        return bool(normal.get_data())
    except Exception:
        return bool(normal)


def validate_form(path: Path, expected_names: set[str]) -> tuple[int, int]:
    reader = PdfReader(str(path))
    canonical = reader.get_fields() or {}
    missing = expected_names - set(canonical)
    extra = set(canonical) - expected_names
    if missing or extra:
        raise ValueError(f"Field tree mismatch in {path.name}: missing={sorted(missing)}, extra={sorted(extra)}")

    widgets: list[DictionaryObject] = []
    widget_names: list[str] = []
    for page in reader.pages:
        for annotation_ref in page.get("/Annots", []):
            annotation = annotation_ref.get_object()
            if annotation.get("/Subtype") != "/Widget":
                continue
            widgets.append(annotation)
            parent = annotation.get("/Parent")
            if isinstance(parent, IndirectObject):
                parent = parent.get_object()
            name = annotation.get("/T") or (parent.get("/T") if parent else None)
            if name:
                widget_names.append(str(name))
            if not appearance_is_nonempty(annotation):
                raise ValueError(f"Empty widget appearance in {path.name}: {name}")

    if set(widget_names) != expected_names:
        raise ValueError(f"Widget names do not match canonical fields in {path.name}")
    if len(widget_names) != len(expected_names):
        raise ValueError(f"Duplicate widget names found in {path.name}")
    return len(canonical), len(widgets)


def find_base_pdf(base_dir: Path, filename: str) -> Path:
    matches = list(base_dir.rglob(filename))
    if len(matches) != 1:
        raise FileNotFoundError(f"Expected one {filename} under {base_dir}; found {len(matches)}")
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Bloomjoy fillable commercial PDF forms.")
    parser.add_argument("--base-dir", type=Path, default=DEFAULT_BASE_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    overlay_dir = ROOT / "tmp" / "pdfs" / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for base_name, (prefix, output_name) in PDFS.items():
        base_pdf = find_base_pdf(args.base_dir, base_name)
        fields, page_sizes = collect_fields(base_pdf, prefix)
        overlay_pdf = overlay_dir / f"{prefix}-form-overlay.pdf"
        output_pdf = args.output_dir / output_name
        build_overlay(overlay_pdf, fields, page_sizes)
        merge_base_under_form(base_pdf, overlay_pdf, output_pdf)
        canonical_count, widget_count = validate_form(output_pdf, {field.name for field in fields})
        print(f"{output_pdf} | pages={len(page_sizes)} | fields={canonical_count} | widgets={widget_count}")


if __name__ == "__main__":
    main()
