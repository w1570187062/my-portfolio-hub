# -*- coding: utf-8 -*-
"""OCR 引擎封装（RapidOCR，本地推理，首次运行自动下载/加载模型）。"""
from __future__ import annotations

_engine = None
_load_err = None


def get_engine():
    global _engine, _load_err
    if _engine is not None:
        return _engine
    if _load_err is not None:
        raise _load_err
    try:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    except Exception as e:
        _load_err = e
        raise
    return _engine


def run_ocr(img) -> list:
    """img: 文件路径(str) 或 BGR ndarray。返回 [(box, text, score), ...]。"""
    eng = get_engine()
    out, _ = eng(img)
    items = []
    if not out:
        return items
    # 兼容两种返回形态：经典 list[[box,text,score]] 与新版对象
    if isinstance(out, (list, tuple)):
        for it in out:
            try:
                box, text, score = it[0], it[1], it[2]
            except Exception:
                continue
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            items.append((box, str(text), float(score)))
    else:
        boxes = getattr(out, "boxes", None)
        txts = getattr(out, "txts", None)
        scores = getattr(out, "scores", None)
        if boxes is not None and txts is not None:
            for i, box in enumerate(boxes):
                xs = [float(p[0]) for p in box]
                ys = [float(p[1]) for p in box]
                items.append((box, str(txts[i]), float(scores[i]) if scores else 1.0))
    return items


def items_to_columns(items) -> list:
    """把 OCR 输出转成 models.Column 列表。"""
    from ..models import Column
    cols = []
    for box, text, score in items:
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        cols.append(Column(text=text, x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys), conf=score))
    return cols
