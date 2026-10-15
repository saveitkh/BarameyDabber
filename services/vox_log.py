"""Why can't the studio reach VoxCPM2?  A small in-memory error log plus a step-by-step connection check,
shown to admins only (the technical detail must never reach ordinary members)."""

import socket
import time
from collections import deque
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

_LOG: deque = deque(maxlen=40)


def classify(exc: BaseException, url: str = '') -> Dict[str, str]:
    """Plain-Khmer cause and fix for an exception raised while talking to VoxCPM2."""
    text = f"{type(exc).__name__}: {exc}"
    low = text.lower()
    host = urlparse(url).hostname or ''
    if 'name or service not known' in low or 'nodename nor servname' in low or 'failed to resolve' in low or 'temporary failure in name resolution' in low or isinstance(exc, socket.gaierror):
        if host == 'voxcpm':
            return {'code': 'dns-voxcpm', 'cause': "រកឈ្មោះ «voxcpm» មិនឃើញ — Container voxcpm មិនទាន់ដំណើរការលើ VPS (ឬមិននៅបណ្ដាញដូច studio)",
                    'fix': "លើ VPS រត់៖ cd /root/Project1 && docker compose up -d voxcpm  ហើយរង់ចាំ log «✅ VoxCPM2 ready» (docker compose logs -f voxcpm)។ ឬដាក់ Link Colab ជំនួស"}
        return {'code': 'dns', 'cause': f"រកអាសយដ្ឋាន «{host}» មិនឃើញ — Link ខុស ឬផុតកំណត់",
                'fix': "ពិនិត្យ Link ម្ដងទៀត។ បើជា trycloudflare.com Colab ត្រូវរត់ Cell ទី ២ ម្ដងទៀតដើម្បីបាន Link ថ្មី"}
    if 'connection refused' in low or 'errno 111' in low:
        return {'code': 'refused', 'cause': "បានទៅដល់ម៉ាស៊ីន តែគ្មានអ្វីស្ដាប់ Port នោះ — VoxCPM2 មិនដំណើរការ ឬ Port ខុស",
                'fix': "លើ VPS៖ docker compose ps voxcpm  (ត្រូវតែ Up) ហើយ docker compose logs --tail=50 voxcpm"}
    if 'timed out' in low or isinstance(exc, requests.exceptions.Timeout):
        return {'code': 'timeout', 'cause': "ម៉ាស៊ីនមិនឆ្លើយក្នុងរយៈពេលកំណត់ — កំពុងផ្ទុកម៉ូដែល រវល់បង្កើតសំឡេង ឬ Firewall/បណ្ដាញបិទ",
                'fix': "រង់ចាំ ១–២ នាទី ហើយសាកម្ដងទៀត។ បើ VPS ខ្វះ RAM (docker stats) VoxCPM2 អាចគាំង"}
    if 'ssl' in low or 'certificate' in low:
        return {'code': 'ssl', 'cause': "បញ្ហា HTTPS/ទិដ្ឋាបត្រ (SSL) ជាមួយ Link នេះ", 'fix': "ត្រូវប្រើ Link ដែលចាប់ផ្ដើមដោយ https:// ពី Colab ហើយចម្លងទាំងមូល"}
    if 'connection reset' in low or 'remote end closed' in low or 'connection aborted' in low:
        return {'code': 'reset', 'cause': "ការតភ្ជាប់ត្រូវបានផ្ដាច់ពាក់កណ្ដាល — VoxCPM2 អាចចាប់ផ្ដើមឡើងវិញ ឬអស់ RAM (OOM)",
                'fix': "មើល docker compose logs --tail=80 voxcpm និង free -h ។ ត្រូវការ RAM ~៨GB (ឬ swap)"}
    return {'code': 'other', 'cause': f"កំហុសមិនស្គាល់៖ {type(exc).__name__}", 'fix': "មើលលម្អិតក្នុង Log ខាងក្រោម និង docker compose logs studio"}


def record(where: str, exc: Optional[BaseException] = None, note: str = '', url: str = '') -> None:
    info = classify(exc, url) if exc is not None else {'code': 'note', 'cause': note, 'fix': ''}
    _LOG.appendleft({
        'at': datetime.now().strftime('%H:%M:%S'),
        'ts': time.time(),
        'where': where,
        'code': info['code'],
        'cause': info['cause'],
        'raw': (f"{type(exc).__name__}: {exc}"[:300] if exc is not None else note[:300]),
    })


def recent() -> List[Dict[str, Any]]:
    return list(_LOG)


def _check(name: str, ok: bool, detail: str) -> Dict[str, Any]:
    return {'name': name, 'ok': ok, 'detail': detail}


def diagnose(url: str, key: str, source: str) -> Dict[str, Any]:
    """Walks from 'is it configured' to 'does the key work', stopping at the first thing that is broken."""
    checks: List[Dict[str, Any]] = []
    out: Dict[str, Any] = {'url': url, 'source': source, 'checks': checks, 'cause': '', 'fix': '', 'ok': False}

    def fail(cause: str, fix: str):
        out['cause'], out['fix'] = cause, fix
        return out

    if not url:
        checks.append(_check('Link VoxCPM2', False, 'មិនទាន់កំណត់'))
        return fail("មិនទាន់មាន Link/URL របស់ VoxCPM2", "ដាក់ Link ក្នុង ការកំណត់ → Admin → VoxCPM2 (ឬ VOXCPM_URL ក្នុង .env)")
    checks.append(_check('Link VoxCPM2', True, f"{url}  (ប្រភព៖ {source})"))

    parsed = urlparse(url)
    host = parsed.hostname or ''
    if parsed.scheme not in ('http', 'https') or not host:
        checks.append(_check('ទម្រង់ Link', False, 'ត្រូវចាប់ផ្ដើមដោយ http:// ឬ https://'))
        return fail("ទម្រង់ Link មិនត្រឹមត្រូវ", "ដាក់ដូច https://xxxx.trycloudflare.com")
    try:
        ip = socket.gethostbyname(host)
        checks.append(_check('រកអាសយដ្ឋាន (DNS)', True, f"{host} → {ip}"))
    except OSError as e:
        checks.append(_check('រកអាសយដ្ឋាន (DNS)', False, f"{host}: {e}"))
        info = classify(e, url)
        record('diagnose', e, url=url)
        return fail(info['cause'], info['fix'])

    try:
        t0 = time.time()
        r = requests.get(url, timeout=8)
        ms = int((time.time() - t0) * 1000)
    except Exception as e:  # noqa: BLE001
        checks.append(_check('ភ្ជាប់ HTTP', False, f"{type(e).__name__}: {str(e)[:160]}"))
        info = classify(e, url)
        record('diagnose', e, url=url)
        return fail(info['cause'], info['fix'])
    checks.append(_check('ភ្ជាប់ HTTP', True, f"HTTP {r.status_code} ក្នុង {ms}ms"))

    body = ''
    try:
        body = r.text[:200].replace('\n', ' ')
    except Exception:  # noqa: BLE001
        pass
    if r.status_code in (502, 503, 504, 530, 1033) or (r.status_code == 404 and 'cloudflare' in r.headers.get('server', '').lower()):
        if r.status_code == 503 and 'loading' in body.lower():
            checks.append(_check('ម៉ូដែល', False, 'កំពុងផ្ទុក'))
            return fail("VoxCPM2 កំពុងផ្ទុកម៉ូដែល (លើកដំបូង ១០–៣០ នាទី)", "រង់ចាំ។ មើល docker compose logs -f voxcpm រហូតឃើញ «✅ VoxCPM2 ready»")
        if 'trycloudflare' in host or 'cloudflare' in r.headers.get('server', '').lower():
            checks.append(_check('ផ្លូវ Cloudflare', False, f"HTTP {r.status_code} — Tunnel មិនមានម៉ាស៊ីនបម្រើ"))
            return fail("Link Colab នេះស្លាប់ហើយ — Colab បានឈប់/ផ្ដាច់ (Cell ទី ២ មិនដំណើរការ) ឬ Link ផុតកំណត់", "បើក Colab → Runtime → Run all (ឬ Cell ទី ២) ហើយចម្លង Link ថ្មីមកដាក់ក្នុង App")
        checks.append(_check('ម៉ូដែល', False, f"HTTP {r.status_code} {body}"))
        return fail(f"VoxCPM2 ឆ្លើយ HTTP {r.status_code} (មិនទាន់ត្រៀម ឬកំពុងបរាជ័យ)", "មើល docker compose logs --tail=80 voxcpm")
    if r.status_code != 200:
        checks.append(_check('ម៉ូដែល', False, f"HTTP {r.status_code} {body}"))
        return fail(f"Link នេះមិនមែនម៉ាស៊ីន VoxCPM2 ទេ (HTTP {r.status_code})", "ពិនិត្យ Link — ត្រូវតែជា Link ពី Colab Cell ទី ២ ឬ http://voxcpm:8000")
    try:
        info = r.json()
    except ValueError:
        checks.append(_check('ម៉ូដែល', False, 'មិនមែន JSON'))
        return fail("Link នេះឆ្លើយតបមិនមែនជា VoxCPM2", "ពិនិត្យ Link ម្ដងទៀត")
    checks.append(_check('ម៉ូដែល', info.get('status') == 'ready', f"{info.get('model', '?')} · {info.get('device', '?')} · {info.get('status')}"))
    if info.get('status') != 'ready':
        return fail("VoxCPM2 មិនទាន់ត្រៀម", "រង់ចាំម៉ូដែលផ្ទុក ឬមើល log")

    try:
        v = requests.get(url.rstrip('/') + '/api/voices', headers={'X-Api-Key': key} if key else {}, timeout=10)
    except Exception as e:  # noqa: BLE001
        checks.append(_check('កូដសម្ងាត់ (API key)', False, f"{type(e).__name__}"))
        return fail("សួរបញ្ជីសំឡេងមិនបាន", str(e)[:120])
    if v.status_code in (401, 403):
        checks.append(_check('កូដសម្ងាត់ (API key)', False, f"HTTP {v.status_code} — Key មិនត្រូវ"))
        return fail("API key មិនដូចគ្នានឹងម៉ាស៊ីន VoxCPM2", "ដាក់ Key ដូចគ្នា (VOXCPM_API_KEY ក្នុង .env ឬ API_KEY ក្នុង Colab) ក្នុង ការកំណត់ → Admin → VoxCPM2")
    if v.status_code != 200:
        checks.append(_check('កូដសម្ងាត់ (API key)', False, f"HTTP {v.status_code}"))
        return fail(f"សួរបញ្ជីសំឡេងបរាជ័យ (HTTP {v.status_code})", "មើល docker compose logs --tail=80 voxcpm")
    try:
        n = len(v.json())
    except ValueError:
        n = 0
    checks.append(_check('កូដសម្ងាត់ & ធនាគារសំឡេង', True, f"Key ត្រឹមត្រូវ · មាន {n} សំឡេង"))
    out['ok'] = True
    out['cause'] = 'ភ្ជាប់បានល្អ ✓'
    return out
