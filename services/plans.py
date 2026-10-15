"""Subscription plans and what each account may do with them.

Plans live in the database (the admin edits price, length, description and limits in the app);
the four defaults below are only the first-run seed.

  free       Free trial: a few VoxCPM2 videos, then the standard AI voice
  pro        VoxCPM2 Pro: a monthly video quota and a few Pro voices
  proplus    VoxCPM2 Pro Plus: bigger quota, every Pro voice, bring-your-own VoxCPM2 link
  unlimited  A year of everything

Limits use -1 for "unlimited". One "VoxCPM2 video" is one finished video in which at least one line
was voiced by VoxCPM2 on the shared server (voicing on the member's own VoxCPM2 link is free).
"""

import json
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional

from services import auth_db

FREE_ID = 'free'

DEFAULT_PLANS: List[Dict[str, Any]] = [
    {
        'id': 'free', 'label_km': 'ឥតគិតថ្លៃ', 'label_en': 'Free', 'price_usd': 0, 'days': 0, 'sort': 0, 'visible': 1,
        'badge': '', 'vox_label': 'VoxCPM2 សាកល្បង', 'vox_videos': 5, 'pro_voices': 0, 'own_vox_url': 0,
        'pitch_km': 'សាកល្បងក្លូនសំឡេង VoxCPM2 ៥ វីដេអូ រួចបន្តជាមួយសំឡេង AI ខ្មែរធម្មតា គ្មានដែនកំណត់។',
    },
    {
        'id': 'pro', 'label_km': 'Pro', 'label_en': 'Pro', 'price_usd': 3, 'days': 30, 'sort': 1, 'visible': 1,
        'badge': '', 'vox_label': 'VoxCPM2 Pro', 'vox_videos': 20, 'pro_voices': 3, 'own_vox_url': 0,
        'pitch_km': 'សម្រាប់អ្នកចាប់ផ្ដើម៖ VoxCPM2 Pro ២០ វីដេអូក្នុងមួយខែ និងជ្រើសសំឡេង Pro បាន ៣ សំឡេងក្នុងមួយវីដេអូ។',
    },
    {
        'id': 'proplus', 'label_km': 'Pro Plus', 'label_en': 'Pro Plus', 'price_usd': 5, 'days': 30, 'sort': 2, 'visible': 1,
        'badge': 'popular', 'vox_label': 'VoxCPM2 Pro Plus', 'vox_videos': 60, 'pro_voices': -1, 'own_vox_url': 1,
        'pitch_km': 'ពេញនិយមបំផុត៖ សំឡេង Pro គ្មានដែនកំណត់ VoxCPM2 Pro Plus ៦០ វីដេអូក្នុងមួយខែ ហើយដាក់ Link VoxCPM2 ផ្ទាល់ខ្លួនបាន។',
    },
    {
        'id': 'unlimited', 'label_km': 'Unlimited (១ ឆ្នាំ)', 'label_en': 'Unlimited (1 year)', 'price_usd': 30, 'days': 365, 'sort': 3, 'visible': 1,
        'badge': 'best', 'vox_label': 'VoxCPM2 គ្មានដែនកំណត់', 'vox_videos': -1, 'pro_voices': -1, 'own_vox_url': 1,
        'pitch_km': 'ពេញមួយឆ្នាំ ($2.50/ខែ)៖ គ្រប់យ៉ាងគ្មានដែនកំណត់ — សំឡេង Pro, VoxCPM2 និង Link ផ្ទាល់ខ្លួន។',
    },
]

# Names older versions stored in users.plan / subscription_orders.plan
LEGACY_IDS = {'monthly': 'proplus'}

_INT_FIELDS = ('price_usd', 'days', 'sort', 'visible', 'vox_videos', 'pro_voices', 'own_vox_url')
_TEXT_FIELDS = ('label_km', 'label_en', 'badge', 'vox_label', 'pitch_km')


def _conn() -> sqlite3.Connection:
    return auth_db.get_db()


def init() -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS plans (
            id TEXT PRIMARY KEY,
            label_km TEXT NOT NULL,
            label_en TEXT NOT NULL DEFAULT '',
            price_usd REAL NOT NULL DEFAULT 0,
            days INTEGER NOT NULL DEFAULT 30,
            sort INTEGER NOT NULL DEFAULT 0,
            visible INTEGER NOT NULL DEFAULT 1,
            badge TEXT NOT NULL DEFAULT '',
            vox_label TEXT NOT NULL DEFAULT '',
            vox_videos INTEGER NOT NULL DEFAULT 0,
            pro_voices INTEGER NOT NULL DEFAULT 0,
            own_vox_url INTEGER NOT NULL DEFAULT 0,
            pitch_km TEXT NOT NULL DEFAULT '',
            updated_at TEXT
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS user_vox_endpoints (
            user_id INTEGER PRIMARY KEY,
            url TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            updated_at TEXT
        )
    ''')
    for col, col_def in (('vox_used', 'INTEGER DEFAULT 0'), ('vox_trial_used', 'INTEGER DEFAULT 0')):
        try:
            cur.execute(f'ALTER TABLE users ADD COLUMN {col} {col_def}')
        except sqlite3.OperationalError:
            pass
    if cur.execute('SELECT COUNT(*) FROM plans').fetchone()[0] == 0:
        now = datetime.now().isoformat()
        for p in DEFAULT_PLANS:
            cur.execute(
                'INSERT INTO plans (id, label_km, label_en, price_usd, days, sort, visible, badge, vox_label, vox_videos, pro_voices, own_vox_url, pitch_km, updated_at) '
                'VALUES (:id, :label_km, :label_en, :price_usd, :days, :sort, :visible, :badge, :vox_label, :vox_videos, :pro_voices, :own_vox_url, :pitch_km, :now)',
                {**p, 'now': now},
            )
    conn.commit()
    conn.close()


init()


# ── Catalogue ────────────────────────────────────────────────────────────────
def _row(r: sqlite3.Row) -> Dict[str, Any]:
    d = dict(r)
    d.pop('updated_at', None)
    d['price_usd'] = float(d['price_usd'])
    if d['price_usd'] == int(d['price_usd']):
        d['price_usd'] = int(d['price_usd'])
    return d


def get_plan(plan_id: Optional[str]) -> Optional[Dict[str, Any]]:
    plan_id = LEGACY_IDS.get(plan_id or '', plan_id or '')
    conn = _conn()
    r = conn.execute('SELECT * FROM plans WHERE id = ?', (plan_id,)).fetchone()
    conn.close()
    return _row(r) if r else None


def list_plans(include_hidden: bool = False) -> List[Dict[str, Any]]:
    conn = _conn()
    rows = conn.execute('SELECT * FROM plans ORDER BY sort, price_usd').fetchall()
    conn.close()
    plans = [_row(r) for r in rows]
    return plans if include_hidden else [p for p in plans if p['visible']]


def features(p: Dict[str, Any]) -> List[str]:
    """Bullet list generated from the numbers, so an edited limit can never leave a stale promise on screen."""
    out: List[str] = []
    v, pro = int(p['vox_videos']), int(p['pro_voices'])
    paid = p['id'] != FREE_ID
    label = p.get('vox_label') or 'VoxCPM2'
    if v < 0:
        out.append(f'{label} — គ្មានដែនកំណត់')
    elif v == 0:
        out.append('គ្មាន VoxCPM2 — សំឡេង AI ខ្មែរធម្មតា')
    elif paid:
        out.append(f'{label} — {v} វីដេអូ ក្នុងរយៈពេលគម្រោង')
    else:
        out.append(f'{label} — {v} វីដេអូ (សាកល្បង)')
    if pro < 0:
        out.append('សំឡេង Pro ច្បាស់ល្អ — ជ្រើសបានគ្រប់សំឡេង គ្មានដែនកំណត់')
    elif pro == 0:
        out.append('សំឡេងធនាគារស្តង់ដារ (គ្មានសំឡេង Pro)')
    else:
        out.append(f'សំឡេង Pro ច្បាស់ល្អ — ជ្រើសបាន {pro} សំឡេងក្នុងមួយវីដេអូ')
    if p['own_vox_url']:
        out.append('ដាក់ Link VoxCPM2 ផ្ទាល់ខ្លួន (Colab / GPU) — មិនកាត់ចំនួនវីដេអូ')
    out.append('សំឡេង AI ខ្មែរធម្មតា — គ្មានដែនកំណត់')
    return out


def public(p: Dict[str, Any]) -> Dict[str, Any]:
    return {**p, 'features': features(p), 'perMonth': round(p['price_usd'] / max(1, p['days'] / 30), 2) if p['days'] else 0}


def _clean(spec: Dict[str, Any], current: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(current or {})
    for k in _TEXT_FIELDS:
        if k in spec:
            out[k] = str(spec[k] or '').strip()[:400]
    for k in _INT_FIELDS:
        if k in spec:
            try:
                out[k] = float(spec[k]) if k == 'price_usd' else int(spec[k])
            except (TypeError, ValueError):
                raise ValueError(f'តម្លៃ "{k}" មិនត្រឹមត្រូវ')
    if not out.get('label_km'):
        raise ValueError('សូមដាក់ឈ្មោះគម្រោង')
    if out.get('price_usd', 0) < 0 or out.get('days', 0) < 0:
        raise ValueError('តម្លៃ និងចំនួនថ្ងៃមិនអាចអវិជ្ជមានទេ')
    for k in ('vox_videos', 'pro_voices'):
        if out.get(k, 0) < -1:
            raise ValueError('ដែនកំណត់ត្រូវជាលេខ ០ ឬច្រើនជាងនេះ ឬ -១ (គ្មានដែនកំណត់)')
    out['visible'] = 1 if out.get('visible', 1) else 0
    out['own_vox_url'] = 1 if out.get('own_vox_url', 0) else 0
    if out.get('badge') not in ('', 'popular', 'best'):
        out['badge'] = ''
    return out


def upsert_plan(spec: Dict[str, Any]) -> Dict[str, Any]:
    plan_id = str(spec.get('id') or '').strip().lower()
    if not plan_id or not all(c.isalnum() or c in '-_' for c in plan_id) or len(plan_id) > 32:
        raise ValueError('លេខកូដគម្រោង (id) ត្រូវជាអក្សរឡាតាំង/លេខ ១–៣២ តួ')
    current = get_plan(plan_id)
    clean = _clean(spec, current or {'id': plan_id, 'label_en': '', 'days': 30, 'sort': 50, 'visible': 1, 'badge': '',
                                       'vox_label': '', 'vox_videos': 0, 'pro_voices': 0, 'own_vox_url': 0, 'pitch_km': '', 'price_usd': 0})
    if plan_id == FREE_ID:
        clean.update(price_usd=0, days=0)  # the free plan is never sold
    clean['id'] = plan_id
    conn = _conn()
    conn.execute(
        'INSERT INTO plans (id, label_km, label_en, price_usd, days, sort, visible, badge, vox_label, vox_videos, pro_voices, own_vox_url, pitch_km, updated_at) '
        'VALUES (:id, :label_km, :label_en, :price_usd, :days, :sort, :visible, :badge, :vox_label, :vox_videos, :pro_voices, :own_vox_url, :pitch_km, :now) '
        'ON CONFLICT(id) DO UPDATE SET label_km=excluded.label_km, label_en=excluded.label_en, price_usd=excluded.price_usd, days=excluded.days, '
        'sort=excluded.sort, visible=excluded.visible, badge=excluded.badge, vox_label=excluded.vox_label, vox_videos=excluded.vox_videos, '
        'pro_voices=excluded.pro_voices, own_vox_url=excluded.own_vox_url, pitch_km=excluded.pitch_km, updated_at=excluded.updated_at',
        {**clean, 'now': datetime.now().isoformat()},
    )
    conn.commit()
    conn.close()
    return get_plan(plan_id)  # type: ignore[return-value]


def delete_plan(plan_id: str) -> bool:
    if plan_id == FREE_ID:
        raise ValueError('មិនអាចលុបគម្រោងឥតគិតថ្លៃបានទេ')
    conn = _conn()
    n = conn.execute('DELETE FROM plans WHERE id = ?', (plan_id,)).rowcount
    conn.commit()
    conn.close()
    return bool(n)


# ── What may this account do? ────────────────────────────────────────────────
def entitlement(user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The account's current plan and what is left of it. Admins and accounts holding an
    admin-issued VoxCPM2 license key are unlimited."""
    free = get_plan(FREE_ID) or DEFAULT_PLANS[0]
    if not user:
        spec, paid, boss = free, False, False
    else:
        boss = user.get('role') == 'admin' or bool(user.get('has_voxcpm_license'))
        paid = user.get('tier') == 'premium'
        # Premium given by hand (no plan named) counts as the Pro Plus plan
        named = get_plan(user.get('plan')) if (user.get('plan') or FREE_ID) != FREE_ID else None
        spec = (named or get_plan('proplus') or free) if paid else free
    vox_limit = -1 if boss else int(spec['vox_videos'])
    used = int((user or {}).get('vox_used' if paid else 'vox_trial_used') or 0)
    return {
        'planId': spec['id'] if not boss else (spec['id'] if paid else 'unlimited'),
        'planLabel': spec['label_km'] if not (boss and not paid) else 'Unlimited',
        'paid': paid or boss,
        'voxLimit': vox_limit,
        'voxUsed': used,
        'voxRemaining': -1 if vox_limit < 0 else max(0, vox_limit - used),
        'proVoices': -1 if boss else int(spec['pro_voices']),
        'ownVoxUrl': bool(boss or spec['own_vox_url']),
        'expiresAt': (user or {}).get('premium_expires_at') if paid else None,
        'voxLabel': spec.get('vox_label') or 'VoxCPM2',
    }


def record_vox_use(user_id: int, paid: bool) -> None:
    col = 'vox_used' if paid else 'vox_trial_used'
    conn = _conn()
    conn.execute(f'UPDATE users SET {col} = COALESCE({col}, 0) + 1 WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()


def reset_period_usage(user_id: int) -> None:
    """A new (or renewed) paid term starts with a fresh quota."""
    conn = _conn()
    conn.execute('UPDATE users SET vox_used = 0 WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()


# ── A member's own VoxCPM2 link ──────────────────────────────────────────────
def get_user_endpoint(user_id: int) -> Optional[Dict[str, str]]:
    conn = _conn()
    r = conn.execute('SELECT url, api_key FROM user_vox_endpoints WHERE user_id = ?', (user_id,)).fetchone()
    conn.close()
    return {'url': r['url'], 'apiKey': r['api_key']} if r else None


def set_user_endpoint(user_id: int, url: str, api_key: str, keep_key: bool = False) -> None:
    conn = _conn()
    if keep_key:
        old = conn.execute('SELECT api_key FROM user_vox_endpoints WHERE user_id = ?', (user_id,)).fetchone()
        api_key = old['api_key'] if old else ''
    conn.execute(
        'INSERT INTO user_vox_endpoints (user_id, url, api_key, updated_at) VALUES (?, ?, ?, ?) '
        'ON CONFLICT(user_id) DO UPDATE SET url=excluded.url, api_key=excluded.api_key, updated_at=excluded.updated_at',
        (user_id, url, api_key, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def clear_user_endpoint(user_id: int) -> None:
    conn = _conn()
    conn.execute('DELETE FROM user_vox_endpoints WHERE user_id = ?', (user_id,))
    conn.commit()
    conn.close()


# ── Pro voices (admin-curated list of the clearest bank voices) ──────────────
PRO_VOICES_KEY = 'pro_voices'


def pro_voice_names() -> List[str]:
    try:
        raw = json.loads(auth_db.get_setting(PRO_VOICES_KEY) or '[]')
        return [str(x) for x in raw] if isinstance(raw, list) else []
    except (ValueError, TypeError):
        return []


def set_voice_pro(name: str, pro: bool) -> List[str]:
    names = [n for n in pro_voice_names() if n != name]
    if pro:
        names.append(name)
    auth_db.set_setting(PRO_VOICES_KEY, json.dumps(sorted(set(names))))
    return names
