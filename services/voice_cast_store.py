"""
Character Voice Casting Store (1 តួ = 1 សំឡេង)

រក្សាទុកសំឡេងដែលអ្នកប្រើ Upload សម្រាប់តួនីមួយៗ (ប្រុស ១, ស្រី ១ ...) ក្នុងវីដេអូនីមួយៗ។
- Local first: data/voice_casts.json (ដំណើរការបានទោះគ្មាន Internet)
- Cloud sync: Supabase table `character_voice_casts` + Storage bucket `voice-casts`
  (បើ Computer ផ្សេងមិនមានឯកសារសំឡេង វានឹងទាញពី Supabase មកវិញដោយស្វ័យប្រវត្តិ)
"""

import os
import json
import hashlib
import logging
import threading
from datetime import datetime, timezone
from typing import Optional, Dict, List, Any

from services import supabase_db

logger = logging.getLogger("voice_cast_store")

CAST_FILE_PREFIX = "cast_"
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def project_hash(owner_key: str, project_key: str) -> str:
    return hashlib.sha1(f"{owner_key}|{project_key}".encode("utf-8")).hexdigest()[:12]


def build_sample_filename(owner_key: str, project_key: str, speaker_key: str, ts_ms: int) -> str:
    # Hex-only name on purpose: the dubbing engine swaps reference audio whose file
    # name contains "male"/"female" for the wrong gender, so never put words here.
    digest = hashlib.sha1(f"{owner_key}|{project_key}|{speaker_key}".encode("utf-8")).hexdigest()[:10]
    return f"{CAST_FILE_PREFIX}{digest}_{ts_ms}.mp3"


class VoiceCastStore:
    def __init__(self, data_dir: str):
        self.path = os.path.join(data_dir, "voice_casts.json")

    # ---------- local JSON ----------
    def _load(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        if not os.path.exists(self.path):
            return {}
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception as e:
            logger.warning(f"voice_casts.json unreadable, starting fresh: {e}")
            return {}

    def _save(self, data: Dict[str, Any]):
        tmp = f"{self.path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    @staticmethod
    def _bucket_key(owner_key: str, project_key: str) -> str:
        return f"{owner_key}|{project_key}"

    # ---------- public API ----------
    def get(self, owner_key: str, project_key: str, speaker_key: str) -> Optional[Dict[str, Any]]:
        with _lock:
            return self._load().get(self._bucket_key(owner_key, project_key), {}).get(speaker_key)

    def save(self, owner_key: str, user_id: Optional[int], project_key: str, speaker_key: str,
             marker: str, gender: str, sample_filename: str, sample_path: str,
             original_name: str, line_count: int) -> Dict[str, Any]:
        storage_path = f"{owner_key}/{project_hash(owner_key, project_key)}/{sample_filename}"
        entry = {
            "speakerKey": speaker_key,
            "marker": marker,
            "gender": "female" if gender == "female" else "male",
            "voiceId": f"voxcpm:{sample_filename}",
            "filename": sample_filename,
            "previewUrl": f"/media/samples/{sample_filename}",
            "originalName": original_name,
            "lineCount": int(line_count or 0),
            "storagePath": storage_path,
            "cloud": False,
            "updatedAt": _now(),
        }

        if supabase_db.is_supabase_enabled():
            uploaded = supabase_db.storage_upload(supabase_db.VOICE_BUCKET, storage_path, sample_path, "audio/mpeg")
            row = supabase_db.sb_upsert("character_voice_casts", {
                "owner_key": owner_key,
                "user_id": user_id,
                "project_key": project_key,
                "speaker_key": speaker_key,
                "marker": marker,
                "gender": entry["gender"],
                "voice_id": entry["voiceId"],
                "sample_filename": sample_filename,
                "storage_path": storage_path if uploaded else None,
                "original_name": original_name,
                "line_count": entry["lineCount"],
                "updated_at": entry["updatedAt"],
            }, on_conflict="owner_key,project_key,speaker_key")
            entry["cloud"] = bool(uploaded and row is not None)

        with _lock:
            data = self._load()
            data.setdefault(self._bucket_key(owner_key, project_key), {})[speaker_key] = entry
            self._save(data)
        return entry

    def delete(self, owner_key: str, project_key: str, speaker_key: str) -> Optional[Dict[str, Any]]:
        with _lock:
            data = self._load()
            bucket = data.get(self._bucket_key(owner_key, project_key), {})
            removed = bucket.pop(speaker_key, None)
            self._save(data)

        if supabase_db.is_supabase_enabled():
            supabase_db.sb_delete("character_voice_casts", {
                "owner_key": f"eq.{owner_key}",
                "project_key": f"eq.{project_key}",
                "speaker_key": f"eq.{speaker_key}",
            })
            if removed and removed.get("storagePath"):
                supabase_db.storage_delete(supabase_db.VOICE_BUCKET, removed["storagePath"])
        return removed

    def list(self, owner_key: str, project_key: str, samples_dir: str) -> List[Dict[str, Any]]:
        """Return casts for a project; restores missing ones (or missing files) from Supabase."""
        with _lock:
            local = dict(self._load().get(self._bucket_key(owner_key, project_key), {}))

        if supabase_db.is_supabase_enabled():
            rows = supabase_db.sb_get("character_voice_casts", {
                "owner_key": f"eq.{owner_key}",
                "project_key": f"eq.{project_key}",
            }) or []
            changed = False
            for r in rows:
                sk = r.get("speaker_key")
                if not sk:
                    continue
                fname = r.get("sample_filename") or ""
                cur = local.get(sk)
                if cur and cur.get("filename") == fname:
                    if not cur.get("cloud") and r.get("storage_path"):
                        cur["cloud"] = True
                        changed = True
                    continue
                local[sk] = {
                    "speakerKey": sk,
                    "marker": r.get("marker") or "",
                    "gender": r.get("gender") or "male",
                    "voiceId": r.get("voice_id") or f"voxcpm:{fname}",
                    "filename": fname,
                    "previewUrl": f"/media/samples/{fname}",
                    "originalName": r.get("original_name") or "",
                    "lineCount": r.get("line_count") or 0,
                    "storagePath": r.get("storage_path"),
                    "cloud": bool(r.get("storage_path")),
                    "updatedAt": r.get("updated_at") or _now(),
                }
                changed = True

            # Pull sample audio down from Supabase Storage when this machine doesn't have it
            for entry in local.values():
                fname = entry.get("filename") or ""
                if not fname or os.path.basename(fname) != fname:
                    continue
                dest = os.path.join(samples_dir, fname)
                if not os.path.exists(dest) and entry.get("storagePath"):
                    supabase_db.storage_download(supabase_db.VOICE_BUCKET, entry["storagePath"], dest)

            if changed:
                with _lock:
                    data = self._load()
                    data[self._bucket_key(owner_key, project_key)] = local
                    self._save(data)

        result = []
        for entry in local.values():
            fname = entry.get("filename") or ""
            result.append({**entry, "exists": bool(fname) and os.path.exists(os.path.join(samples_dir, fname))})
        return result
