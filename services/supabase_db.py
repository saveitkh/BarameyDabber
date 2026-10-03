"""
Supabase REST + Storage helper (server-side only).

ប្រើ Service/Secret key នៅលើ Server ប៉ុណ្ណោះ — មិនត្រូវដាក់ key នេះក្នុង Frontend ទេ។

Environment variables (.env):
    SUPABASE_URL=https://<project-ref>.supabase.co
    SUPABASE_SERVICE_KEY=<service_role JWT  ឬ  sb_secret_... key>
    SUPABASE_VOICE_BUCKET=voice-casts          (optional)

ឈ្មោះ key ផ្សេងទៀតដែលទទួលស្គាល់: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY
"""

import os
import time
import logging
import urllib.parse
from typing import Optional, Dict, List, Any

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("supabase_db")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_SECRET_KEY")
    or ""
).strip()
VOICE_BUCKET = os.getenv("SUPABASE_VOICE_BUCKET", "voice-casts").strip() or "voice-casts"

# When the cloud is unreachable we don't want every auth call to wait on a
# 4-second ping, so failures are cached and retried after this many seconds.
_RETRY_SECONDS = 30.0

_tables_verified: Optional[bool] = None
_last_check_ts: float = 0.0
_last_error: str = ""
_status_cache: Optional[Dict[str, Any]] = None
_status_cache_ts: float = 0.0
_STATUS_CACHE_SECONDS = 15.0


def _is_new_key_format(key: str) -> bool:
    # New Supabase API keys look like sb_secret_xxx / sb_publishable_xxx (not JWTs)
    return key.startswith("sb_")


def get_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
        "User-Agent": "FastAPI-Server/1.0",
        "Prefer": "return=representation",
    }
    # Legacy service_role keys are JWTs and must also be sent as Bearer token.
    # New sb_secret_ keys only need the apikey header (the gateway maps the role).
    if SUPABASE_SERVICE_KEY and not _is_new_key_format(SUPABASE_SERVICE_KEY):
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_KEY}"
    if extra:
        headers.update(extra)
    return headers


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def reset_cache():
    global _tables_verified, _last_check_ts, _last_error, _status_cache
    _tables_verified = None
    _last_check_ts = 0.0
    _last_error = ""
    _status_cache = None


def is_supabase_enabled() -> bool:
    global _tables_verified, _last_check_ts, _last_error
    if not is_configured():
        return False
    if _tables_verified is True:
        return True
    if _tables_verified is False and (time.time() - _last_check_ts) < _RETRY_SECONDS:
        return False

    _last_check_ts = time.time()
    try:
        url = f"{SUPABASE_URL}/rest/v1/users?select=id&limit=1"
        res = httpx.get(url, headers=get_headers(), timeout=4.0)
        if res.status_code == 200:
            if _tables_verified is not True:
                logger.info("Supabase connected: %s", SUPABASE_URL)
            _tables_verified = True
            _last_error = ""
            return True
        if res.status_code == 404:
            _last_error = "តារាង users មិនទាន់មាន — សូម Run supabase_schema.sql ក្នុង SQL Editor"
        elif res.status_code in (401, 403):
            _last_error = "Key មិនត្រឹមត្រូវ — ត្រូវប្រើ service_role ឬ sb_secret_ key"
        else:
            _last_error = f"HTTP {res.status_code}: {res.text[:160]}"
    except Exception as e:
        _last_error = f"មិនអាចភ្ជាប់ទៅ Supabase: {e}"
        logger.debug(f"Supabase ping error: {e}")

    if _tables_verified is not False:
        logger.warning("Supabase disabled (%s). Falling back to local SQLite.", _last_error)
    _tables_verified = False
    return False


def sb_get(table: str, params: Optional[Dict[str, Any]] = None) -> Optional[List[Dict[str, Any]]]:
    if not is_supabase_enabled():
        return None
    try:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        res = httpx.get(url, headers=get_headers(), params=params, timeout=5.0)
        if res.status_code == 200:
            return res.json()
        logger.error(f"Supabase GET {table} error {res.status_code}: {res.text[:200]}")
    except Exception as e:
        logger.error(f"Supabase GET {table} failed: {e}")
    return None


def sb_post(table: str, data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    if not is_supabase_enabled():
        return None
    try:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        res = httpx.post(url, headers=get_headers(), json=data, timeout=5.0)
        if res.status_code in (200, 201):
            return res.json()
        logger.error(f"Supabase POST {table} error {res.status_code}: {res.text}")
    except Exception as e:
        logger.error(f"Supabase POST {table} exception: {e}")
    return None


def sb_upsert(table: str, data: Dict[str, Any], on_conflict: str) -> Optional[List[Dict[str, Any]]]:
    """Insert or update a row using a UNIQUE constraint (PostgREST merge-duplicates)."""
    if not is_supabase_enabled():
        return None
    try:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        headers = get_headers({"Prefer": "resolution=merge-duplicates,return=representation"})
        res = httpx.post(url, headers=headers, params={"on_conflict": on_conflict}, json=data, timeout=5.0)
        if res.status_code in (200, 201):
            return res.json()
        logger.error(f"Supabase UPSERT {table} error {res.status_code}: {res.text}")
    except Exception as e:
        logger.error(f"Supabase UPSERT {table} exception: {e}")
    return None


def sb_patch(table: str, filter_params: Dict[str, str], data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    if not is_supabase_enabled():
        return None
    try:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        res = httpx.patch(url, headers=get_headers(), params=filter_params, json=data, timeout=5.0)
        if res.status_code in (200, 204):
            return res.json() if res.content else []
        logger.error(f"Supabase PATCH {table} error {res.status_code}: {res.text}")
    except Exception as e:
        logger.error(f"Supabase PATCH {table} exception: {e}")
    return None


def sb_delete(table: str, filter_params: Dict[str, str]) -> bool:
    if not is_supabase_enabled():
        return False
    try:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        res = httpx.delete(url, headers=get_headers(), params=filter_params, timeout=5.0)
        return res.status_code in (200, 204)
    except Exception as e:
        logger.error(f"Supabase DELETE {table} exception: {e}")
    return False


# ==========================================
# STORAGE (voice samples for character casting)
# ==========================================

def _object_url(bucket: str, path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/{bucket}/{urllib.parse.quote(path)}"


def storage_upload(bucket: str, path: str, file_path: str, content_type: str = "audio/mpeg") -> bool:
    if not is_supabase_enabled() or not os.path.exists(file_path):
        return False
    try:
        with open(file_path, "rb") as f:
            payload = f.read()
        headers = get_headers({"Content-Type": content_type, "x-upsert": "true"})
        headers.pop("Prefer", None)
        res = httpx.post(_object_url(bucket, path), headers=headers, content=payload, timeout=30.0)
        if res.status_code in (200, 201):
            return True
        logger.error(f"Supabase storage upload {bucket}/{path} error {res.status_code}: {res.text[:200]}")
    except Exception as e:
        logger.error(f"Supabase storage upload exception: {e}")
    return False


def storage_download(bucket: str, path: str, dest_path: str) -> bool:
    if not is_supabase_enabled():
        return False
    try:
        headers = get_headers()
        headers.pop("Content-Type", None)
        headers.pop("Prefer", None)
        res = httpx.get(_object_url(bucket, path), headers=headers, timeout=30.0)
        if res.status_code == 200 and res.content:
            with open(dest_path, "wb") as f:
                f.write(res.content)
            return True
        logger.error(f"Supabase storage download {bucket}/{path} error {res.status_code}")
    except Exception as e:
        logger.error(f"Supabase storage download exception: {e}")
    return False


def storage_delete(bucket: str, path: str) -> bool:
    if not is_supabase_enabled():
        return False
    try:
        headers = get_headers()
        headers.pop("Prefer", None)
        res = httpx.request("DELETE", f"{SUPABASE_URL}/storage/v1/object/{bucket}",
                            headers=headers, json={"prefixes": [path]}, timeout=10.0)
        return res.status_code in (200, 204)
    except Exception as e:
        logger.error(f"Supabase storage delete exception: {e}")
    return False


def _table_exists(table: str) -> bool:
    try:
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{table}?select=*&limit=1", headers=get_headers(), timeout=4.0)
        return res.status_code == 200
    except Exception:
        return False


def _bucket_exists(bucket: str) -> bool:
    try:
        headers = get_headers()
        headers.pop("Prefer", None)
        res = httpx.get(f"{SUPABASE_URL}/storage/v1/bucket/{bucket}", headers=headers, timeout=4.0)
        return res.status_code == 200
    except Exception:
        return False


def get_status(force: bool = False) -> Dict[str, Any]:
    """Connection report for the UI / System Status (never exposes the key)."""
    global _status_cache, _status_cache_ts
    if force:
        reset_cache()
    elif _status_cache is not None and (time.time() - _status_cache_ts) < _STATUS_CACHE_SECONDS:
        return dict(_status_cache)
    status = _build_status()
    _status_cache, _status_cache_ts = status, time.time()
    return dict(status)


def _build_status() -> Dict[str, Any]:
    host = urllib.parse.urlparse(SUPABASE_URL).netloc if SUPABASE_URL else ""
    status: Dict[str, Any] = {
        "configured": is_configured(),
        "connected": False,
        "host": host,
        "keyType": ("secret" if _is_new_key_format(SUPABASE_SERVICE_KEY) else "service_role") if SUPABASE_SERVICE_KEY else None,
        "tables": {},
        "voiceBucket": VOICE_BUCKET,
        "voiceBucketReady": False,
        "message": "",
    }
    if not status["configured"]:
        status["message"] = "មិនទាន់កំណត់ SUPABASE_URL / SUPABASE_SERVICE_KEY ក្នុង .env — កំពុងប្រើ Local SQLite"
        return status

    status["connected"] = is_supabase_enabled()
    if not status["connected"]:
        status["message"] = _last_error or "មិនអាចភ្ជាប់ Supabase"
        return status

    for t in ("users", "sessions", "license_keys", "processing_jobs", "video_library", "character_voice_casts"):
        status["tables"][t] = _table_exists(t)
    status["voiceBucketReady"] = _bucket_exists(VOICE_BUCKET)
    missing = [t for t, ok in status["tables"].items() if not ok]
    if missing or not status["voiceBucketReady"]:
        status["message"] = "ភ្ជាប់បាន ប៉ុន្តែខ្វះ: " + ", ".join(missing + ([] if status["voiceBucketReady"] else [f"bucket {VOICE_BUCKET}"])) + " — សូម Run supabase_schema.sql ម្តងទៀត"
    else:
        status["message"] = "Supabase ភ្ជាប់រួចរាល់ 100%"
    return status
