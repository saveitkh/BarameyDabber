"""
KHQR payload surgery -- ported field-for-field from Project1's src/khqr.js
(itself proven against ABA). Keep the two in sync if either changes.

Banks will not accept a QR a third party assembled from scratch (ABA in
particular carries a proprietary tag 40 with a per-account reference and
rejects a QR without it: "Invalid Qr Merchant Data"). So instead of
building a QR, this reuses one the operator's own bank app generated: per
order only the amount is swapped and the checksum recomputed. Every other
field travels through byte for byte.
"""
import hashlib
from typing import List, Optional, Tuple, TypedDict

TAG_POINT_OF_INITIATION = "01"
TAG_AMOUNT = "54"
TAG_CRC = "63"


class KhqrField(TypedDict):
    tag: str
    value: str


def parse_khqr(payload: str) -> Optional[List[KhqrField]]:
    """Splits an EMVCo payload into top-level tag/value pairs, or None if it does not parse cleanly."""
    fields: List[KhqrField] = []
    i = 0
    n = len(payload)
    while i < n:
        if i + 4 > n:
            return None
        tag = payload[i:i + 2]
        len_text = payload[i + 2:i + 4]
        if not (len(len_text) == 2 and len_text.isdigit()):
            return None
        length = int(len_text)
        if i + 4 + length > n:
            return None
        fields.append({"tag": tag, "value": payload[i + 4:i + 4 + length]})
        i += 4 + length
    return fields if fields else None


def _serialise(fields: List[KhqrField]) -> str:
    return "".join(f"{f['tag']}{len(f['value']):02d}{f['value']}" for f in fields)


def khqr_crc(data: str) -> str:
    """CRC-16/CCITT-FALSE -- the checksum KHQR carries in tag 63."""
    crc = 0xFFFF
    for ch in data:
        crc ^= ord(ch) << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return format(crc, "04X")


def _has_valid_crc(payload: str) -> bool:
    if len(payload) < 8 or payload[-8:-4] != "6304":
        return False
    return khqr_crc(payload[:-4]) == payload[-4:].upper()


def validate_khqr_template(payload: Optional[str]) -> Tuple[bool, str]:
    """Checks a payload is a KHQR this server can safely reuse.

    Returns (True, trimmed_payload) or (False, reason).
    The checksum is what proves a paste is complete; the amount field is
    what proves it's a fixed-amount QR -- a static one lets the payer type
    any amount, which is exactly what per-order QRs exist to prevent.
    """
    trimmed = str(payload or "").strip()
    fields = parse_khqr(trimmed)
    if not fields:
        return False, "unparseable"
    if not _has_valid_crc(trimmed):
        return False, "bad-checksum"
    if not any(f["tag"] == TAG_AMOUNT for f in fields):
        return False, "no-amount-field"
    return True, trimmed


def apply_khqr_template(template: str, amount: float) -> Tuple[bool, str]:
    """The operator's QR rewritten for one payment of `amount` USD.

    Returns (True, new_payload) or (False, reason).
    """
    ok, trimmed_or_reason = validate_khqr_template(template)
    if not ok:
        return False, trimmed_or_reason
    fields = parse_khqr(trimmed_or_reason)
    assert fields is not None

    out: List[KhqrField] = []
    for field in fields:
        if field["tag"] == TAG_CRC:
            continue  # recomputed below, over the result
        if field["tag"] == TAG_AMOUNT:
            out.append({"tag": TAG_AMOUNT, "value": f"{float(amount):.2f}"})
        elif field["tag"] == TAG_POINT_OF_INITIATION:
            # 11 = static, 12 = dynamic; carrying an amount makes it dynamic.
            out.append({"tag": TAG_POINT_OF_INITIATION, "value": "12"})
        else:
            out.append(field)

    body = f"{_serialise(out)}{TAG_CRC}04"
    return True, f"{body}{khqr_crc(body)}"


def khqr_md5(payload: str) -> str:
    """What Bakong's check_transaction_by_md5 is asked about."""
    return hashlib.md5(payload.encode("utf-8")).hexdigest()
