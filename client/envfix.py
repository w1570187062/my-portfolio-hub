# -*- coding: utf-8 -*-
"""解释器环境自愈：清理外部 PYTHONPATH 污染 + 修正 DLL 搜索路径。

背景（踩坑记录）：
本机全局环境变量 `PYTHONPATH=D:\\Chenyifei\\SDK\\python`（一套 python312 的残留 SDK）
会被 WorkBuddy 的 shim 追加进 `sys.path`，产生两类故障：

1. **包遮蔽**：venv 里装好的 pillow / PySide6 / rapidocr 被 SDK 目录里的同名包顶掉
   （`PIL.__file__` 指向 D:\\Chenyifei\\SDK\\python\\PIL），版本不一致直接 ImportError。
2. **DLL 版本错配**：SDK 目录里的 `pywin32_system32\\pywintypes312.dll`（cp312）
   被优先加载，而 venv 是 cp313 → `import win32security` 报
   "DLL load failed while importing win32security: 找不到指定的模块"。

对策：进程启动最早阶段（import 任何第三方包之前）调用 `repair_environment()`：
- 把 PYTHONPATH 注入的、且不属于本解释器/venv 的路径从 sys.path 剔除
- 把 venv 的 site-packages 与 Scripts 顶到 sys.path 最前
- Windows 下把 venv 自己的 pywin32_system32 加进 DLL 搜索目录

必须在 import PySide6 / pymobiledevice3 / PIL **之前**调用。
"""
from __future__ import annotations

import os
import sys
import sysconfig
from pathlib import Path


def _venv_roots() -> list[Path]:
    """当前解释器所属的 venv 根目录（纯 venv 才有）。"""
    base = Path(sys.base_prefix)
    prefix = Path(sys.prefix)
    return [prefix] if prefix != base else []


def _is_foreign(path: str, keep: set[Path]) -> bool:
    """判断 sys.path 条目是否来自外部 PYTHONPATH 注入（应剔除）。"""
    if not path:
        return False
    p = Path(path)
    if not p.exists():
        return False
    # 解释器自身、venv、标准库、当前工作目录 → 保留
    for root in (Path(sys.prefix), Path(sys.base_prefix), Path(sysconfig.get_paths()["stdlib"])):
        try:
            p.relative_to(root)
            return False
        except ValueError:
            pass
    if p == Path.cwd() or p == Path(sys.path[0] if sys.path else "").resolve():
        return False
    # 落在 keep 集合里的（如用户显式加的）→ 保留
    for k in keep:
        try:
            p.relative_to(k)
            return False
        except ValueError:
            pass
    return True


def repair_environment(verbose: bool = False) -> dict:
    """清理 sys.path / DLL 路径。返回诊断信息。"""
    info: dict = {"removed": [], "dll_dirs": [], "already_clean": True}

    # 1) 记录 PYTHONPATH 注入项（用户若主动保留某项，用 PF_KEEP_PYTHONPATH 声明）
    keep_raw = os.environ.get("PF_KEEP_PYTHONPATH", "")
    keep = {Path(x).resolve() for x in keep_raw.split(os.pathsep) if x}

    # 2) 剔除外部注入路径
    for entry in list(sys.path):
        if _is_foreign(entry, keep):
            info["removed"].append(entry)
            try:
                sys.path.remove(entry)
            except ValueError:
                pass

    # 3) venv site-packages 置顶
    purelib = sysconfig.get_paths().get("purelib")
    if purelib and purelib in sys.path:
        sys.path.remove(purelib)
        sys.path.insert(0, purelib)
    # Scripts 目录置顶（让 pymobiledevice3.exe 等入口可被找到）
    scripts = Path(sys.prefix) / ("Scripts" if os.name == "nt" else "bin")
    if scripts.exists():
        s = str(scripts)
        if s in sys.path:
            sys.path.remove(s)
        sys.path.insert(0, s)

    # 4) Windows DLL 搜索目录：venv 自己的 pywin32_system32
    if os.name == "nt":
        for base in (Path(sys.prefix) / "Lib" / "site-packages",):
            dll_dir = base / "pywin32_system32"
            if dll_dir.is_dir():
                try:
                    os.add_dll_directory(str(dll_dir))
                    info["dll_dirs"].append(str(dll_dir))
                except Exception:
                    pass

    # 5) 同步修正子进程环境（pymobiledevice3 子进程会继承 PYTHONPATH）
    if "PYTHONPATH" in os.environ and not keep_raw:
        os.environ.pop("PYTHONPATH", None)
        info["cleared_pythonpath"] = True

    info["already_clean"] = not info["removed"] and not info.get("cleared_pythonpath")
    if verbose and (info["removed"] or info.get("cleared_pythonpath")):
        print(f"[env-repair] 移除外部路径 {len(info['removed'])} 项，"
              f"清理 PYTHONPATH={info.get('cleared_pythonpath')}")
    return info


def ensure_repaired() -> dict:
    """幂等入口：已修复过则直接返回缓存结果。"""
    global _REPAIRED
    if _REPAIRED is not None:
        return _REPAIRED
    _REPAIRED = repair_environment()
    return _REPAIRED


_REPAIRED: dict | None = None


def child_env(extra: dict | None = None) -> dict:
    """生成干净的子进程环境变量（供 subprocess 使用）。"""
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    if extra:
        env.update(extra)
    return env
