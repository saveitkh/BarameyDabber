"""
Automatic KHQR payment confirmation via the National Bank of Cambodia's
Bakong API -- same endpoint and env var Project1's bot uses
(BAKONG_API_TOKEN), so one token issued once covers both. Without a token
set, a subscription order simply stays pending until an admin confirms it
by hand (grant_subscription via /api/admin/subscription/grant).
"""
import os
from typing import Optional

import requests

BAKONG_BASE = (os.getenv('BAKONG_API_BASE') or 'https://api-bakong.nbc.gov.kh').rstrip('/')


def check_transaction_by_md5(md5_hash: str, expected_amount_usd: float) -> Optional[str]:
    """Asks Bakong whether a KHQR (identified by its payload's md5) has been paid,
    for the exact amount expected, in USD. Returns the bank's transaction hash
    if so, else None (including on any error or a mismatched amount/currency
    -- a transient failure, or someone else's payment, must never look like
    this order got paid)."""
    token = os.getenv('BAKONG_API_TOKEN')
    if not token:
        return None
    try:
        res = requests.post(
            f"{BAKONG_BASE}/v1/check_transaction_by_md5",
            json={'md5': md5_hash},
            headers={'Authorization': f'Bearer {token}'},
            timeout=8,
        )
        if res.status_code != 200:
            return None
        envelope = res.json() or {}
        # responseCode 0 = found & paid, per Bakong's own convention (mirrors botPay.js)
        tx = envelope.get('data') if envelope.get('responseCode') == 0 else None
        if not tx:
            return None
        if abs(float(tx.get('amount', 0)) - float(expected_amount_usd)) > 0.001:
            return None
        currency = str(tx.get('currency') or '').upper()
        if currency and currency != 'USD':
            return None
        return tx.get('hash') or 'bakong'
    except Exception as e:
        print(f"Bakong check_transaction_by_md5 failed: {e}")
        return None
