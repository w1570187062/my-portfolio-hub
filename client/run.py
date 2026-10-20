#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""启动入口：python run.py

必须最先 import envfix 并调用 repair_environment()，否则本机全局
PYTHONPATH（python312 SDK 残留）会遮蔽 venv 里的 pillow / PySide6 /
pymobiledevice3，并造成 pywin32 DLL 版本错配（cp312 vs cp313）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from client.envfix import repair_environment

repair_environment(verbose=True)

from client.ui.main_window import main  # noqa: E402

if __name__ == "__main__":
    main()
