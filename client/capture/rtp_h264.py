# -*- coding: utf-8 -*-
"""RTP/H.264 解包器：把 UxPlay -vrtp 转发的 RTP 流还原成 Annex-B 接入单元。

支持：单 NAL 包（type 1-23）、FU-A 分片重组（type 28）、STAP-A 聚合包（type 24）。
纯 Python 无 Qt 依赖，可独立单测。
"""
from __future__ import annotations

import struct

FU_A = 28
STAP_A = 24
SINGLE_MAX = 23

START_CODE = b"\x00\x00\x00\x01"


class RtpH264Depacketizer:
    def __init__(self):
        self._buf = bytearray()
        self._started = False
        self.last_pts = 0

    def feed(self, packet: bytes):
        """喂入一个 UDP 包（含 12 字节 RTP 头），返回完整的接入单元 bytes 或 None。"""
        if len(packet) < 12:
            return None
        b0 = packet[0]
        x = (b0 >> 4) & 0x1
        cc = b0 & 0x0F
        marker = (packet[1] >> 7) & 0x1
        self.last_pts = struct.unpack(">I", packet[4:8])[0]

        off = 12 + cc * 4
        if x:
            if len(packet) < off + 4:
                return None
            ext_len = struct.unpack(">H", packet[off + 2:off + 4])[0]
            off += 4 + ext_len * 4
        if len(packet) <= off:
            return None

        self._handle_nal(packet[off:])
        if marker and self._started:
            au = bytes(self._buf)
            self._buf = bytearray()
            self._started = False
            return au
        return None

    def _handle_nal(self, nal: bytes):
        if not nal:
            return
        t = nal[0] & 0x1F
        if t == FU_A:
            if len(nal) < 2:
                return
            fu_ind = nal[0]
            fu_hdr = nal[1]
            s = (fu_hdr >> 7) & 0x1
            if s:  # 分片起始：开新 AU，重建 NAL 头
                self._buf = bytearray()
                self._buf += START_CODE
                self._buf.append((fu_ind & 0xE0) | (fu_hdr & 0x1F))
                self._started = True
            if self._started:
                self._buf += nal[2:]
        elif t == STAP_A:
            self._buf = bytearray()
            self._started = True
            i = 1
            while i + 2 <= len(nal):
                sz = struct.unpack(">H", nal[i:i + 2])[0]
                i += 2
                self._buf += START_CODE
                self._buf += nal[i:i + sz]
                i += sz
        elif t <= SINGLE_MAX:
            self._buf = bytearray()
            self._started = True
            self._buf += START_CODE
            self._buf += nal
