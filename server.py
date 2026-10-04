import os
import re
import sys
import time
import json
import shutil
import asyncio
import base64
import secrets
import logging
from datetime import datetime, timedelta

# Force UTF-8 encoding on Windows console
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from typing import Optional, List
from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import queue
import asyncio

# Resolve APP_DIR and BUNDLE_DIR (both one-file and one-dir PyInstaller modes)
if getattr(sys, 'frozen', False):
    APP_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = getattr(sys, '_MEIPASS', APP_DIR)
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = APP_DIR

BASE_DIR = APP_DIR

# Prepend persistent patches and services to sys.path so hot updates override bundled modules
for p in [os.path.join(APP_DIR, 'patches'), os.path.join(APP_DIR, 'services')]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)

env_file_path = os.path.join(APP_DIR, '.env')
if not os.path.exists(env_file_path):
    env_file_path = os.path.join(BUNDLE_DIR, '.env')
_launcher_port = os.environ.get('STUDIO_PORT')  # set by run.bat when it picks a free port
load_dotenv(dotenv_path=env_file_path, override=True)
if _launcher_port:
    os.environ['PORT'] = _launcher_port

from services import audio_processor, auth_db
from services import khqr as khqr_service
from services import bakong as bakong_service
from services.khmer_dubber import KhmerDubber, clean_pure_khmer, ROLE_THEATRICAL_PROFILES
from services.elevenlabs_service import elevenlabs_service
from services.unified_db import unified_db
from services import supabase_db
from services.voice_cast_store import VoiceCastStore, build_sample_filename, CAST_FILE_PREFIX
from services.checkpoint_manager import checkpoint_manager
from services.auto_updater import auto_updater
from services.update_manager import get_update_manager
from services.module_loader import get_module_loader
from services.progress_tracker import create_tracker, get_tracker, OperationType

app = FastAPI(title="AI Voice Clone & Dubbing Studio (ZH -> KM)")

EXTRA_PATHS = [
    os.path.join(BUNDLE_DIR, 'bin'),
    os.path.join(APP_DIR, 'bin'),
    '/opt/homebrew/bin',      # Apple Silicon Mac (M1/M2/M3/M4) Homebrew
    '/usr/local/bin',          # Intel Mac Homebrew & standard UNIX tools
    '/opt/local/bin',          # MacPorts
]
for p in EXTRA_PATHS:
    if os.path.exists(p) and p not in os.environ.get('PATH', ''):
        os.environ['PATH'] = p + os.pathsep + os.environ.get('PATH', '')

UPLOADS_DIR = os.path.join(APP_DIR, 'uploads')
OUTPUTS_DIR = os.path.join(APP_DIR, 'outputs')
SAMPLES_DIR = os.path.join(APP_DIR, 'samples')
if not os.path.exists(SAMPLES_DIR) and os.path.exists(os.path.join(BUNDLE_DIR, 'samples')):
    SAMPLES_DIR = os.path.join(BUNDLE_DIR, 'samples')

# Priority: Check if updated public exists in APP_DIR first, fallback to bundled public
app_public_dir = os.path.join(APP_DIR, 'public')
bundle_public_dir = os.path.join(BUNDLE_DIR, 'public')
if os.path.exists(app_public_dir) and os.path.isdir(app_public_dir):
    PUBLIC_DIR = app_public_dir
else:
    PUBLIC_DIR = bundle_public_dir

DATA_DIR = os.path.join(APP_DIR, 'data')
ACTIVE_PROJECT_FILE = os.path.join(DATA_DIR, 'active_project.json')

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)
os.makedirs(SAMPLES_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# Auto-seed initial template/data files if not yet existing on user's machine
bundle_data = os.path.join(BUNDLE_DIR, 'data')
if os.path.exists(bundle_data) and bundle_data != DATA_DIR:
    for item in os.listdir(bundle_data):
        src_item = os.path.join(bundle_data, item)
        dst_item = os.path.join(DATA_DIR, item)
        if not os.path.exists(dst_item) and os.path.isfile(src_item):
            try:
                shutil.copy2(src_item, dst_item)
            except Exception:
                pass

# Auto-seed extracted_characters.json if missing in APP_DIR
chars_bundle = os.path.join(BUNDLE_DIR, 'extracted_characters.json')
chars_app = os.path.join(APP_DIR, 'extracted_characters.json')
if not os.path.exists(chars_app) and os.path.exists(chars_bundle):
    try:
        shutil.copy2(chars_bundle, chars_app)
    except Exception:
        pass

khmer_dubber = KhmerDubber()
cast_store = VoiceCastStore(DATA_DIR)
active_jobs = {}
progress_subscribers = {}  # Real-time progress tracking for SSE

# Setup logger
logger = logging.getLogger(__name__)


# --- Authentication Helpers ---
def get_request_user(request: Request) -> Optional[dict]:
    """Retrieve validated user from Authorization Bearer token or headers."""
    auth_header = request.headers.get('Authorization', '')
    token = ''
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get('x-auth-token', '')
    if not token:
        token = request.query_params.get('token', '')
    if not token:
        # Check for persistent token in cookies
        token = request.cookies.get('auth_token', '')
    return auth_db.get_user_by_token(token) if token else None

# ── Server (VPS) mode ────────────────────────────────────────────────────────
# On a PC only the owner can reach the API, so many endpoints are open. On a VPS anyone on
# the internet can, so STUDIO_PUBLIC_MODE=1 (set by the Docker image) requires a login for
# every API call and admin rights for anything that changes keys, files or code.
PUBLIC_MODE = os.getenv('STUDIO_PUBLIC_MODE', '0') == '1'
ALLOW_REGISTER = os.getenv('STUDIO_ALLOW_REGISTER', '0' if PUBLIC_MODE else '1') == '1'

_PUBLIC_ROUTES = {
    ('POST', '/api/auth/login'), ('POST', '/api/auth/register'), ('POST', '/api/auth/logout'),
    ('POST', '/api/auth/telegram'), ('GET', '/api/auth/telegram/enabled'),
    ('GET', '/api/auth/check-session'), ('GET', '/api/auth/me'), ('GET', '/api/system/version'),
}
# Read-only progress of a job id the client already holds (EventSource cannot send headers)
_PUBLIC_PREFIXES = ('/api/progress/stream/', '/api/dubbing/status/')
_ADMIN_PREFIXES = ('/api/system/', '/api/update/', '/api/modules/', '/api/admin/', '/api/voxcpm/switch-mode',
                   '/api/voxcpm/start-local', '/api/outputs/clear', '/api/files/clear')
_ADMIN_OPEN = {('GET', '/api/system/hardware'), ('GET', '/api/system/network-info'), ('GET', '/api/update/status')}


def _public_mode_denial(request: Request) -> Optional[JSONResponse]:
    path, method = request.url.path, request.method.upper()
    if not path.startswith('/api/') or method == 'OPTIONS':
        return None
    if (method, path) in _PUBLIC_ROUTES or path.startswith(_PUBLIC_PREFIXES):
        if path == '/api/auth/register' and not ALLOW_REGISTER:
            return JSONResponse(status_code=403, content={
                'detail': 'Server នេះបិទការចុះឈ្មោះ — សូមឲ្យ Admin បង្កើតគណនីឲ្យ'})
        return None
    user = get_request_user(request)
    if not user:
        return JSONResponse(status_code=401, content={'detail': 'សូមចូលគណនីជាមុនសិន'})
    needs_admin = (
        (path.startswith(_ADMIN_PREFIXES) and (method, path) not in _ADMIN_OPEN)
        or (method == 'POST' and path == '/api/config')
        or (method == 'DELETE' and path.startswith('/api/files/'))
    )
    if needs_admin and user.get('role') != 'admin':
        return JSONResponse(status_code=403, content={'detail': 'មុខងារនេះសម្រាប់តែ Admin ប៉ុណ្ណោះ'})
    return None


if PUBLIC_MODE:
    @app.middleware('http')
    async def public_mode_guard(request: Request, call_next):
        # Token lookup touches SQLite (and Supabase when enabled) — keep it off the event loop
        denial = await asyncio.to_thread(_public_mode_denial, request)
        return denial if denial is not None else await call_next(request)


def require_admin(request: Request) -> dict:
    """Ensure current user is authenticated and has admin role."""
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលប្រើប្រាស់គណនី Admin ជាមុនសិន")
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="អ្នកមិនមានសិទ្ធិជា Administrator ទេ")
    return user

# --- Pydantic Request Models ---
class AuthRegisterRequest(BaseModel):
    username: str
    password: str
    deviceId: Optional[str] = None

class AuthLoginRequest(BaseModel):
    username: str
    password: str
    deviceId: Optional[str] = None
    rememberMe: Optional[bool] = True  # Default to True

class ActivateLicenseRequest(BaseModel):
    license_key: str
    deviceId: Optional[str] = None

class CreateLicenseKeyRequest(BaseModel):
    days: int = 30
    feature: str = 'voxcpm2'

class ToggleUserVoxcpmRequest(BaseModel):
    userId: int
    enabled: bool
    days: int = 30

class SetPremiumRequest(BaseModel):
    userId: int
    days: int

class RevokePremiumRequest(BaseModel):
    userId: int

class DeleteUserRequest(BaseModel):
    userId: int

class ResetUserDeviceRequest(BaseModel):
    userId: int

class ResetUserPasswordRequest(BaseModel):
    userId: int
    newPassword: str

class ConfigUpdate(BaseModel):
    elevenlabsKey: Optional[str] = None
    geminiKey: Optional[str] = None
    voxcpmUrl: Optional[str] = None
    geminiModel: Optional[str] = None

class SetKhqrTemplateRequest(BaseModel):
    payload: str

class CreateSubscriptionOrderRequest(BaseModel):
    plan: str  # 'monthly' | 'unlimited'

class ConfirmSubscriptionOrderRequest(BaseModel):
    ticket: str

class DubbingStartRequest(BaseModel):
    filename: str
    sourceLang: Optional[str] = 'zh'
    targetLang: Optional[str] = 'km'
    voiceId: Optional[str] = 'voice_actor_clone'
    scope: Optional[str] = 'full'
    castingSafetyMode: Optional[str] = 'safe_curated'
    characterVoiceMap: Optional[dict] = {}
    maleLeadVoice: Optional[str] = 'hang_phleung_char_2_male.mp3'
    femaleLeadVoice: Optional[str] = 'hang_phleung_char_6_female.mp3'
    geminiModel: Optional[str] = 'gemini-flash-latest'

class ScanTimelineRequest(BaseModel):
    filename: str
    scope: Optional[str] = 'full'
    voiceMode: Optional[str] = 'voice_actor_clone'

class GenerateLineRequest(BaseModel):
    text: str
    lineIndex: Optional[int] = 0
    gender: Optional[str] = 'male'
    voiceId: Optional[str] = 'voxcpm-voice-actor'
    speakerId: Optional[str] = None
    emotion: Optional[str] = 'dramatic'
    speed: Optional[float] = 1.0   # 0.5 - 2.0, applied to the finished audio
    pitch: Optional[int] = 0       # semitones, -12 .. +12
    # Acted delivery with breathing (Gemini TTS / expressive Khmer) instead of flat TTS
    naturalVoice: Optional[bool] = False
    characterNumber: Optional[int] = None   # ប្រុស ១ = 1 … keeps one voice per character
    slotSeconds: Optional[float] = None     # time the line has in the video

class DownloadVideoRequest(BaseModel):
    url: str
    quality: Optional[str] = 'best'

class AssembleCustomRequest(BaseModel):
    filename: str
    segments: List[dict]
    bgmAudio: Optional[str] = None
    removeOriginalVocals: Optional[bool] = False
    vocalGain: Optional[float] = 2.2
    bgmGain: Optional[float] = 1.0
    # 'auto' = like 'clean' with levels measured and set automatically, 'clean' = keep
    # music/effects but strip the original voices, 'original' = keep the original soundtrack
    # quietly underneath, 'none' = Khmer voices only. None keeps the older
    # removeOriginalVocals behaviour.
    bgmMode: Optional[str] = None
    # Voice missing lines with acted, breathing delivery and polish the dialogue track
    naturalVoice: Optional[bool] = False
    # Burn the Khmer lines into the picture as subtitles
    burnSubtitles: Optional[bool] = False
    subtitleStyle: Optional[dict] = None

class RenderExportRequest(BaseModel):
    filename: str
    inputVideo: Optional[str] = None
    titleOverlayBase64: Optional[str] = None
    burnSubtitles: Optional[bool] = False
    subtitles: Optional[List[dict]] = None
    resolution: Optional[str] = '1080p'
    format: Optional[str] = 'mp4'
    bitrate: Optional[str] = 'high'
    watermark: Optional[dict] = None
    subtitleStyle: Optional[dict] = None
    turbo: Optional[bool] = True
    outputDir: Optional[str] = None

class AddShelfVideoRequest(BaseModel):
    filename: str
    originalName: Optional[str] = None
    size: Optional[int] = 0
    duration: Optional[float] = 0
    thumbnail: Optional[str] = None
    groupId: Optional[str] = None
    groupName: Optional[str] = None

class UpdateShelfVideoGroupRequest(BaseModel):
    groupId: Optional[str] = None
    groupName: Optional[str] = None

class CreateProjectGroupRequest(BaseModel):
    name: str
    color: Optional[str] = 'cyan'
    description: Optional[str] = ''
    maleLeadVoice: Optional[str] = None
    femaleLeadVoice: Optional[str] = None
    narratorVoice: Optional[str] = None
    supportingVoice: Optional[str] = None

class UpdateProjectGroupRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    maleLeadVoice: Optional[str] = None
    femaleLeadVoice: Optional[str] = None
    narratorVoice: Optional[str] = None
    supportingVoice: Optional[str] = None


class CharacterSpeakRequest(BaseModel):
    voiceId: str
    text: str
    gender: Optional[str] = 'male'
    referenceAudio: Optional[str] = None
    emotion: Optional[str] = 'dramatic'

class CharacterUpdateRequest(BaseModel):
    id: Optional[str] = None
    filename: Optional[str] = None
    label: Optional[str] = None
    role_key: Optional[str] = None
    gender: Optional[str] = None
    words: Optional[str] = None

class SwitchModeRequest(BaseModel):
    mode: str
    cloudUrl: Optional[str] = None

# --- Authentication & Admin Endpoints ---

@app.post('/api/auth/register')
def auth_register(body: AuthRegisterRequest, request: Request):
    try:
        device_id = body.deviceId or request.headers.get('x-device-id')
        res = auth_db.register_user(body.username, body.password, device_id)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/api/auth/login')
def auth_login(body: AuthLoginRequest, request: Request):
    try:
        device_id = body.deviceId or request.headers.get('x-device-id')
        res = auth_db.login_user(body.username, body.password, device_id)
        
        # Determine session duration (30 days with remember me, 1 day without)
        remember_me = getattr(body, 'rememberMe', True)  # Default to True for convenience
        max_age = (30 * 24 * 60 * 60) if remember_me else (24 * 60 * 60)
        
        # Create persistent session
        response = JSONResponse(content=res)
        if 'token' in res:
            response.set_cookie(
                key='auth_token',
                value=res['token'],
                max_age=max_age,
                httponly=True,
                samesite='lax',
                secure=False  # Set to True in production with HTTPS
            )
            # Also set remember preference
            response.set_cookie(
                key='remember_me',
                value='1' if remember_me else '0',
                max_age=365 * 24 * 60 * 60,  # 1 year
                httponly=False,
                samesite='lax'
            )
        return response
    except ValueError as ve:
        raise HTTPException(status_code=401, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Telegram Mini App login ───────────────────────────────────────────────────
# Opened from the bot's inline "🎬" button, Telegram hands the page signed user data
# (initData). Verifying it with the bot token proves who the user is, so they are logged
# in (and their account created on first use) without a password.
TELEGRAM_BOT_TOKEN = (os.getenv('STUDIO_TELEGRAM_BOT_TOKEN') or os.getenv('TELEGRAM_BOT_TOKEN') or '').strip()
TELEGRAM_ADMIN_IDS = {x.strip() for x in (os.getenv('STUDIO_TELEGRAM_ADMIN_IDS') or '').split(',') if x.strip()}
TELEGRAM_SIGNUP = os.getenv('STUDIO_TELEGRAM_SIGNUP', '1') == '1'
TELEGRAM_INITDATA_MAX_AGE = 24 * 3600


class TelegramAuthRequest(BaseModel):
    initData: str
    deviceId: Optional[str] = None


def verify_telegram_init_data(init_data: str, bot_token: str, max_age: int = TELEGRAM_INITDATA_MAX_AGE) -> Optional[dict]:
    """Return the Telegram user when initData carries a valid, recent signature, else None."""
    import hmac, hashlib
    from urllib.parse import parse_qsl
    try:
        fields = dict(parse_qsl(init_data or '', keep_blank_values=True, strict_parsing=True))
    except ValueError:
        return None
    received = fields.pop('hash', '')
    if not received or not bot_token:
        return None
    check_string = '\n'.join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b'WebAppData', bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        return None
    try:
        if time.time() - int(fields.get('auth_date', '0')) > max_age:
            return None
        user = json.loads(fields.get('user') or '{}')
    except (ValueError, TypeError):
        return None
    return user if user.get('id') else None


@app.get('/api/auth/telegram/enabled')
def telegram_login_enabled():
    return {'enabled': bool(TELEGRAM_BOT_TOKEN)}


@app.post('/api/auth/telegram')
def auth_telegram(body: TelegramAuthRequest):
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram login មិនទាន់កំណត់ (STUDIO_TELEGRAM_BOT_TOKEN)")
    tg_user = verify_telegram_init_data(body.initData, TELEGRAM_BOT_TOKEN)
    if not tg_user:
        raise HTTPException(status_code=401, detail="ទិន្នន័យ Telegram មិនត្រឹមត្រូវ ឬផុតកំណត់ — សូមបើកពី Bot ម្តងទៀត")
    try:
        res = auth_db.login_telegram_user(
            tg_user, body.deviceId,
            make_admin=str(tg_user['id']) in TELEGRAM_ADMIN_IDS,
            allow_signup=TELEGRAM_SIGNUP,
        )
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    response = JSONResponse(content=res)
    response.set_cookie(key='auth_token', value=res['token'], max_age=30 * 24 * 3600,
                        httponly=True, samesite='none', secure=True)
    return response


@app.get('/api/auth/check-session')
def check_session(request: Request):
    """Check if user has valid session (auto-login)"""
    try:
        # Try to get token from cookie first
        token = request.cookies.get('auth_token')
        if not token:
            # Fallback to header
            auth_header = request.headers.get('Authorization', '')
            if auth_header.startswith('Bearer '):
                token = auth_header[7:].strip()
        
        if not token:
            return {'authenticated': False, 'user': None}
        
        # Validate token
        user = auth_db.get_user_by_token(token)
        if not user:
            return {'authenticated': False, 'user': None}
        
        return {
            'authenticated': True,
            'user': user,
            'token': token
        }
    except Exception as e:
        return {'authenticated': False, 'user': None, 'error': str(e)}

@app.post('/api/auth/logout')
def auth_logout(request: Request):
    auth_header = request.headers.get('Authorization', '')
    token = ''
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get('x-auth-token', '')
    if not token:
        token = request.cookies.get('auth_token', '')
    if token:
        auth_db.logout_user(token)
    
    # Clear persistent cookie
    response = JSONResponse(content={'success': True})
    response.delete_cookie(key='auth_token')
    return response

@app.get('/api/auth/me')
def auth_me(request: Request):
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="គណនីរបស់អ្នកត្រូវបានចូលប្រើនៅលើឧបករណ៍ផ្សេងទៀត (Single Device Limit)")
    return {'user': user}

# --- License Key Endpoints (VoxCPM2 Permission System) ---

@app.post('/api/license/activate')
def api_activate_license(body: ActivateLicenseRequest, request: Request):
    user = get_request_user(request)
    device_id = request.headers.get('x-device-id') or body.deviceId or ('dev_' + secrets.token_hex(4))
    
    # If not logged in, auto-link to device user so activation always succeeds seamlessly
    if not user:
        user = auth_db.get_or_create_device_user(device_id)
        
    try:
        res = auth_db.activate_license_key(user['id'], body.license_key)
        # Issue persistent session token
        token = auth_db.create_session_for_user(user['id'], device_id)
        res['token'] = token
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/api/admin/license-keys')
def api_admin_list_keys(request: Request):
    require_admin(request)
    return {'keys': auth_db.list_license_keys()}

@app.post('/api/admin/license-keys/create')
def api_admin_create_key(body: CreateLicenseKeyRequest, request: Request):
    require_admin(request)
    res = auth_db.create_license_key(body.days, body.feature)
    return {'success': True, 'key': res}

@app.delete('/api/admin/license-keys/{key_id}')
def api_admin_delete_key(key_id: int, request: Request):
    require_admin(request)
    auth_db.delete_license_key(key_id)
    return {'success': True}

@app.post('/api/admin/toggle-voxcpm')
def api_admin_toggle_voxcpm(body: ToggleUserVoxcpmRequest, request: Request):
    require_admin(request)
    res = auth_db.admin_toggle_user_voxcpm(body.userId, body.enabled, body.days)
    return {'success': True, 'data': res}

@app.get('/api/admin/users')
def admin_list_users(request: Request):
    require_admin(request)
    users = auth_db.list_all_users()
    return {'users': users}

@app.post('/api/admin/set-premium')
def admin_set_premium(body: SetPremiumRequest, request: Request):
    require_admin(request)
    try:
        res = auth_db.set_user_premium(body.userId, body.days)
        return {'success': True, 'data': res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post('/api/admin/revoke-premium')
def admin_revoke_premium(body: RevokePremiumRequest, request: Request):
    require_admin(request)
    try:
        res = auth_db.revoke_user_premium(body.userId)
        return {'success': True, 'data': res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post('/api/admin/reset-device')
def admin_reset_device(body: ResetUserDeviceRequest, request: Request):
    require_admin(request)
    auth_db.reset_user_device(body.userId)
    return {'success': True, 'message': 'បានដោះសោរ Device រួចរាល់! User អាច Login លើកុំព្យូទ័រថ្មីបាន'}

@app.post('/api/admin/reset-password')
def admin_reset_password(body: ResetUserPasswordRequest, request: Request):
    require_admin(request)
    if not body.newPassword or len(body.newPassword.strip()) < 4:
        raise HTTPException(status_code=400, detail="ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងហោចណាស់ ៤ តួអក្សរ")
    auth_db.reset_user_password(body.userId, body.newPassword.strip())
    return {'success': True, 'message': 'បានកំណត់ពាក្យសម្ងាត់ថ្មីជោគជ័យ!'}

@app.post('/api/admin/delete-user')
def admin_delete_user(body: DeleteUserRequest, request: Request):
    admin = require_admin(request)
    if body.userId == admin['id']:
        raise HTTPException(status_code=400, detail="មិនអាចលុបគណនី Admin ផ្ទាល់ខ្លួនបានទេ")
    auth_db.delete_user(body.userId)
    return {'success': True}

# --- Subscriptions (KHQR) ----------------------------------------------------
# A brand-new free account gets STUDIO_TRIAL_EXPORTS renders before it must
# subscribe; render_export_video() below is the single place that enforces
# it. Only matters in server (VPS) mode -- a PC install stays unrestricted.
TRIAL_FREE_EXPORTS = int(os.getenv('STUDIO_TRIAL_EXPORTS', '3'))
KHQR_SETTING_KEY = 'subscription_khqr_template'

def _subscription_status(user: Optional[dict]) -> dict:
    if not user:
        return {'plan': 'free', 'isPaid': False, 'trialUsed': 0, 'trialLimit': TRIAL_FREE_EXPORTS,
                'trialRemaining': TRIAL_FREE_EXPORTS, 'expiresAt': None}
    is_paid = user.get('role') == 'admin' or user.get('tier') == 'premium'
    used = int(user.get('trial_exports_used') or 0)
    return {
        'plan': user.get('plan') or ('unlimited' if user.get('role') == 'admin' else 'free'),
        'isPaid': is_paid,
        'trialUsed': used,
        'trialLimit': TRIAL_FREE_EXPORTS,
        'trialRemaining': max(0, TRIAL_FREE_EXPORTS - used),
        'expiresAt': user.get('premium_expires_at'),
    }

@app.get('/api/subscription/plans')
def subscription_plans(request: Request):
    user = get_request_user(request)
    plans = [
        {'id': pid, **{k: v for k, v in spec.items() if k != 'voxcpm'}, 'includesVoxcpm': spec['voxcpm']}
        for pid, spec in auth_db.SUBSCRIPTION_PLANS.items()
    ]
    return {'plans': plans, 'status': _subscription_status(user), 'khqrConfigured': bool(auth_db.get_setting(KHQR_SETTING_KEY))}

@app.post('/api/subscription/create-order')
def create_subscription_order(body: CreateSubscriptionOrderRequest, request: Request):
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលគណនីជាមុនសិន")
    if body.plan not in auth_db.SUBSCRIPTION_PLANS:
        raise HTTPException(status_code=400, detail="គម្រោងនេះមិនត្រឹមត្រូវទេ")

    template = auth_db.get_setting(KHQR_SETTING_KEY)
    if not template:
        raise HTTPException(status_code=503, detail="Server នេះមិនទាន់បានកំណត់ KHQR ទេ — សូមប្រាប់ Admin")

    amount = auth_db.SUBSCRIPTION_PLANS[body.plan]['price_usd']
    ok, result = khqr_service.apply_khqr_template(template, amount)
    if not ok:
        raise HTTPException(status_code=500, detail=f"មិនអាចបង្កើត KHQR បានទេ: {result}")
    qr_payload = result
    qr_md5 = khqr_service.khqr_md5(qr_payload)
    ticket = f"sub_{int(time.time() * 1000)}_{secrets.token_hex(3)}"

    order = auth_db.create_subscription_order(user['id'], user['username'], body.plan, ticket, qr_payload, qr_md5)

    # A QR image the browser can show directly, no client-side QR library needed.
    import qrcode
    import io
    img = qrcode.make(qr_payload, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    qr_image_data_url = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

    return {'success': True, 'order': {**order, 'qrImage': qr_image_data_url}}

@app.get('/api/subscription/order/{ticket}')
def poll_subscription_order(ticket: str, request: Request):
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលគណនីជាមុនសិន")
    order = auth_db.get_subscription_order(ticket)
    if not order or order['user_id'] != user['id']:
        raise HTTPException(status_code=404, detail="រកមិនឃើញការបញ្ជាទិញនេះទេ")

    if order['status'] == 'pending':
        # 10-minute payment window, same as the bot's own KHQR orders.
        try:
            created = datetime.fromisoformat(order['created_at'])
            if datetime.now() - created > timedelta(minutes=10):
                order['status'] = 'expired'
        except Exception:
            pass
        if order['status'] == 'pending':
            bank_hash = bakong_service.check_transaction_by_md5(order['qr_md5'], order['amount_usd'])
            if bank_hash:
                updated = auth_db.mark_order_paid(ticket, bank_hash)
                if updated:
                    order = updated

    # Re-read the user: mark_order_paid() above may have just upgraded their plan.
    fresh_user = get_request_user(request) if order['status'] == 'paid' else user
    return {'order': {k: v for k, v in order.items() if k != 'qr_payload'}, 'status': _subscription_status(fresh_user)}

@app.get('/api/admin/khqr/status')
def admin_khqr_status(request: Request):
    require_admin(request)
    template = auth_db.get_setting(KHQR_SETTING_KEY)
    return {'configured': bool(template), 'preview': (template[:24] + '…') if template else None}

@app.post('/api/admin/khqr/set')
def admin_khqr_set(body: SetKhqrTemplateRequest, request: Request):
    require_admin(request)
    ok, result = khqr_service.validate_khqr_template(body.payload)
    if not ok:
        reasons = {
            'unparseable': "QR នេះអានមិនចេញទេ — សូមចម្លងអក្សរពេញលេញពី App ធនាគារ",
            'bad-checksum': "QR នេះខូច (Checksum មិនត្រូវ) — សូមចម្លងម្ដងទៀតដោយមិនកាត់អក្សរ",
            'no-amount-field': "QR នេះគ្មានចំនួនទឹកប្រាក់ — សូមបង្កើត KHQR ជាមួយចំនួនទឹកប្រាក់ណាមួយជាមុន រួចចម្លង Text មក",
        }
        raise HTTPException(status_code=400, detail=reasons.get(result, "QR មិនត្រឹមត្រូវទេ"))
    auth_db.set_setting(KHQR_SETTING_KEY, result)
    return {'success': True, 'message': 'បានរក្សាទុក KHQR សម្រាប់ទទួលការទូទាត់ Subscription'}

@app.post('/api/admin/subscription/confirm')
def admin_confirm_subscription(body: ConfirmSubscriptionOrderRequest, request: Request):
    """Manual fallback when BAKONG_API_TOKEN isn't set: the admin sees the
    payment land in their own bank app and confirms the order by hand."""
    require_admin(request)
    updated = auth_db.mark_order_paid(body.ticket, 'admin-confirmed')
    if not updated:
        raise HTTPException(status_code=404, detail="ការបញ្ជាទិញនេះគ្មាន ឬបានបញ្ជាក់រួចហើយ")
    return {'success': True, 'order': {k: v for k, v in updated.items() if k != 'qr_payload'}}

# --- Unified Database Statistics & History ---

@app.get('/api/stats/processing-modes')
def get_processing_mode_stats(request: Request):
    """
    Get usage statistics for all 3 processing modes
    (VoxCPM2, Pure Khmer, ElevenLabs)
    """
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលប្រើប្រាស់ជាមុនសិន")
    
    try:
        stats = unified_db.get_mode_stats(user['id'])
        return {
            'success': True,
            'stats': stats,
            'total_jobs': sum(s['usage_count'] for s in stats.values()),
            'total_duration': sum(s['total_duration_seconds'] for s in stats.values())
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/api/history/jobs')
def get_job_history(request: Request, mode: Optional[str] = None, limit: int = 50):
    """
    Get processing job history
    Optionally filter by mode: voxcpm2, pure_khmer, elevenlabs
    """
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលប្រើប្រាស់ជាមុនសិន")
    
    try:
        history = unified_db.get_user_history(user['id'], mode, limit)
        return {
            'success': True,
            'history': history,
            'count': len(history)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/api/library/videos')
def get_video_library(request: Request, group_id: Optional[str] = None):
    """
    Get user's video library (local storage tracking)
    វីដេអូរក្សាទុកក្នុង Computer មិនធ្ងន់ Database
    """
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលប្រើប្រាស់ជាមុនសិន")
    
    try:
        videos = unified_db.get_user_videos(user['id'], group_id)
        return {
            'success': True,
            'videos': videos,
            'count': len(videos)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/api/library/videos/add')
def add_video_to_library(request: Request, body: dict):
    """Add video metadata to library (file stored locally)"""
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលប្រើប្រាស់ជាមុនសិន")
    
    try:
        body['user_id'] = user['id']
        video_id = unified_db.add_video(body)
        return {
            'success': True,
            'video_id': video_id,
            'message': 'បានបន្ថែមវីដេអូទៅកាន់ Library (Local Storage)'
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete('/api/library/videos/{video_id}')
def delete_video_from_library(video_id: int, request: Request):
    """Delete video metadata from library"""
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលប្រើប្រាស់ជាមុនសិន")
    
    try:
        success = unified_db.delete_video(video_id, user['id'])
        if not success:
            raise HTTPException(status_code=404, detail="រកមិនឃើញវីដេអូ")
        return {
            'success': True,
            'message': 'បានលុបវីដេអូជោគជ័យ'
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Voice Management (Admin) ---

@app.get('/api/admin/voices')
def admin_list_voices(request: Request):
    """Get all voices in library (admin only)"""
    require_admin(request)
    
    try:
        # Get from database or fallback to default list
        voices = [
            {'id': 1, 'voice_id': 'voxcpm:hang_phleung_char_2_male.mp3', 'voice_name': 'Hang Phleung Male Lead', 'voice_label': 'ភីកនាយក (ប្រុស)', 'gender': 'male', 'is_premium': 0, 'is_admin_only': 0, 'enabled_for_free': 1},
            {'id': 2, 'voice_id': 'voxcpm:hang_phleung_char_6_female.mp3', 'voice_name': 'Hang Phleung Female Lead', 'voice_label': 'ភីកនាង (ស្រី)', 'gender': 'female', 'is_premium': 0, 'is_admin_only': 0, 'enabled_for_free': 1},
            {'id': 3, 'voice_id': 'voxcpm:kxev_char_01_male.mp3', 'voice_name': 'Professional Male 1', 'voice_label': 'អ្នកនិយាយប្រុស ១', 'gender': 'male', 'is_premium': 0, 'is_admin_only': 0, 'enabled_for_free': 1},
            {'id': 4, 'voice_id': 'voxcpm:kxev_char_02_female.mp3', 'voice_name': 'Professional Female 1', 'voice_label': 'អ្នកនិយាយស្រី ១', 'gender': 'female', 'is_premium': 0, 'is_admin_only': 0, 'enabled_for_free': 1},
            {'id': 5, 'voice_id': 'voxcpm:premium_male_hero.mp3', 'voice_name': 'Premium Male Hero', 'voice_label': 'វីរបុរសប្រុស (VIP)', 'gender': 'male', 'is_premium': 1, 'is_admin_only': 0, 'enabled_for_free': 0},
            {'id': 6, 'voice_id': 'voxcpm:premium_female_heroine.mp3', 'voice_name': 'Premium Female Heroine', 'voice_label': 'វីរនារី (VIP)', 'gender': 'female', 'is_premium': 1, 'is_admin_only': 0, 'enabled_for_free': 0},
            {'id': 7, 'voice_id': 'voxcpm:admin_narrator.mp3', 'voice_name': 'Admin Narrator Voice', 'voice_label': 'អ្នកនិទានរឿង (Admin)', 'gender': 'neutral', 'is_premium': 1, 'is_admin_only': 1, 'enabled_for_free': 0},
        ]
        return {'success': True, 'voices': voices}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/api/admin/voices/toggle')
def admin_toggle_voice_access(request: Request, body: dict):
    """Toggle voice access settings (admin only)"""
    require_admin(request)
    
    voice_id = body.get('voiceId')
    field = body.get('field')
    value = body.get('value')
    
    if not voice_id or not field:
        raise HTTPException(status_code=400, detail="Missing parameters")
    
    # Here you would update the database
    # For now, just return success
    return {'success': True, 'message': f'បាន update {field} ជោគជ័យ'}

@app.post('/api/admin/voices/grant')
def admin_grant_voice_to_user(request: Request, body: dict):
    """Grant voice access to specific user (admin only)"""
    require_admin(request)
    
    user_id = body.get('userId')
    voice_id = body.get('voiceId')
    days = body.get('days', 365)
    
    if not user_id or not voice_id:
        raise HTTPException(status_code=400, detail="Missing parameters")
    
    # Here you would insert into user_voice_permissions table
    # For now, just return success
    return {
        'success': True,
        'message': f'បានផ្តល់សិទ្ធិប្រើសំឡេង {voice_id} អោយ User ID {user_id} រយៈពេល {days} ថ្ងៃ'
    }

@app.get('/api/voices/list')
def get_available_voices(request: Request):
    """Get voices available for current user"""
    user = get_request_user(request)
    
    # Base voices (free for everyone)
    voices = [
        {'id': 'voxcpm:hang_phleung_char_2_male.mp3', 'label': 'ភីកនាយក (ប្រុស)', 'gender': 'male', 'tier': 'free'},
        {'id': 'voxcpm:hang_phleung_char_6_female.mp3', 'label': 'ភីកនាង (ស្រី)', 'gender': 'female', 'tier': 'free'},
        {'id': 'voxcpm:kxev_char_01_male.mp3', 'label': 'អ្នកនិយាយប្រុស ១', 'gender': 'male', 'tier': 'free'},
        {'id': 'voxcpm:kxev_char_02_female.mp3', 'label': 'អ្នកនិយាយស្រី ១', 'gender': 'female', 'tier': 'free'},
        {'id': 'voxcpm:main_lead_male.mp3', 'label': 'សំឡេងប្រុសចម្បង', 'gender': 'male', 'tier': 'free'},
        {'id': 'voxcpm:main_lead_female.mp3', 'label': 'សំឡេងស្រីចម្បង', 'gender': 'female', 'tier': 'free'},
    ]
    
    # Add premium voices for premium users or admins
    if user and (user.get('tier') == 'premium' or user.get('role') == 'admin'):
        voices.extend([
            {'id': 'voxcpm:premium_male_hero.mp3', 'label': 'វីរបុរសប្រុស (VIP)', 'gender': 'male', 'tier': 'premium'},
            {'id': 'voxcpm:premium_female_heroine.mp3', 'label': 'វីរនារី (VIP)', 'gender': 'female', 'tier': 'premium'},
        ])
    
    # Add admin-only voices
    if user and user.get('role') == 'admin':
        voices.append({'id': 'voxcpm:admin_narrator.mp3', 'label': 'អ្នកនិទានរឿង (Admin)', 'gender': 'neutral', 'tier': 'admin'})
    
    return {'success': True, 'voices': voices}

# --- API Endpoints ---

@app.get('/api/config')
def get_config():
    load_dotenv(dotenv_path=env_file_path, override=True)
    eleven_key = os.getenv('ELEVENLABS_API_KEY', '')
    gemini_key = os.getenv('GEMINI_API_KEY', '')
    voxcpm_url = os.getenv('VOXCPM_API_URL', '')
    mode = os.getenv('VOXCPM_MODE', 'local' if voxcpm_url.startswith('http://127.0.0.1') or not voxcpm_url else 'cloud')
    return {
        'hasElevenlabs': bool(eleven_key and not eleven_key.startswith('your_')),
        'hasGemini': bool(gemini_key and not gemini_key.startswith('your_')),
        'geminiModel': os.getenv('GEMINI_MODEL', 'gemini-flash-latest'),
        'hasVoxcpmUrl': bool(voxcpm_url),
        'voxcpmUrl': voxcpm_url,
        'cloudUrl': os.getenv('VOXCPM_CLOUD_URL', voxcpm_url if not voxcpm_url.startswith('http://127.0.0.1') else ''),
        'mode': mode,
        'port': int(os.getenv('PORT', 3000))
    }

@app.get('/api/voxcpm/local-check')
def check_local_voxcpm():
    import requests
    local_url = "http://127.0.0.1:8000"
    try:
        r = requests.get(f"{local_url}/", timeout=1.5)
        if r.status_code == 200:
            data = r.json()
            return {
                'online': True,
                'url': local_url,
                'device': data.get('device', 'cpu'),
                'gpuName': data.get('gpuName', 'Local PC'),
                'modelReady': data.get('modelLoaded', False) or data.get('status') == 'ok',
                'message': 'ម៉ាស៊ីន Local PC (Port 8000) កំពុងដំណើរការល្អ'
            }
    except Exception:
        pass
    return {
        'online': False,
        'url': local_url,
        'message': 'មិនទាន់បើក Local VoxCPM2 Server នៅឡើយទេ (ចុចបើក START_LOCAL_VOXCPM.bat)'
    }

def set_env_vars(updates: dict):
    env_path = os.path.join(BASE_DIR, '.env')
    lines = []
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

    for k, v in updates.items():
        if v is not None:
            os.environ[k] = str(v)
            found = False
            for i, line in enumerate(lines):
                if line.strip().startswith(f"{k}="):
                    lines[i] = f"{k}={v}\n"
                    found = True
                    break
            if not found:
                lines.append(f"{k}={v}\n")

    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)

local_engine_proc = None

def ensure_local_voxcpm_running():
    global local_engine_proc
    import requests, subprocess
    try:
        r = requests.get('http://127.0.0.1:8000/', timeout=1.0)
        if r.status_code == 200:
            return True
    except Exception:
        pass

    py_exe = os.path.join(BASE_DIR, '.venv', 'Scripts', 'python.exe')
    if not os.path.exists(py_exe):
        py_exe = sys.executable

    script_path = os.path.join(BASE_DIR, 'local_voxcpm_server.py')
    env = os.environ.copy()
    env['FORCE_CPU'] = '1'

    try:
        local_engine_proc = subprocess.Popen(
            [py_exe, script_path, '--cpu'],
            cwd=BASE_DIR,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        print("🚀 [VoxCPM2] Launched local CPU VoxCPM engine on port 8000")
        return True
    except Exception as err:
        print(f"⚠️ Failed to auto-start local VoxCPM engine: {err}")
        return False

@app.post('/api/voxcpm/start-local')
def start_local_voxcpm(request: Request):
    user = get_request_user(request)
    if not user or (user.get('role') != 'admin' and not user.get('has_voxcpm_license')):
        raise HTTPException(
            status_code=403,
            detail="គណនីធម្មតាមិនមានសិទ្ធិប្រើប្រាស់ VoxCPM2 ឡើយ។ ទាល់តែដាក់ Key License ពី Admin ទើបប្រើបាន!"
        )
    started = ensure_local_voxcpm_running()
    return {'success': started, 'message': 'Local VoxCPM2 Engine បានបើកដំណើរការ (Port 8000)'}

@app.post('/api/voxcpm/switch-mode')
def switch_voxcpm_mode(body: SwitchModeRequest, request: Request):
    user = get_request_user(request)
    if body.mode in ['cloud', 'local']:
        if not user or (user.get('role') != 'admin' and not user.get('has_voxcpm_license')):
            raise HTTPException(
                status_code=403,
                detail="គណនីធម្មតាមិនមានសិទ្ធិប្រើប្រាស់ VoxCPM2 ឡើយ។ ទាល់តែដាក់ Key License ពី Admin ទើបប្រើបាន!"
            )

    current_cloud = os.getenv('VOXCPM_CLOUD_URL') or ''
    if os.getenv('VOXCPM_API_URL') and not os.getenv('VOXCPM_API_URL').startswith('http://127.0.0.1') and not os.getenv('VOXCPM_API_URL').startswith('http://localhost'):
        current_cloud = os.getenv('VOXCPM_API_URL')
    if body.cloudUrl:
        current_cloud = body.cloudUrl.strip()

    updates = {
        'VOXCPM_CLOUD_URL': current_cloud,
        'VOXCPM_MODE': body.mode
    }
    if body.mode == 'local':
        updates['VOXCPM_API_URL'] = "http://127.0.0.1:8000"
        ensure_local_voxcpm_running()
    elif body.mode == 'cloud':
        updates['VOXCPM_API_URL'] = current_cloud
    elif body.mode == 'pure_khmer':
        updates['VOXCPM_API_URL'] = ''
    elif body.mode == 'elevenlabs':
        updates['VOXCPM_API_URL'] = ''

    set_env_vars(updates)

    return {
        'success': True,
        'mode': os.getenv('VOXCPM_MODE'),
        'activeUrl': os.getenv('VOXCPM_API_URL', ''),
        'cloudUrl': current_cloud
    }

@app.get('/api/voxcpm/status')
def get_voxcpm_status():
    url = os.getenv('VOXCPM_API_URL', '')
    mode = os.getenv('VOXCPM_MODE', 'local' if url.startswith('http://127.0.0.1') or not url else 'cloud')

    if mode == 'elevenlabs':
        info = elevenlabs_service.get_user_info()
        configured = elevenlabs_service.is_configured()
        return {
            'online': configured and not bool(info.get('error')),
            'configured': configured,
            'mode': 'elevenlabs',
            'isLocal': False,
            'device': 'ElevenLabs Cloud AI',
            'gpuName': 'Zero-GPU Cloud Voice Clone',
            'quota': info,
            'message': f"ElevenLabs Cloud AI (Tier: {info.get('tier', 'Free')}, {info.get('remaining', 0)} chars remaining)"
        }

    if mode == 'pure_khmer' or not url or not url.strip():
        return {
            'online': True,
            'configured': True,
            'mode': 'pure_khmer',
            'isLocal': True,
            'message': '100% Pure Khmer Neural Engine (Offline & Fast)'
        }


    clean_url = url.strip()
    if clean_url.startswith('http') and '.' not in clean_url and not clean_url.startswith('http://127.0.0.1') and not clean_url.startswith('http://localhost'):
        clean_url = clean_url.rstrip('/') + '.trycloudflare.com'

    import requests
    try:
        timeout = 1.5 if clean_url.startswith('http://127.0.0.1') or clean_url.startswith('http://localhost') else 7.0
        r = requests.get(clean_url, timeout=timeout)
        if r.status_code == 200:
            is_local = clean_url.startswith('http://127.0.0.1') or clean_url.startswith('http://localhost')
            return {
                'online': True,
                'configured': True,
                'url': clean_url,
                'isLocal': is_local,
                'mode': 'local' if is_local else 'cloud',
                'message': 'Local PC Server កំពុងដំណើរការ (200 OK)' if is_local else 'GPU Cloud Server កំពុងដំណើរការល្អ (200 OK)'
            }
        return {'online': False, 'configured': True, 'url': clean_url, 'mode': mode, 'message': f'ឆ្លើយតបកូដ HTTP {r.status_code}'}
    except Exception as e:
        is_local = clean_url.startswith('http://127.0.0.1') or clean_url.startswith('http://localhost')
        err_str = str(e)
        if is_local:
            msg = 'មិនទាន់បើក START_LOCAL_VOXCPM.bat លើកុំព្យូទ័រ'
        elif 'timed out' in err_str.lower():
            msg = 'Colab / Kaggle កំពុងរវល់ខ្លាំង ឬកំពុងដំណើរការ (Busy Processing) — បណ្តាញនៅភ្ជាប់ធម្មតា'
        else:
            msg = f'មិនទាន់ភ្ជាប់ទៅ Cloud Server ({err_str})'
        return {'online': False, 'configured': True, 'url': clean_url, 'isLocal': is_local, 'mode': mode, 'message': msg}

@app.post('/api/config')
def update_config(body: ConfigUpdate):
    updates = {}
    if body.elevenlabsKey is not None:
        val = body.elevenlabsKey.strip()
        if val:
            updates['ELEVENLABS_API_KEY'] = val
        elif body.elevenlabsKey == '__CLEAR__':
            updates['ELEVENLABS_API_KEY'] = ''

    if body.geminiKey is not None:
        from services import gemini_client
        val = gemini_client.clean_key(body.geminiKey) if body.geminiKey != '__CLEAR__' else ''
        if val:
            updates['GEMINI_API_KEY'] = val
        elif body.geminiKey == '__CLEAR__':
            updates['GEMINI_API_KEY'] = ''

    if body.geminiModel is not None:
        val = body.geminiModel.strip()
        if val:
            updates['GEMINI_MODEL'] = val

    if body.voxcpmUrl is not None:
        val = body.voxcpmUrl.strip()
        # Colab prints the link inside a sentence; keep only the URL itself
        m = re.search(r"https?://[a-zA-Z0-9-]+\.trycloudflare\.com", val) or re.search(r"https?://[^\s'\"<>]+", val)
        if m:
            val = m.group(0)
        val = val.rstrip('/')
        if val and not val.startswith('http'):
            val = 'https://' + val
        if val.startswith('http') and '.' not in val and not val.startswith('http://127.0.0.1') and not val.startswith('http://localhost'):
            val = val + '.trycloudflare.com'
        updates['VOXCPM_API_URL'] = val
        if val:
            # A saved URL must also take the engine out of offline mode, or it is silently ignored
            is_local = val.startswith('http://127.0.0.1') or val.startswith('http://localhost')
            updates['VOXCPM_MODE'] = 'local' if is_local else 'cloud'
            if not is_local:
                updates['VOXCPM_CLOUD_URL'] = val

    set_env_vars(updates)
    return {'success': True, 'message': 'API keys & configurations saved'}

@app.get('/api/elevenlabs/status')
def get_elevenlabs_status():
    return {
        'configured': elevenlabs_service.is_configured(),
        'info': elevenlabs_service.get_user_info()
    }

@app.get('/api/elevenlabs/voices')
def get_elevenlabs_voices():
    voices = elevenlabs_service.list_voices()
    return {
        'success': True,
        'count': len(voices),
        'voices': voices
    }

class ElevenCloneRequest(BaseModel):
    voiceName: str
    sampleFilename: str

@app.post('/api/elevenlabs/clone')
def clone_eleven_voice(body: ElevenCloneRequest):
    if not elevenlabs_service.is_configured():
        raise HTTPException(status_code=400, detail="សូមកំណត់ ELEVENLABS_API_KEY ក្នុង Settings ជាមុនសិន")

    cand = os.path.join(SAMPLES_DIR, os.path.basename(body.sampleFilename))
    if not os.path.exists(cand):
        cand = os.path.join(UPLOADS_DIR, os.path.basename(body.sampleFilename))
    if not os.path.exists(cand):
        raise HTTPException(status_code=404, detail="រកមិនឃើញឯកសារគំរូសំឡេងឡើយ")

    voice_id = elevenlabs_service.clone_voice(body.voiceName, cand)
    if not voice_id:
        raise HTTPException(status_code=500, detail="បរាជ័យក្នុងការ Clone សំឡេងជាមួយ ElevenLabs (អាចអស់ Quota ឬបញ្ហា Network)")
    return {'success': True, 'voiceId': voice_id, 'voiceName': body.voiceName}

@app.post('/api/upload')

async def upload_file(mediaFile: UploadFile = File(...)):
    dest_filename = f"mediaFile-{int(time.time() * 1000)}-{mediaFile.filename}"
    dest_path = os.path.join(UPLOADS_DIR, dest_filename)

    with open(dest_path, 'wb') as f:
        shutil.copyfileobj(mediaFile.file, f, length=1024 * 1024)

    file_size = os.path.getsize(dest_path)
    file_type = 'video' if any(dest_filename.lower().endswith(ext) for ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']) else 'audio'
    file_url = f"/media/uploads/{dest_filename}"

    file_info = {
        'filename': dest_filename,
        'originalName': mediaFile.filename,
        'size': file_size,
        'type': file_type,
        'url': file_url
    }

    return {
        'success': True,
        'file': file_info,
        'filename': dest_filename,
        'originalName': mediaFile.filename,
        'size': file_size,
        'type': file_type,
        'url': file_url
    }

@app.post('/api/video/download')
async def download_online_video(body: DownloadVideoRequest):
    if not body.url or not body.url.strip():
        raise HTTPException(status_code=400, detail="សូមបញ្ចូល URL វីដេអូ YouTube, Facebook ឬ TikTok")

    url = body.url.strip()
    try:
        import yt_dlp
    except ImportError:
        raise HTTPException(status_code=500, detail="ម៉ូឌុល yt-dlp មិនទាន់ត្រូវបានតំឡើងនៅលើប្រព័ន្ធទេ")

    ts = int(time.time() * 1000)
    out_template = os.path.join(UPLOADS_DIR, f"yt_dlp_{ts}_%(title).40s.%(ext)s")

    ydl_opts = {
        'outtmpl': out_template,
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'merge_output_format': 'mp4',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
    }

    try:
        loop = asyncio.get_event_loop()
        def _exec_download():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                target = ydl.prepare_filename(info)
                base, _ = os.path.splitext(target)
                mp4_target = base + '.mp4'
                if os.path.exists(mp4_target):
                    target = mp4_target
                return info, target

        info, downloaded_file = await loop.run_in_executor(None, _exec_download)

        if not os.path.exists(downloaded_file):
            raise HTTPException(status_code=500, detail="ទាញយកវីដេអូមិនបានសម្រេច (File not created)")

        filename = os.path.basename(downloaded_file)
        file_size = os.path.getsize(downloaded_file)
        title = info.get('title') or filename
        duration = info.get('duration') or 0
        thumbnail = info.get('thumbnail') or None

        return {
            'success': True,
            'filename': filename,
            'originalName': title,
            'size': file_size,
            'type': 'video',
            'url': f"/media/uploads/{filename}",
            'duration': duration,
            'thumbnail': thumbnail,
            'message': f"បានទាញយកវីដេអូ '{title}' ដោយជោគជ័យ!"
        }
    except Exception as e:
        err_msg = str(e)
        if "is not a valid URL" in err_msg:
            err_msg = "URL វីដេអូមិនត្រឹមត្រូវ សូមពិនិត្យមើលម្ដងទៀត"
        raise HTTPException(status_code=400, detail=f"កំហុសក្នុងការទាញយក: {err_msg}")

@app.get('/api/files')
def get_files():
    results = []
    if os.path.exists(UPLOADS_DIR):
        for f in os.listdir(UPLOADS_DIR):
            p = os.path.join(UPLOADS_DIR, f)
            if os.path.isfile(p):
                stat = os.stat(p)
                results.append({
                    'filename': f,
                    'size': stat.st_size,
                    'type': 'video' if any(f.lower().endswith(ext) for ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']) else 'audio',
                    'created': stat.st_mtime,
                    'url': f"/media/uploads/{f}"
                })
    results.sort(key=lambda x: x['created'], reverse=True)
    return results

def format_bytes(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

@app.get('/api/outputs/stats')
def get_outputs_stats():
    count = 0
    total_bytes = 0
    if os.path.exists(OUTPUTS_DIR):
        for f in os.listdir(OUTPUTS_DIR):
            if f == '.gitkeep': continue
            p = os.path.join(OUTPUTS_DIR, f)
            if os.path.isfile(p):
                count += 1
                total_bytes += os.path.getsize(p)
    return {
        'count': count,
        'totalBytes': total_bytes,
        'formattedSize': format_bytes(total_bytes)
    }

@app.post('/api/outputs/clear')
def clear_outputs():
    deleted_count = 0
    freed_bytes = 0
    if os.path.exists(OUTPUTS_DIR):
        for f in os.listdir(OUTPUTS_DIR):
            if f == '.gitkeep': continue
            p = os.path.join(OUTPUTS_DIR, f)
            try:
                if os.path.isfile(p):
                    sz = os.path.getsize(p)
                    os.unlink(p)
                    deleted_count += 1
                    freed_bytes += sz
                elif os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
            except Exception as e:
                print(f"Error clearing output {f}: {e}")
    return {
        'success': True,
        'count': deleted_count,
        'freedBytes': freed_bytes,
        'formattedFreed': format_bytes(freed_bytes),
        'message': f"បានលុបឯកសារ Output សរុប {deleted_count} ឯកសារ (សន្សំទំហំបាន {format_bytes(freed_bytes)})"
    }

@app.delete('/api/files/{filename:path}')
def delete_file(filename: str):
    p = os.path.join(UPLOADS_DIR, os.path.basename(filename))
    if not os.path.exists(p):
        # check without basename if it was a direct match
        cand = os.path.join(UPLOADS_DIR, filename)
        if os.path.exists(cand):
            p = cand
        else:
            raise HTTPException(status_code=404, detail="រកមិនឃើញឯកសារគម្រោងឡើយ")
    try:
        os.unlink(p)
        return {'success': True, 'message': f"បានលុបគម្រោង '{filename}' ដោយជោគជ័យ"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"បរាជ័យក្នុងការលុបឯកសារ: {str(e)}")

@app.post('/api/files/clear')
def clear_all_files():
    deleted_count = 0
    freed_bytes = 0
    if os.path.exists(UPLOADS_DIR):
        for f in os.listdir(UPLOADS_DIR):
            if f == '.gitkeep': continue
            p = os.path.join(UPLOADS_DIR, f)
            try:
                if os.path.isfile(p):
                    sz = os.path.getsize(p)
                    os.unlink(p)
                    deleted_count += 1
                    freed_bytes += sz
                elif os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
            except Exception as e:
                print(f"Error clearing upload file {f}: {e}")
    return {
        'success': True,
        'count': deleted_count,
        'freedBytes': freed_bytes,
        'formattedFreed': format_bytes(freed_bytes),
        'message': f"បានលុបគម្រោងចោលសរុប {deleted_count} គម្រោង (សន្សំទំហំបាន {format_bytes(freed_bytes)})"
    }

def resolve_uploaded_file(filename: str):
    """Robustly resolve video filename to real disk path in UPLOADS_DIR, matching timestamps/prefixes."""
    if not filename:
        return None, ""
    clean = os.path.basename(filename).strip()
    # 1. Direct path in uploads
    p = os.path.join(UPLOADS_DIR, clean)
    if os.path.exists(p):
        return p, clean
    # 2. Direct path in base dir
    p = os.path.join(BASE_DIR, clean)
    if os.path.exists(p):
        return p, clean
    # 3. Match candidate files in UPLOADS_DIR (e.g. mediaFile-*-ep1.mp4 for ep1.mp4)
    if os.path.exists(UPLOADS_DIR):
        files = os.listdir(UPLOADS_DIR)
        candidates = [f for f in files if f == clean or f.endswith(f"-{clean}") or clean in f]
        if candidates:
            candidates.sort(key=lambda x: os.path.getmtime(os.path.join(UPLOADS_DIR, x)), reverse=True)
            return os.path.join(UPLOADS_DIR, candidates[0]), candidates[0]
        # 4. Fallback: newest video in UPLOADS_DIR
        all_vids = [f for f in files if f.lower().endswith(('.mp4', '.mkv', '.mov', '.avi', '.webm'))]
        if all_vids:
            all_vids.sort(key=lambda x: os.path.getmtime(os.path.join(UPLOADS_DIR, x)), reverse=True)
            return os.path.join(UPLOADS_DIR, all_vids[0]), all_vids[0]
    return None, clean

def _waveform_cache_path(audio_path: str, buckets: int) -> str:
    stem = os.path.splitext(os.path.basename(audio_path))[0]
    return os.path.join(OUTPUTS_DIR, f"{stem}_peaks{buckets}.json")

def compute_waveform_peaks(audio_path: str, buckets: int = 300):
    """Coarse amplitude envelope of a whole audio file, for drawing a waveform client-side
    without decoding the real (possibly very long) file in the browser. Cached to disk."""
    cache_path = _waveform_cache_path(audio_path, buckets)
    if os.path.exists(cache_path) and os.path.getmtime(cache_path) >= os.path.getmtime(audio_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                cached = json.load(f)
            return cached['peaks'], cached['duration']
        except Exception:
            pass

    import subprocess
    import numpy as np
    sr = 4000  # plenty for a peak envelope; keeps decode + memory tiny even for a 2h file
    proc = subprocess.run(
        ['ffmpeg', '-nostdin', '-v', 'error', '-i', audio_path, '-ac', '1', '-ar', str(sr), '-f', 's16le', '-'],
        stdout=subprocess.PIPE, timeout=120,
    )
    data = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if len(data) == 0:
        return [], 0.0
    duration = len(data) / sr
    n = max(1, min(buckets, len(data)))
    chunk = max(1, len(data) // n)
    trimmed = data[: chunk * n]
    peaks_arr = np.max(np.abs(trimmed.reshape(n, chunk)), axis=1)
    top = float(peaks_arr.max()) or 1.0
    peaks = (peaks_arr / top).round(3).tolist()

    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump({'peaks': peaks, 'duration': round(duration, 2)}, f)
    except Exception:
        pass
    return peaks, round(duration, 2)

@app.get('/api/audio/waveform')
async def audio_waveform(filename: str, buckets: int = 300):
    """Coarse waveform of the session's original soundtrack, for the Session timeline."""
    input_path, real_filename = resolve_uploaded_file(filename)
    if not input_path or not os.path.exists(input_path):
        raise HTTPException(status_code=404, detail="File not found")

    audio_ext = os.path.splitext(real_filename)[0] + '.mp3'
    extracted_audio = os.path.join(OUTPUTS_DIR, f"audio_{audio_ext}")
    if not os.path.exists(extracted_audio):
        await asyncio.to_thread(audio_processor.extract_audio, input_path, extracted_audio)

    buckets = max(50, min(2000, buckets))
    peaks, duration = await asyncio.to_thread(compute_waveform_peaks, extracted_audio, buckets)
    return {'success': True, 'peaks': peaks, 'duration': duration}

class SeparateRequest(BaseModel):
    filename: str
    preferAi: Optional[bool] = True

@app.post('/api/audio/separate')
async def separate_audio_track(body: SeparateRequest):
    input_path, real_filename = resolve_uploaded_file(body.filename)
    if not input_path or not os.path.exists(input_path):
        raise HTTPException(status_code=404, detail="File not found")
    body.filename = real_filename

    audio_ext = os.path.splitext(body.filename)[0] + '.mp3'
    extracted_audio = os.path.join(OUTPUTS_DIR, f"audio_{audio_ext}")
    if not os.path.exists(extracted_audio):
        await asyncio.to_thread(audio_processor.extract_audio, input_path, extracted_audio)

    from services import vocal_separator
    # Reuse an earlier split of this video (the final mix looks for the same files)
    stem = os.path.splitext(os.path.basename(extracted_audio))[0]
    cached = None
    for engine, tag in (('meta-demucs-ai', 'ai'), ('ffmpeg-dsp', vocal_separator.DSP_VERSION)):
        v = os.path.join(OUTPUTS_DIR, f"{stem}_{tag}_vocals.wav")
        b = os.path.join(OUTPUTS_DIR, f"{stem}_{tag}_bgm.wav")
        if os.path.exists(v) and os.path.exists(b) and (engine == 'meta-demucs-ai' or not (body.preferAi and vocal_separator.has_demucs())):
            cached = {'engine': engine, 'vocalsPath': v, 'bgmPath': b}
            break
    # Demucs takes minutes on a CPU — keep the server responsive meanwhile
    result = cached or await asyncio.to_thread(vocal_separator.separate_vocals_and_bgm, extracted_audio, OUTPUTS_DIR, body.preferAi)
    return {
        'success': True,
        'engine': result['engine'],
        'vocalsUrl': f"/media/outputs/{os.path.basename(result['vocalsPath'])}",
        'bgmUrl': f"/media/outputs/{os.path.basename(result['bgmPath'])}"
    }

@app.post('/api/dubbing/start')
async def start_dubbing(body: DubbingStartRequest, background_tasks: BackgroundTasks, request: Request):
    user = get_request_user(request)
    is_free = not user or (user.get('tier') != 'premium' and user.get('role') != 'admin')
    if is_free:
        # Free account: strictly locked to offline pure_khmer and default voice
        body.voiceId = 'voxcpm-voice-actor'
        os.environ['VOXCPM_MODE'] = 'pure_khmer'
        os.environ['VOXCPM_API_URL'] = ''

    input_path, real_filename = resolve_uploaded_file(body.filename)
    if not input_path or not os.path.exists(input_path):
        raise HTTPException(status_code=404, detail="Uploaded file not found")
    body.filename = real_filename

    job_id = f"job_{int(time.time() * 1000)}"
    
    # Determine processing mode
    voxcpm_mode = os.getenv('VOXCPM_MODE', 'pure_khmer')
    processing_mode = 'pure_khmer'  # Default
    if body.voiceId and body.voiceId.startswith('voxcpm:'):
        processing_mode = 'voxcpm2'
    elif voxcpm_mode == 'elevenlabs':
        processing_mode = 'elevenlabs'
    elif voxcpm_mode == 'cloud' or voxcpm_mode == 'local':
        processing_mode = 'voxcpm2'
    
    job = {
        'id': job_id,
        'filename': body.filename,
        'status': 'extracting',
        'progress': 10,
        'message': 'កំពុងទាញយកសម្លេងពីវីដេអូដើម...',
        'sourceLang': body.sourceLang,
        'targetLang': body.targetLang,
        'scope': body.scope,
        'created': time.time()
    }
    active_jobs[job_id] = job
    
    # Save to unified database
    try:
        unified_db.create_job({
            'id': job_id,
            'user_id': user.get('id') if user else None,
            'video_filename': body.filename,
            'job_type': 'dubbing',
            'processing_mode': processing_mode,
            'status': 'extracting',
            'progress': 10,
            'message': job['message'],
            'params': {
                'sourceLang': body.sourceLang,
                'targetLang': body.targetLang,
                'voiceId': body.voiceId,
                'scope': body.scope
            }
        })
    except Exception as e:
        logger.warning(f"Failed to save job to unified DB: {e}")

    async def run_pipeline():
        # Create detailed progress tracker
        tracker = create_tracker(job_id, OperationType.DUBBING)
        
        # Define pipeline steps
        tracker.add_step("extract_audio", "កំពុងទាញយកសម្លេងពីវីដេអូដើម...", weight=0.1)
        tracker.add_step("analyze_dialogue", "AI កំពុងវិភាគ និងស្រង់តួអង្គ...", weight=0.2)
        tracker.add_step("translate", "កំពុងបកប្រែជាភាសាខ្មែរ...", weight=0.2)
        tracker.add_step("generate_voices", "កំពុងបង្កើតសម្លេងខ្មែរ...", weight=0.3)
        tracker.add_step("render_video", "កំពុងបញ្ចូលសម្លេងទៅក្នុងវីដេអូ...", weight=0.2)
        
        # Register progress broadcast callback
        tracker.add_callback(lambda jid, data: broadcast_progress(jid, {
            'id': jid,
            'status': data['status'],
            'progress': data['overall_progress'],
            'message': data.get('steps', [{}])[data.get('current_step', 0) if isinstance(data.get('current_step'), int) else 0].get('description', ''),
            'detail': data
        }))
        
        try:
            audio_ext = os.path.splitext(body.filename)[0] + '.mp3'
            extracted_audio_path = os.path.join(OUTPUTS_DIR, f"audio_{audio_ext}")
            
            # Step 1: Extract audio
            tracker.start_step(0)
            job['progress'] = 5
            job['status'] = 'extracting'
            broadcast_progress(job_id, job.copy())
            
            # Run extract_audio in separate thread
            await asyncio.to_thread(
                audio_processor.extract_audio,
                input_path,
                extracted_audio_path
            )
            tracker.complete_step(0)
            
            job['progress'] = 10
            broadcast_progress(job_id, job.copy())

            if body.targetLang == 'km':
                job['progress'] = 15
                job['status'] = 'dubbing_khmer'
                job['message'] = 'AI Gemini កំពុងវិភាគ និងស្រង់តួអង្គគ្រប់តួក្នុងសាច់រឿង...'
                broadcast_progress(job_id, job.copy())

                def on_prog(p, msg):
                    job['progress'] = p
                    job['message'] = msg
                    broadcast_progress(job_id, job.copy())

                result = await khmer_dubber.process_khmer_dubbing(
                    input_path,
                    extracted_audio_path,
                    OUTPUTS_DIR,
                    {
                        'sourceLang': body.sourceLang,
                        'voiceId': body.voiceId,
                        'scope': body.scope,
                        'castingSafetyMode': body.castingSafetyMode,
                        'characterVoiceMap': body.characterVoiceMap,
                        'maleLeadVoice': body.maleLeadVoice,
                        'femaleLeadVoice': body.femaleLeadVoice,
                        'geminiModel': body.geminiModel
                    },
                    on_progress=on_prog
                )

                job['status'] = 'completed'
                job['progress'] = 100
                job['message'] = 'ការ Dubbing គ្រប់តួអង្គក្នុងសាច់រឿងទទួលបានជោគជ័យ 100%!'
                job['outputVideo'] = f"/media/outputs/{result['outputVideoFilename']}"
                job['outputAudio'] = f"/media/outputs/{os.path.basename(result['dubbedAudioPath'])}"
                job['khmerScript'] = result['khmerScript']
                job['dialogueSegments'] = result['dialogueSegments']
                broadcast_progress(job_id, job.copy())
                
                # Update unified database
                try:
                    unified_db.update_job(job_id, {
                        'status': 'completed',
                        'progress': 100,
                        'message': job['message'],
                        'result': json.dumps({
                            'outputVideo': job['outputVideo'],
                            'outputAudio': job['outputAudio']
                        })
                    })
                    
                    # Add to history
                    unified_db.add_history({
                        'user_id': user.get('id') if user else None,
                        'job_id': job_id,
                        'processing_mode': processing_mode,
                        'video_filename': body.filename,
                        'success': 1,
                        'duration_seconds': time.time() - job['created'],
                        'output_files': [job['outputVideo'], job['outputAudio']]
                    })
                except Exception as e:
                    logger.warning(f"Failed to update job in unified DB: {e}")
            else:
                job['status'] = 'completed'
                job['progress'] = 100
                job['message'] = 'Dubbing complete'
                broadcast_progress(job_id, job.copy())
        except Exception as e:
            import traceback
            traceback.print_exc()
            err_raw = str(e)
            user_friendly_error = err_raw
            if "does not contain any stream" in err_raw:
                user_friendly_error = "វីដេអូនេះគ្មានខ្សែសំឡេង (Audio Stream) ឡើយ! ប្រព័ន្ធបានជួសជុលដោយស្វ័យប្រវត្តិកំណត់ជា Silent Audio រួចរាល់ សូមចុចដំណើរការម្តងទៀត។"
            elif "CUDA out of memory" in err_raw:
                user_friendly_error = "GPU VRAM មិនគ្រប់គ្រាន់ឡើយ សូមប្ដូរទៅប្រើ CPU ឬ Cloud GPU Mode។"
            elif "No such file or directory" in err_raw:
                user_friendly_error = "រកមិនឃើញឯកសារវីដេអូដើម ឬ Folder ឡើយ។ សូម Upload វីដេអូឡើងវិញ។"

            job['status'] = 'failed'
            job['error'] = user_friendly_error
            job['message'] = f"កំហុសក្នុងការ dubbing: {user_friendly_error}"
            broadcast_progress(job_id, job.copy())
            
            # Update unified database
            try:
                unified_db.update_job(job_id, {
                    'status': 'failed',
                    'error': str(e),
                    'message': job['message']
                })
                
                # Add to history as failed
                unified_db.add_history({
                    'user_id': user.get('id') if user else None,
                    'job_id': job_id,
                    'processing_mode': processing_mode,
                    'video_filename': body.filename,
                    'success': 0,
                    'duration_seconds': time.time() - job['created'],
                    'output_files': []
                })
            except Exception as db_err:
                logger.warning(f"Failed to update failed job in unified DB: {db_err}")

    background_tasks.add_task(run_pipeline)
    return {'success': True, 'jobId': job_id}

@app.get('/api/dubbing/status/{job_id}')
def get_dubbing_status(job_id: str):
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return active_jobs[job_id]

# Real-time Progress Tracking with SSE
@app.get('/api/progress/stream/{job_id}')
async def stream_progress(job_id: str, request: Request):
    """
    Server-Sent Events (SSE) endpoint for real-time progress updates
    អោយឃើញ % Process ផ្ទាល់ក្នុង Tool
    """
    async def event_generator():
        # Create async queue for this client
        client_queue = asyncio.Queue()
        if job_id not in progress_subscribers:
            progress_subscribers[job_id] = []
        progress_subscribers[job_id].append(client_queue)
        
        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                
                # Get progress update from queue (async with timeout)
                try:
                    progress_data = await asyncio.wait_for(client_queue.get(), timeout=1.0)
                    yield f"data: {json.dumps(progress_data)}\n\n"
                    
                    # If job completed or failed, stop streaming
                    if progress_data.get('status') in ['completed', 'failed']:
                        break
                except asyncio.TimeoutError:
                    # Send heartbeat to keep connection alive
                    if job_id in active_jobs:
                        yield f"data: {json.dumps(active_jobs[job_id])}\n\n"
                    else:
                        yield f"data: {json.dumps({'status': 'not_found'})}\n\n"
                        break
                
                await asyncio.sleep(0.5)
        finally:
            # Cleanup: remove client queue when done
            if job_id in progress_subscribers:
                if client_queue in progress_subscribers[job_id]:
                    progress_subscribers[job_id].remove(client_queue)
                if not progress_subscribers[job_id]:
                    del progress_subscribers[job_id]
    
    return StreamingResponse(
        event_generator(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )

def broadcast_progress(job_id: str, progress_data: dict):
    """Broadcast progress update to all SSE subscribers"""
    if job_id in progress_subscribers:
        for client_queue in progress_subscribers[job_id]:
            try:
                client_queue.put_nowait(progress_data)
            except:
                pass
    
    # Also update active_jobs for backward compatibility
    if job_id in active_jobs:
        active_jobs[job_id].update(progress_data)

@app.post('/api/dubbing/scan-timeline')
async def scan_timeline(body: ScanTimelineRequest):
    input_path = os.path.join(UPLOADS_DIR, body.filename)
    if not os.path.exists(input_path):
        root_path = os.path.join(BASE_DIR, body.filename)
        if os.path.exists(root_path): input_path = root_path
    if not os.path.exists(input_path):
        # Auto-fallback to available uploads if previous file was deleted
        cand_files = [f for f in os.listdir(UPLOADS_DIR) if f != '.gitkeep' and not f.startswith('.')]
        if cand_files:
            input_path = os.path.join(UPLOADS_DIR, cand_files[0])
        else:
            raise HTTPException(status_code=404, detail="រកមិនឃើញឯកសារវីដេអូឡើយ (អាចត្រូវបានលុបចោល)។ សូម Upload វីដេអូជាមុនសិន")

    audio_ext = os.path.splitext(body.filename)[0] + '.mp3'
    extracted_audio_path = os.path.join(OUTPUTS_DIR, f"audio_{audio_ext}")
    if not os.path.exists(extracted_audio_path):
        audio_processor.extract_audio(input_path, extracted_audio_path)

    duration = audio_processor.get_media_duration(input_path)
    segments = await khmer_dubber.extract_dialogue_timeline(extracted_audio_path, duration, body.scope)

    movie_voice_map = {}
    try:
        movie_voice_map = await khmer_dubber.extract_character_voice_samples(extracted_audio_path, segments, OUTPUTS_DIR)
    except Exception as ve:
        print(f"Movie voice sample extraction notice: {ve}")

    # 1-to-1 Unique Voice Assignment for each character (Zero Duplicate Voices, Auto Movie Clone fallback)
    char_map = khmer_dubber.assign_unique_voices_to_segments(
        segments,
        movie_voice_map=movie_voice_map,
        voice_mode=body.voiceMode or 'voice_actor_clone'
    )

    formatted = []
    for idx, s in enumerate(segments):
        sid = s.get('speaker_id') or s.get('speaker_name') or 'speaker_1'
        assigned = char_map.get(sid, {})
        
        # 🎭 Auto-detect emotion from original audio segment (if enabled)
        emotion_data = {}
        try:
            # Extract segment audio for emotion detection
            segment_start = s.get('start_time', 0)
            segment_end = s.get('end_time', segment_start + 2)
            segment_audio_path = os.path.join(OUTPUTS_DIR, f"temp_segment_{idx}_{int(time.time() * 1000)}.wav")
            
            # Extract segment using ffmpeg
            import subprocess
            subprocess.run([
                'ffmpeg', '-y', '-i', extracted_audio_path,
                '-ss', str(segment_start),
                '-to', str(segment_end),
                '-acodec', 'pcm_s16le',
                segment_audio_path
            ], capture_output=True, check=True)
            
            # Detect emotion
            if os.path.exists(segment_audio_path):
                import librosa
                import numpy as np
                
                y, sr = librosa.load(segment_audio_path, sr=None)
                
                # Extract features
                rms = librosa.feature.rms(y=y)[0]
                volume = float(np.mean(rms) * 1000)
                volume = min(100, max(0, volume))
                
                pitches, magnitudes = librosa.piptrack(y=y, sr=sr)
                pitch_values = []
                for t in range(pitches.shape[1]):
                    index = magnitudes[:, t].argmax()
                    pitch = pitches[index, t]
                    if pitch > 0:
                        pitch_values.append(pitch)
                
                avg_pitch = float(np.mean(pitch_values)) if pitch_values else 200.0
                pitch_semitones = 12 * np.log2(avg_pitch / 200.0) if avg_pitch > 0 else 0
                pitch_semitones = float(np.clip(pitch_semitones, -12, 12))
                
                tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
                speed = float(tempo / 120.0)
                speed = min(2.0, max(0.5, speed))
                
                spectral_centroids = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
                energy = float(np.mean(spectral_centroids) / 40)
                energy = min(100, max(0, energy))
                
                intensity = int((volume * 0.7) + (energy * 0.3))
                
                # Detect emotion
                emotion = 'neutral'
                if volume > 80 and pitch_semitones > 4 and speed > 1.3:
                    emotion = 'shout'
                elif volume > 75 and speed > 1.2 and intensity > 80:
                    emotion = 'angry'
                elif volume < 35 and energy < 40:
                    emotion = 'whisper'
                elif pitch_semitones > 5 and speed > 1.3 and energy > 75:
                    emotion = 'laugh'
                elif pitch_semitones > 3 and speed > 1.1 and energy > 65:
                    emotion = 'happy'
                elif pitch_semitones < -3 and speed < 0.85 and volume < 60:
                    emotion = 'cry'
                elif pitch_semitones < -2 and speed < 0.9 and energy < 55:
                    emotion = 'sad'
                elif pitch_semitones > 4 and energy > 70 and intensity > 75:
                    emotion = 'excited'
                elif pitch_semitones > 2 and speed > 1.1 and volume < 65:
                    emotion = 'scared'
                
                emotion_data = {
                    'emotion': emotion,
                    'emotionIntensity': intensity,
                    'emotionParams': {
                        'volume': int(volume),
                        'pitch': round(pitch_semitones, 2),
                        'speed': round(speed, 2),
                        'energy': int(energy)
                    }
                }
                
                # Cleanup temp file
                if os.path.exists(segment_audio_path):
                    os.remove(segment_audio_path)
        except Exception as e:
            print(f"Emotion detection skipped for segment {idx}: {e}")
        
        formatted.append({
            **s,
            'line_index': idx,
            'voiceId': s.get('voiceId') or assigned.get('voiceId', 'voxcpm:kxev_char_01_male.mp3'),
            'voiceFilename': s.get('voiceFilename') or assigned.get('filename'),
            'voiceLabel': s.get('voiceLabel') or assigned.get('label'),
            # Only real cuts from this movie (the fallback is a stock voice outside /media/outputs)
            'movieVoiceSample': (
                f"/media/outputs/{os.path.basename(movie_voice_map[sid])}"
                if sid in movie_voice_map and os.path.dirname(os.path.abspath(movie_voice_map[sid])) == os.path.abspath(OUTPUTS_DIR)
                else None
            ),
            'audioUrl': None,
            'source': 'pending',
            **emotion_data  # 🎭 Add emotion data
        })

    return {
        'success': True,
        'duration': duration,
        'segments': formatted,
        'characterVoiceMap': {k: v.get('voiceId') for k, v in char_map.items()}
    }

# --- Project State Persistence (Never lose timeline/segments on browser refresh) ---
@app.post('/api/project/save')
async def save_project_state(request: Request):
    try:
        data = await request.json()
        data['updated_at'] = time.time()
        with open(ACTIVE_PROJECT_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return {'success': True, 'message': 'គម្រោងត្រូវបានរក្សាទុកដោយជោគជ័យ!'}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save project: {str(e)}")

@app.get('/api/project/load')
async def load_project_state():
    if not os.path.exists(ACTIVE_PROJECT_FILE):
        return {'success': False, 'project': None}
    try:
        with open(ACTIVE_PROJECT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {'success': True, 'project': data}
    except Exception as e:
        return {'success': False, 'error': str(e), 'project': None}

@app.post('/api/project/clear')
async def clear_project_state():
    try:
        if os.path.exists(ACTIVE_PROJECT_FILE):
            os.remove(ACTIVE_PROJECT_FILE)
        return {'success': True, 'message': 'Project cache cleared'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

@app.post('/api/dubbing/record-line')
async def record_line(audio: UploadFile = File(...), lineIndex: int = Form(0)):
    out_name = f"user_recorded_line_{lineIndex}_{int(time.time() * 1000)}.wav"
    out_path = os.path.join(OUTPUTS_DIR, out_name)
    temp_upload = os.path.join(OUTPUTS_DIR, f"temp_{audio.filename}")

    with open(temp_upload, 'wb') as f:
        shutil.copyfileobj(audio.file, f)

    audio_processor.run_command(f'ffmpeg -nostdin -y -i "{temp_upload}" -ar 44100 -ac 2 -b:a 192k "{out_path}"')
    try:
        if os.path.exists(temp_upload): os.unlink(temp_upload)
    except Exception:
        pass

    return {
        'success': True,
        'lineIndex': lineIndex,
        'audioUrl': f"/media/outputs/{out_name}",
        'filename': out_name
    }

def _apply_speed_pitch(path: str, speed: Optional[float], pitch: Optional[int]):
    """Per-character speed/pitch from the casting table, applied in place."""
    spd = float(speed or 1.0)
    pit = int(pitch or 0)
    if (abs(spd - 1.0) < 0.01 and pit == 0) or not os.path.exists(path):
        return
    root, ext = os.path.splitext(path)
    tuned = f"{root}_tuned{ext}"
    try:
        audio_processor.tune_audio_pitch_and_speed(path, tuned, spd, pit)
        if os.path.exists(tuned) and os.path.getsize(tuned) > 500:
            os.replace(tuned, path)
    except Exception as e:
        print(f"Speed/pitch notice: {e}")

@app.post('/api/dubbing/generate-line')
async def generate_line(body: GenerateLineRequest, request: Request):
    user = get_request_user(request)
    is_admin = bool(user and user.get('role') == 'admin')
    has_license = bool(user and user.get('has_voxcpm_license'))
    is_vox_voice = bool(body.voiceId and (body.voiceId.startswith('voxcpm:') or body.voiceId == 'movie-live-clone'))
    
    if is_vox_voice and not (is_admin or has_license):
        raise HTTPException(
            status_code=403,
            detail="សំឡេង VoxCPM2 / Voice Clone សម្រាប់តែគណនីមាន Key License ពី Admin ប៉ុណ្ណោះ! សូមបញ្ចូល Key License ដើម្បីប្រើប្រាស់។"
        )

    out_name = f"ai_line_{body.lineIndex}_{int(time.time() * 1000)}.wav"
    out_path = os.path.join(OUTPUTS_DIR, out_name)

    is_female = body.gender == 'female'
    studio_ref = None

    if body.voiceId == 'movie-live-clone' and body.speakerId:
        cand = os.path.join(OUTPUTS_DIR, f"ref_voice_{body.speakerId}.mp3")
        if os.path.exists(cand):
            studio_ref = cand

    if not studio_ref and body.voiceId and body.voiceId.startswith('voxcpm:'):
        sample_name = body.voiceId.replace('voxcpm:', '')
        cand_d = os.path.join(SAMPLES_DIR, sample_name)
        cand_m = os.path.join(SAMPLES_DIR, f"{sample_name}.mp3")
        if os.path.exists(cand_d): studio_ref = cand_d
        elif os.path.exists(cand_m): studio_ref = cand_m

    if not studio_ref:
        studio_ref = os.path.join(SAMPLES_DIR, 'main_lead_female.mp3' if is_female else 'main_lead_male.mp3')

    clean_text = clean_pure_khmer(body.text)
    if not clean_text:
        clean_text = "បាទ"

    # Gemini: detect the line's emotion + intensity + a speaking direction from the Khmer
    # text itself. This is the authoritative emotion signal whenever GEMINI_API_KEY is set;
    # without a key it's skipped entirely and the caller's own `emotion` field is used as before.
    from services import gemini_client
    emotion_result = None
    if gemini_client.get_key():
        emotion_result = await asyncio.to_thread(gemini_client.analyze_text_emotion, clean_text)
        if not emotion_result.get('success'):
            print(f"Gemini emotion detection notice: {emotion_result.get('error')}")

    effective_emotion = body.emotion
    detected_intensity = None
    emotion_instruction = ''
    if emotion_result and emotion_result.get('success'):
        effective_emotion = emotion_result['emotion']
        detected_intensity = emotion_result['intensity']
        emotion_instruction = emotion_result.get('instruction', '')

    try:
        await khmer_dubber.synthesize_realistic_speech(
            clean_text,
            out_path,
            body.voiceId,
            studio_ref if os.path.exists(studio_ref) else None,
            {
                'gender': body.gender,
                'emotion': effective_emotion,
                'role': body.speakerId,
                'intensity': detected_intensity,
                'instruction': emotion_instruction,
                'natural': bool(body.naturalVoice),
                'character_number': body.characterNumber,
                'slot': body.slotSeconds,
            }
        )
        await asyncio.to_thread(_apply_speed_pitch, out_path, body.speed, body.pitch)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"បង្កើតសំឡេងមិនបាន (Voice generation failed): {e}")

    if not os.path.exists(out_path) or os.path.getsize(out_path) < 500:
        raise HTTPException(status_code=502, detail="បង្កើតសំឡេងមិនបាន — Server មិនបានឆ្លើយតបសំឡេងត្រឡប់មកវិញទេ")

    return {
        'success': True,
        'lineIndex': body.lineIndex,
        'audioUrl': f"/media/outputs/{out_name}",
        'filename': out_name,
        'detectedEmotion': emotion_result['emotion'] if (emotion_result and emotion_result.get('success')) else None,
        'detectedIntensity': detected_intensity,
        'emotionInstruction': emotion_instruction or None,
    }


# --- Emotion Detection Endpoint ---
class EmotionDetectionRequest(BaseModel):
    audioUrl: str

@app.post('/api/audio/detect-emotion')
async def detect_emotion_from_audio(body: EmotionDetectionRequest):
    """
    AI Emotion Detection API
    វិភាគសំឡេងនិងកំណត់អារម្មណ៍ដោយស្វ័យប្រវត្តិ
    """
    try:
        import librosa
        import numpy as np
        
        # Download audio file
        audio_path = body.audioUrl
        if audio_path.startswith('/media/'):
            audio_path = os.path.join(BASE_DIR, audio_path.lstrip('/'))
        elif audio_path.startswith('http'):
            # Download from URL
            import requests
            response = requests.get(audio_path)
            temp_path = os.path.join(OUTPUTS_DIR, f"temp_emotion_{int(time.time() * 1000)}.wav")
            with open(temp_path, 'wb') as f:
                f.write(response.content)
            audio_path = temp_path
        
        # Load audio with librosa
        y, sr = librosa.load(audio_path, sr=None)
        
        # Extract features
        # 1. RMS Energy (volume/loudness)
        rms = librosa.feature.rms(y=y)[0]
        volume = float(np.mean(rms) * 1000)
        volume = min(100, max(0, volume))
        
        # 2. Pitch (fundamental frequency)
        pitches, magnitudes = librosa.piptrack(y=y, sr=sr)
        pitch_values = []
        for t in range(pitches.shape[1]):
            index = magnitudes[:, t].argmax()
            pitch = pitches[index, t]
            if pitch > 0:
                pitch_values.append(pitch)
        
        avg_pitch = float(np.mean(pitch_values)) if pitch_values else 200.0
        # Convert to semitones relative to 200 Hz base
        pitch_semitones = 12 * np.log2(avg_pitch / 200.0) if avg_pitch > 0 else 0
        pitch_semitones = float(np.clip(pitch_semitones, -12, 12))
        
        # 3. Tempo/Speed (beats per minute)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        speed = float(tempo / 120.0)  # Normalize to 1.0 = normal speed
        speed = min(2.0, max(0.5, speed))
        
        # 4. Energy (spectral centroid)
        spectral_centroids = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        energy = float(np.mean(spectral_centroids) / 40)
        energy = min(100, max(0, energy))
        
        # 5. Intensity (combination of volume and energy)
        intensity = int((volume * 0.7) + (energy * 0.3))
        
        # Map features to emotion using decision tree
        emotion = 'neutral'
        confidence = 0.6
        
        if volume > 80 and pitch_semitones > 4 and speed > 1.3:
            emotion = 'shout'
            confidence = 0.85
        elif volume > 75 and speed > 1.2 and intensity > 80:
            emotion = 'angry'
            confidence = 0.8
        elif volume < 35 and energy < 40:
            emotion = 'whisper'
            confidence = 0.85
        elif pitch_semitones > 3 and speed > 1.1 and energy > 65:
            emotion = 'happy'
            confidence = 0.75
        elif pitch_semitones > 5 and speed > 1.3 and energy > 75:
            emotion = 'laugh'
            confidence = 0.8
        elif pitch_semitones < -2 and speed < 0.9 and energy < 55:
            emotion = 'sad'
            confidence = 0.75
        elif pitch_semitones < -3 and speed < 0.85 and volume < 60 and intensity < 50:
            emotion = 'cry'
            confidence = 0.8
        elif pitch_semitones > 4 and energy > 70 and intensity > 75:
            emotion = 'excited'
            confidence = 0.75
        elif pitch_semitones > 2 and speed > 1.1 and volume < 65 and intensity > 60:
            emotion = 'scared'
            confidence = 0.7
        
        return {
            'emotion': emotion,
            'confidence': confidence,
            'intensity': intensity,
            'features': {
                'volume': int(volume),
                'pitch': round(pitch_semitones, 2),
                'speed': round(speed, 2),
                'energy': int(energy)
            }
        }
        
    except Exception as e:
        print(f"Emotion detection error: {e}")
        # Return neutral emotion as fallback
        return {
            'emotion': 'neutral',
            'confidence': 0.5,
            'intensity': 50,
            'features': {
                'volume': 70,
                'pitch': 0,
                'speed': 1.0,
                'energy': 50
            }
        }

@app.post('/api/dubbing/assemble-custom')
async def assemble_custom(body: AssembleCustomRequest, request: Request):
    input_path = os.path.join(UPLOADS_DIR, body.filename)
    if not os.path.exists(input_path):
        root_path = os.path.join(BASE_DIR, body.filename)
        if os.path.exists(root_path): input_path = root_path
    if not os.path.exists(input_path):
        raise HTTPException(status_code=404, detail="Video file not found")

    duration = audio_processor.get_media_duration(input_path)
    audio_ext = os.path.splitext(body.filename)[0] + '.mp3'
    extracted_audio_path = os.path.join(OUTPUTS_DIR, f"audio_{audio_ext}")
    if not os.path.exists(extracted_audio_path):
        audio_processor.extract_audio(input_path, extracted_audio_path)

    # Turbo Hardware Concurrency: Synthesize missing speech in parallel workers
    concurrency_limit = min(16, max(4, (os.cpu_count() or 4) * 2))
    sem = asyncio.Semaphore(concurrency_limit)

    # Lines cast with a cloned voice (voxcpm:...) must keep that character's voice even
    # when they were not generated beforehand, so 1 character = 1 voice in the final mix.
    req_user = get_request_user(request)
    can_clone = bool(req_user and (req_user.get('role') == 'admin' or req_user.get('has_voxcpm_license')))
    clone_sem = asyncio.Semaphore(2)
    from services import natural_voice
    char_numbers = natural_voice.character_numbers(body.segments) if body.naturalVoice else {}

    async def prepare_segment(i, seg):
        audio_path = None
        if seg.get('audioUrl'):
            base = os.path.basename(seg['audioUrl'])
            p = os.path.join(OUTPUTS_DIR, base)
            if os.path.exists(p): audio_path = p

        # Auto-synthesize any missing line with retry so ZERO lines are dropped!
        if not audio_path and (seg.get('khmer_translation') or seg.get('chinese_text')):
            raw_text = seg.get('khmer_translation') or seg.get('chinese_text') or ''
            text_to_speak = clean_pure_khmer(raw_text) or raw_text.strip()
            if text_to_speak:
                auto_path = os.path.join(OUTPUTS_DIR, f"auto_studio_line_py_{i}_{int(time.time() * 1000)}.wav")
                is_female = seg.get('gender') == 'female' or ('ស្រី' in (seg.get('speaker_name') or ''))
                role = seg.get('speaker_role') or ('female_lead' if is_female else 'male_lead')
                theatrical = ROLE_THEATRICAL_PROFILES.get(role, {})
                fb_voice = theatrical.get('voice', 'km-KH-SreymomNeural' if is_female else 'km-KH-PisethNeural')
                pitch = theatrical.get('pitch', '+0Hz')
                rate = theatrical.get('rate', '+0%')

                seg_voice = str(seg.get('voiceId') or '')
                char_key = seg.get('speaker_id') or seg.get('speaker_name') or 'speaker_1'
                line_opts = {
                    'gender': 'female' if is_female else 'male',
                    'role': role,
                    'speaker_name': seg.get('speaker_name') or '',
                    'emotion': seg.get('emotion') or 'neutral',
                    'intensity': seg.get('emotionIntensity'),
                    'natural': bool(body.naturalVoice),
                    'character_number': char_numbers.get(char_key, (None, None))[1],
                    'slot': max(0.0, float(seg.get('end_time', 0) or 0) - float(seg.get('start_time', 0) or 0)) or None,
                }
                if char_key in char_numbers:
                    line_opts['gender'] = char_numbers[char_key][0]
                if can_clone and seg_voice.startswith('voxcpm:'):
                    try:
                        async with clone_sem:
                            await khmer_dubber.synthesize_realistic_speech(text_to_speak, auto_path, seg_voice, None, line_opts)
                        if os.path.exists(auto_path) and os.path.getsize(auto_path) > 500:
                            audio_path = auto_path
                    except Exception as ex:
                        print(f"Character voice line {i} notice, using neural fallback: {ex}")
                elif body.naturalVoice:
                    try:
                        async with sem:
                            await khmer_dubber.synthesize_natural_line(text_to_speak, auto_path, line_opts)
                        if os.path.exists(auto_path) and os.path.getsize(auto_path) > 500:
                            audio_path = auto_path
                    except Exception as ex:
                        print(f"Natural voice line {i} notice, using plain voice: {ex}")

                # Retry up to 3 times
                for attempt in range(3):
                    if audio_path:
                        break
                    try:
                        async with sem:
                            await khmer_dubber.synthesize_khmer_speech(text_to_speak, auto_path, fb_voice, pitch=pitch, rate=rate)
                        if os.path.exists(auto_path) and os.path.getsize(auto_path) > 500:
                            audio_path = auto_path
                            break
                    except Exception as ex:
                        print(f"Auto-synthesize line {i} attempt {attempt+1} notice: {ex}")
                        await asyncio.sleep(0.3)

        if audio_path and os.path.basename(audio_path).startswith('auto_studio_line_py_'):
            await asyncio.to_thread(_apply_speed_pitch, audio_path, seg.get('speed'), seg.get('pitch'))

        if not audio_path:
            # Fallback silence placeholder so line is NEVER dropped
            silence_path = os.path.join(OUTPUTS_DIR, f"silent_line_{i}.wav")
            audio_processor.run_command(f'ffmpeg -nostdin -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1.0 "{silence_path}"')
            audio_path = silence_path

        return {
            **seg,
            'audioPath': audio_path,
            'start_time': float(seg.get('start_time', 0)),
            'end_time': float(seg.get('end_time', float(seg.get('start_time', 0)) + 2.5))
        }

    raw_mapped = await asyncio.gather(*(prepare_segment(i, seg) for i, seg in enumerate(body.segments)))
    mapped_segments = [m for m in raw_mapped if m is not None]

    if not mapped_segments:
        raise HTTPException(status_code=400, detail="មិនមានឃ្លាសន្ទនាសម្រាប់ដំណើរការ dubbing ឡើយ!")

    ts = int(time.time() * 1000)
    master_dialogue_path = os.path.join(OUTPUTS_DIR, f"custom_master_dialogue_py_{ts}.wav")
    await khmer_dubber.assemble_timeline_audio(mapped_segments, duration, master_dialogue_path)
    if body.naturalVoice:
        await asyncio.to_thread(audio_processor.polish_dialogue_track, master_dialogue_path)

    dubbed_audio_path = os.path.join(OUTPUTS_DIR, f"custom_dubbed_master_py_{ts}.mp3")

    bgm_mode = (body.bgmMode or '').lower()
    remove_vocals = body.removeOriginalVocals if bgm_mode not in ('auto', 'clean', 'original') else bgm_mode in ('auto', 'clean')

    # Clean BGM selection: Strip Chinese vocals if requested
    from services import vocal_separator
    bgm_source_path = extracted_audio_path
    bgm_engine = 'original'
    if body.bgmAudio and bgm_mode != 'original':
        bgm_cand = os.path.join(OUTPUTS_DIR, os.path.basename(body.bgmAudio))
        if os.path.exists(bgm_cand):
            bgm_source_path = bgm_cand
            bgm_engine = 'provided'
    elif remove_vocals and bgm_mode != 'none':
        stem = os.path.splitext(os.path.basename(extracted_audio_path))[0]
        ai_bgm_cand = os.path.join(OUTPUTS_DIR, f"{stem}_ai_bgm.wav")
        dsp_bgm_cand = os.path.join(OUTPUTS_DIR, f"{stem}_{vocal_separator.DSP_VERSION}_bgm.wav")
        if os.path.exists(ai_bgm_cand):
            bgm_source_path, bgm_engine = ai_bgm_cand, 'ai'
        elif os.path.exists(dsp_bgm_cand) and not vocal_separator.has_demucs():
            bgm_source_path, bgm_engine = dsp_bgm_cand, 'dsp'
        else:
            # Demucs takes minutes on a CPU — keep the server responsive meanwhile
            sep_res = await asyncio.to_thread(vocal_separator.separate_vocals_and_bgm, extracted_audio_path, OUTPUTS_DIR, True)
            if sep_res.get('bgmPath') and os.path.exists(sep_res['bgmPath']):
                bgm_source_path = sep_res['bgmPath']
                bgm_engine = 'ai' if sep_res.get('engine') == 'meta-demucs-ai' else 'dsp'

    v_gain = body.vocalGain if body.vocalGain is not None else 2.2
    b_gain = body.bgmGain if body.bgmGain is not None else 1.0
    if bgm_mode == 'auto':
        auto_target = None
        if bgm_engine in ('ai', 'dsp'):
            # Keep the original soundtrack 100% where nobody speaks; use the voice-removed
            # version only while the original lines are spoken.
            bed_path = os.path.join(OUTPUTS_DIR, f"smart_bed_py_{ts}.wav")
            try:
                await asyncio.to_thread(
                    audio_processor.build_smart_bed, extracted_audio_path, bgm_source_path,
                    body.segments, bed_path, duration,
                )
                if os.path.exists(bed_path) and os.path.getsize(bed_path) > 1000:
                    bgm_source_path = bed_path
                    auto_target = audio_processor.SMART_BED_LUFS
            except Exception as ex:
                print(f"Smart background notice, using separated background only: {ex}")
        v_gain, b_gain = await asyncio.to_thread(
            audio_processor.auto_mix_gains, master_dialogue_path, bgm_source_path, auto_target
        )
        # The Session sliders act as a trim on top of the automatic levels (100% = automatic)
        if body.bgmGain is not None:
            b_gain = round(b_gain * max(0.0, min(2.0, body.bgmGain)), 3)
        if body.vocalGain is not None:
            v_gain = round(v_gain * max(0.5, min(1.5, body.vocalGain / 2.2)), 3)
    elif bgm_mode == 'original':
        # Voice-over: the whole original soundtrack (voices included) stays audible a little
        # louder than a music bed, and dips while the Khmer voice speaks.
        v_gain, b_gain = await asyncio.to_thread(
            audio_processor.auto_mix_gains, master_dialogue_path, bgm_source_path,
            audio_processor.VOICEOVER_BED_LUFS,
        )
    if bgm_mode == 'none' or b_gain <= 0:
        await asyncio.to_thread(
            audio_processor.render_dialogue_only, master_dialogue_path, dubbed_audio_path, duration, v_gain
        )
    else:
        await asyncio.to_thread(
            audio_processor.mix_vocals_with_original,
            bgm_source_path, master_dialogue_path, dubbed_audio_path, v_gain, b_gain,
            bgm_source_path != extracted_audio_path,
            bgm_mode == 'original',
        )

    video_ext = os.path.splitext(input_path)[1]
    out_video_filename = f"custom_dubbed_khmer_py_{ts}{video_ext}"
    out_video_path = os.path.join(OUTPUTS_DIR, out_video_filename)

    # Run merge in separate thread to avoid blocking
    await asyncio.to_thread(
        audio_processor.merge_video_audio,
        input_path,
        dubbed_audio_path,
        out_video_path
    )

    # Optional: burn the Khmer lines into the picture. If this fails the dubbed video is
    # still returned (without subtitles) so the user never loses the finished dub.
    subtitle_error = None
    if body.burnSubtitles:
        srt_path = os.path.join(OUTPUTS_DIR, f"session_sub_{ts}.srt")
        try:
            srt_content = audio_processor.create_srt_content(body.segments)
            if srt_content.strip():
                with open(srt_path, 'w', encoding='utf-8') as f:
                    f.write(srt_content)
                burned_filename = f"custom_dubbed_khmer_sub_py_{ts}.mp4"
                burned_path = os.path.join(OUTPUTS_DIR, burned_filename)
                await asyncio.to_thread(
                    audio_processor.burn_overlay_and_subtitles,
                    video_path=out_video_path,
                    output_video_path=burned_path,
                    srt_path=srt_path,
                    options={'resolution': 'original', 'subtitleStyle': body.subtitleStyle or {}, 'turbo': True},
                )
                if os.path.exists(burned_path) and os.path.getsize(burned_path) > 1000:
                    out_video_filename = burned_filename
                else:
                    subtitle_error = 'FFmpeg did not produce a subtitled video'
        except Exception as ex:
            print(f"Subtitle burn error: {ex}")
            subtitle_error = str(ex)
        finally:
            if os.path.exists(srt_path):
                try:
                    os.remove(srt_path)
                except Exception:
                    pass

    return {
        'success': True,
        'outputVideo': f"/media/outputs/{out_video_filename}",
        'outputAudio': f"/media/outputs/{os.path.basename(dubbed_audio_path)}",
        'totalLinesDubbed': len(mapped_segments),
        'hasSubtitles': bool(body.burnSubtitles and not subtitle_error),
        'subtitleError': subtitle_error,
        # 'ai' (Demucs), 'dsp' (filter fallback), 'original' (soundtrack as is), 'provided'
        'bgmEngine': bgm_engine if bgm_mode != 'none' else None,
    }

@app.post('/api/video/render-export')
async def render_export_video(body: RenderExportRequest, request: Request):
    """
    Render and export video with overlay and subtitles
    Fixed: Use asyncio.to_thread() for blocking FFmpeg operations
    """
    # 0. Subscription gate (server/VPS mode only -- a PC install stays unrestricted).
    # Each successful export below counts against a free account's trial; a
    # paid plan (tier == 'premium', granted by a subscription) never does.
    if PUBLIC_MODE:
        export_user = get_request_user(request)
        is_paid = bool(export_user) and (export_user.get('role') == 'admin' or export_user.get('tier') == 'premium')
        if not is_paid:
            used = int((export_user or {}).get('trial_exports_used') or 0)
            if used >= TRIAL_FREE_EXPORTS:
                raise HTTPException(status_code=402, detail={
                    'code': 'trial_exhausted',
                    'message': f'Trial {TRIAL_FREE_EXPORTS} វគ្គរបស់អ្នកអស់ហើយ — សូមទិញ Subscription ដើម្បីបន្ត Export',
                })

    # 1. Resolve source video path
    input_path = None
    if body.inputVideo:
        cand = os.path.basename(body.inputVideo)
        for folder in [OUTPUTS_DIR, UPLOADS_DIR, BASE_DIR]:
            p = os.path.join(folder, cand)
            if os.path.exists(p):
                input_path = p
                break

    if not input_path or not os.path.exists(input_path):
        for folder in [OUTPUTS_DIR, UPLOADS_DIR, BASE_DIR]:
            p = os.path.join(folder, body.filename)
            if os.path.exists(p):
                input_path = p
                break

    if not input_path or not os.path.exists(input_path):
        resolved_path, _ = resolve_uploaded_file(body.filename or (body.inputVideo and os.path.basename(body.inputVideo)) or "")
        if resolved_path and os.path.exists(resolved_path):
            input_path = resolved_path

    if not input_path or not os.path.exists(input_path):
        raise HTTPException(status_code=404, detail="វីដេអូដើមមិនត្រូវបានរកឃើញឡើយ!")

    ts = int(time.time() * 1000)
    temp_overlay_path = None
    temp_srt_path = None

    try:
        # 2. Extract Transparent Title/Thumbnail Overlay PNG
        if body.titleOverlayBase64:
            try:
                raw_b64 = body.titleOverlayBase64
                if ',' in raw_b64:
                    raw_b64 = raw_b64.split(',', 1)[1]
                img_bytes = base64.b64decode(raw_b64)
                temp_overlay_path = os.path.join(OUTPUTS_DIR, f"export_overlay_{ts}.png")
                with open(temp_overlay_path, 'wb') as f:
                    f.write(img_bytes)
            except Exception as ex:
                print(f"Overlay decode error: {ex}")
                temp_overlay_path = None

        # 3. Generate SRT for Subtitles if requested
        if body.burnSubtitles and body.subtitles and len(body.subtitles) > 0:
            try:
                srt_content = audio_processor.create_srt_content(body.subtitles)
                if srt_content and len(srt_content.strip()) > 0:
                    temp_srt_path = os.path.join(OUTPUTS_DIR, f"export_sub_{ts}.srt")
                    with open(temp_srt_path, 'w', encoding='utf-8') as f:
                        f.write(srt_content)
            except Exception as ex:
                print(f"SRT generation error: {ex}")
                temp_srt_path = None

        # 4. Output filename and path
        target_format = body.format or 'mp4'
        if target_format not in ['mp4', 'mkv', 'mov']:
            target_format = 'mp4'

        base_stem = os.path.splitext(os.path.basename(input_path))[0]
        clean_stem = base_stem.replace('custom_dubbed_khmer_py_', '').replace('custom_dubbed_khmer_', '').replace('audio_', '')
        out_filename = f"studio_burned_{clean_stem}_{ts}.{target_format}"
        out_path = os.path.join(OUTPUTS_DIR, out_filename)

        # 5. Burn permanently with FFmpeg (including watermark and custom subtitles styling)
        # Run in separate thread to avoid blocking async event loop
        options = {
            'resolution': body.resolution or '1080p',
            'bitrate': body.bitrate or 'high',
            'format': target_format,
            'watermark': body.watermark,
            'subtitleStyle': body.subtitleStyle,
            'turbo': body.turbo
        }

        # Use asyncio.to_thread() to run blocking FFmpeg operation without blocking event loop
        await asyncio.to_thread(
            audio_processor.burn_overlay_and_subtitles,
            video_path=input_path,
            output_video_path=out_path,
            overlay_image_path=temp_overlay_path,
            srt_path=temp_srt_path,
            options=options
        )

        # Copy to custom destination directory if requested (e.g. D:\VIDEO AI or D:\AnimeDub_Outputs)
        if body.outputDir and os.path.exists(out_path):
            try:
                os.makedirs(body.outputDir, exist_ok=True)
                dest_file = os.path.join(body.outputDir, out_filename)
                import shutil
                shutil.copy2(out_path, dest_file)
                print(f"✅ Video exported directly to destination folder: {dest_file}")
            except Exception as copy_err:
                print(f"Warning: Failed to copy to {body.outputDir}: {copy_err}")

        if PUBLIC_MODE and export_user and not is_paid:
            auth_db.increment_trial_exports(export_user['id'])

        return {
            'success': True,
            'outputVideo': f"/media/outputs/{out_filename}",
            'filename': out_filename,
            'hasOverlay': bool(temp_overlay_path and os.path.exists(out_path)),
            'hasSubtitles': bool(temp_srt_path and os.path.exists(out_path))
        }

    except Exception as e:
        import traceback
        print(f"Render export error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"កំហុសក្នុងការ render video: {str(e)}")
    
    finally:
        # Cleanup temporary files
        if temp_overlay_path and os.path.exists(temp_overlay_path):
            try:
                os.remove(temp_overlay_path)
            except Exception:
                pass
        if temp_srt_path and os.path.exists(temp_srt_path):
            try:
                os.remove(temp_srt_path)
            except Exception:
                pass

@app.post('/api/character/clone')
async def character_clone(voiceSample: UploadFile = File(...), characterName: Optional[str] = Form(None), description: Optional[str] = Form(None)):
    filename = f"clone_{int(time.time() * 1000)}_{voiceSample.filename}"
    save_path = os.path.join(UPLOADS_DIR, filename)
    with open(save_path, 'wb') as f:
        shutil.copyfileobj(voiceSample.file, f)

    if os.getenv('VOXCPM_API_URL'):
        return {
            'success': True,
            'voiceId': f"voxcpm-ref:{filename}",
            'name': characterName or 'Movie Character',
            'engine': 'voxcpm2'
        }

    return {
        'success': True,
        'voiceId': f"local-clone:{filename}",
        'name': characterName or 'Movie Character',
        'engine': 'edge-tts'
    }

@app.get('/api/character/samples')
def get_character_samples():
    chars_file = os.path.join(BASE_DIR, 'extracted_characters.json')
    if os.path.exists(chars_file):
        with open(chars_file, 'r', encoding='utf-8') as f:
            chars = json.load(f)
        augmented = []
        for c in chars:
            augmented.append({
                **c,
                'previewUrl': f"/media/samples/{c['filename']}"
            })
        return {'success': True, 'count': len(augmented), 'characters': augmented}
    return {'success': True, 'count': 0, 'characters': []}

@app.post('/api/character/speak')
async def character_speak(body: CharacterSpeakRequest, request: Request):
    user = get_request_user(request)
    is_admin = bool(user and user.get('role') == 'admin')
    has_license = bool(user and user.get('has_voxcpm_license'))
    is_vox_voice = bool(body.voiceId and (body.voiceId.startswith('voxcpm:') or body.voiceId == 'movie-live-clone' or body.referenceAudio))
    
    if is_vox_voice and not (is_admin or has_license):
        raise HTTPException(
            status_code=403,
            detail="សំឡេង VoxCPM2 / Voice Clone សម្រាប់តែគណនីមាន Key License ពី Admin ប៉ុណ្ណោះ! សូមបញ្ចូល Key License ដើម្បីប្រើប្រាស់។"
        )

    out_name = f"speak_test_py_{int(time.time() * 1000)}.wav"
    out_path = os.path.join(OUTPUTS_DIR, out_name)

    ref_audio = None
    if body.referenceAudio:
        base = os.path.basename(body.referenceAudio)
        c1 = os.path.join(SAMPLES_DIR, base)
        c2 = os.path.join(UPLOADS_DIR, base)
        c3 = os.path.join(OUTPUTS_DIR, base)
        if os.path.exists(c1): ref_audio = c1
        elif os.path.exists(c2): ref_audio = c2
        elif os.path.exists(c3): ref_audio = c3

    clean_text = clean_pure_khmer(body.text)
    if not clean_text:
        clean_text = "សួស្តីបងប្អូនទាំងអស់គ្នា នេះជាសំឡេងនិយាយខ្មែរសុទ្ធ ១០០%"

    await khmer_dubber.synthesize_realistic_speech(
        clean_text,
        out_path,
        body.voiceId,
        ref_audio,
        {'gender': body.gender, 'emotion': body.emotion}
    )

    return {
        'success': True,
        'audioUrl': f"/media/outputs/{out_name}",
        'filename': out_name
    }

def get_lan_addresses(port: int):
    import socket
    addresses = []
    try:
        host_name = socket.gethostname()
        for ip in socket.gethostbyname_ex(host_name)[2]:
            if not ip.startswith('127.'):
                addresses.append({'interface': 'LAN', 'ip': ip, 'url': f'http://{ip}:{port}'})
    except Exception:
        pass
    return addresses

@app.get('/api/characters/extracted')
def get_extracted_characters():
    json_path = os.path.join(BASE_DIR, 'extracted_characters.json')
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                chars = json.load(f)
            augmented = [{**c, 'previewUrl': f"/media/samples/{c.get('filename', '')}"} for c in chars]
            return {'success': True, 'count': len(augmented), 'characters': augmented}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {'success': True, 'count': 0, 'characters': []}

@app.get('/api/characters/all')
def get_all_characters(request: Request):
    user = get_request_user(request)
    is_free = not user or (user.get('tier') != 'premium' and user.get('role') != 'admin')

    # If Free user, return ONLY the Default Natural voice
    if is_free:
        default_voice = {
            'id': 'default_neural_piseth',
            'filename': 'default_neural.mp3',
            'label': '🎙️ Default Neural (PisethNatural - Free)',
            'role_key': 'male_lead',
            'gender': 'male',
            'is_curated': True,
            'is_free_only': True,
            'words': 'សំឡេងធម្មជាតិស្តង់ដារ PisethNeural សម្រាប់គណនី Free',
            'exists': True,
            'previewUrl': None,
            'sizeBytes': 0
        }
        return {'success': True, 'count': 1, 'characters': [default_voice], 'isFree': True}

    json_path = os.path.join(BASE_DIR, 'extracted_characters.json')
    characters = []
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                characters = json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Auto-discover unlisted audio samples in samples directory
    if os.path.exists(SAMPLES_DIR):
        existing_filenames = set(c.get('filename') for c in characters)
        for f in os.listdir(SAMPLES_DIR):
            if (f.endswith('.mp3') or f.endswith('.wav')) and f not in existing_filenames:
                base_name = os.path.splitext(f)[0]
                is_wav_pair = f.endswith('.wav') and any(os.path.splitext(c.get('filename', ''))[0] == base_name for c in characters)
                if not is_wav_pair:
                    is_female = 'female' in f.lower()
                    characters.append({
                        'id': f"voxcpm:{f}",
                        'filename': f,
                        'label': os.path.splitext(f)[0].replace('_', ' '),
                        'role_key': 'female_lead' if is_female else 'male_lead',
                        'gender': 'female' if is_female else 'male',
                        'is_curated': False,
                        'words': 'សំឡេងគំរូក្នុងស្ទូឌីយោ'
                    })

    enriched = []
    for c in characters:
        fp = os.path.join(SAMPLES_DIR, c.get('filename', ''))
        exists = os.path.exists(fp)
        size = os.path.getsize(fp) if exists else 0
        enriched.append({
            **c,
            'exists': exists,
            'previewUrl': f"/media/samples/{c.get('filename', '')}" if exists else None,
            'sizeBytes': size
        })

    return {'success': True, 'count': len(enriched), 'characters': enriched, 'isFree': False}

@app.put('/api/characters/update')
def update_character(body: CharacterUpdateRequest):
    json_path = os.path.join(BASE_DIR, 'extracted_characters.json')
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail='Characters database not found')

    with open(json_path, 'r', encoding='utf-8') as f:
        characters = json.load(f)

    target_idx = -1
    for i, c in enumerate(characters):
        if (body.id and c.get('id') == body.id) or (body.filename and c.get('filename') == body.filename):
            target_idx = i
            break

    if target_idx == -1:
        new_entry = {
            'id': body.id or f"voxcpm:{body.filename}",
            'filename': body.filename or 'custom_voice.mp3',
            'label': body.label.strip() if body.label else 'សំឡេងថ្មី',
            'role_key': body.role_key or ('female_lead' if body.gender == 'female' else 'male_lead'),
            'gender': body.gender or 'male',
            'is_curated': True,
            'words': body.words.strip() if body.words else ''
        }
        characters.insert(0, new_entry)
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(characters, f, ensure_ascii=False, indent=2)
        return {'success': True, 'character': new_entry}

    if body.label is not None and body.label.strip():
        characters[target_idx]['label'] = body.label.strip()
    if body.role_key is not None:
        characters[target_idx]['role_key'] = body.role_key
    if body.gender is not None:
        characters[target_idx]['gender'] = body.gender
    if body.words is not None:
        characters[target_idx]['words'] = body.words.strip()

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(characters, f, ensure_ascii=False, indent=2)

    return {'success': True, 'character': characters[target_idx]}

@app.post('/api/characters/create')
async def create_character(
    audioFile: UploadFile = File(...),
    label: str = Form(...),
    gender: str = Form('male'),
    role_key: str = Form('male_lead'),
    words: Optional[str] = Form('')
):
    json_path = os.path.join(BASE_DIR, 'extracted_characters.json')
    ext = os.path.splitext(audioFile.filename)[1].lower() or '.mp3'
    safe_base = f"custom_voice_{int(time.time() * 1000)}"
    target_filename = f"{safe_base}{ext}"
    dest_path = os.path.join(SAMPLES_DIR, target_filename)

    with open(dest_path, 'wb') as buffer:
        shutil.copyfileobj(audioFile.file, buffer)

    if ext != '.mp3':
        mp3_name = f"{safe_base}.mp3"
        mp3_path = os.path.join(SAMPLES_DIR, mp3_name)
        try:
            import subprocess
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', dest_path, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', mp3_path], check=True)
            target_filename = mp3_name
        except Exception as e:
            print(f"Could not transcode voice to mp3: {e}")

    characters = []
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            characters = json.load(f)

    new_char = {
        'id': f"voxcpm:{target_filename}",
        'filename': target_filename,
        'label': label.strip() if label else 'សំឡេងថ្មី',
        'role_key': role_key,
        'gender': gender,
        'is_curated': True,
        'words': words.strip() if words else 'សំឡេងគំរូថ្មី'
    }

    characters.insert(0, new_char)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(characters, f, ensure_ascii=False, indent=2)

    return {
        'success': True,
        'character': {
            **new_char,
            'exists': True,
            'previewUrl': f"/media/samples/{target_filename}"
        }
    }

@app.delete('/api/characters/delete/{char_id:path}')
def delete_character(char_id: str):
    import urllib.parse
    char_id = urllib.parse.unquote(char_id)
    json_path = os.path.join(BASE_DIR, 'extracted_characters.json')
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail='Characters database not found')

    with open(json_path, 'r', encoding='utf-8') as f:
        characters = json.load(f)

    initial_len = len(characters)
    characters = [c for c in characters if c.get('id') != char_id and c.get('filename') != char_id]

    if len(characters) == initial_len:
        raise HTTPException(status_code=404, detail='Character not found')

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(characters, f, ensure_ascii=False, indent=2)

    return {'success': True, 'message': 'Character removed successfully'}

# --- Character Voice Casting (1 តួ = 1 សំឡេង, synced to Supabase when configured) ---
CAST_ALLOWED_EXT = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.webm', '.flac', '.mp4', '.mov', '.mkv'}
CAST_MAX_BYTES = 50 * 1024 * 1024

def _cast_owner(request: Request):
    user = get_request_user(request)
    if user and user.get('id') is not None:
        return f"user-{user['id']}", user['id']
    return 'guest', None

def _remove_cast_sample(filename: Optional[str]):
    """Delete a local cast sample, but only files this feature created."""
    if not filename or os.path.basename(filename) != filename or not filename.startswith(CAST_FILE_PREFIX):
        return
    try:
        path = os.path.join(SAMPLES_DIR, filename)
        if os.path.exists(path):
            os.unlink(path)
    except Exception:
        pass

def _normalize_cast_audio(src_path: str, dest_path: str) -> bool:
    """Mono 44.1kHz MP3, first 30s, loudness-normalised: a stable clone reference for every line."""
    import subprocess
    try:
        subprocess.run([
            'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', src_path,
            '-vn', '-t', '30', '-ac', '1', '-ar', '44100',
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
            '-c:a', 'libmp3lame', '-b:a', '192k', dest_path
        ], check=True, capture_output=True, timeout=120)
        return os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000
    except Exception as e:
        print(f"Cast voice normalize notice: {e}")
        return False

@app.post('/api/cast/voices')
async def upload_cast_voice(
    request: Request,
    audioFile: UploadFile = File(...),
    projectKey: str = Form(...),
    speakerKey: str = Form(...),
    marker: Optional[str] = Form(''),
    gender: Optional[str] = Form('male'),
    lineCount: Optional[int] = Form(0),
    # Strip music/effects first (used for samples cut from the movie itself)
    cleanVocals: Optional[bool] = Form(False),
):
    project_key = (projectKey or '').strip()[:300]
    speaker_key = (speakerKey or '').strip()[:200]
    if not project_key or not speaker_key:
        raise HTTPException(status_code=400, detail="ខ្វះ projectKey ឬ speakerKey")

    ext = os.path.splitext(audioFile.filename or '')[1].lower()
    if ext not in CAST_ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="សូម Upload ឯកសារសំឡេង (.mp3, .wav, .m4a, .ogg, .flac) ឬវីដេអូខ្លី (.mp4)")

    owner_key, user_id = _cast_owner(request)
    ts = int(time.time() * 1000)
    sample_filename = build_sample_filename(owner_key, project_key, speaker_key, ts)
    dest_path = os.path.join(SAMPLES_DIR, sample_filename)
    temp_path = os.path.join(OUTPUTS_DIR, f"cast_upload_{ts}{ext}")

    size = 0
    try:
        with open(temp_path, 'wb') as f:
            while True:
                chunk = await audioFile.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > CAST_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="ឯកសារធំពេក (អតិបរមា 50MB) — សំឡេង 10-30 វិនាទីគឺគ្រប់គ្រាន់")
                f.write(chunk)
        if size < 1000:
            raise HTTPException(status_code=400, detail="ឯកសារសំឡេងទទេ ឬខូច")

        source_path = temp_path
        if cleanVocals:
            from services import vocal_separator
            source_path = await asyncio.to_thread(vocal_separator.isolate_voice_sample, temp_path, OUTPUTS_DIR)
        ok = await asyncio.to_thread(_normalize_cast_audio, source_path, dest_path)
        if not ok and ext == '.mp3':
            shutil.copy2(temp_path, dest_path)
            ok = True
        if not ok:
            raise HTTPException(status_code=400, detail="មិនអាចអានឯកសារសំឡេងនេះបានទេ (សូមពិនិត្យ FFmpeg ឬសាកឯកសារ .mp3)")
    finally:
        try:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
        except Exception:
            pass

    entry = await _save_cast_entry(
        owner_key, user_id, project_key, speaker_key, marker, gender,
        sample_filename, dest_path, audioFile.filename or '', lineCount or 0,
    )
    return {'success': True, 'cast': {**entry, 'exists': True}}

async def _save_cast_entry(owner_key, user_id, project_key, speaker_key, marker, gender,
                           sample_filename, dest_path, original_name, line_count):
    """Record a character's new reference voice and drop the one it replaces."""
    previous = cast_store.get(owner_key, project_key, speaker_key)
    entry = await asyncio.to_thread(
        cast_store.save, owner_key, user_id, project_key, speaker_key,
        (marker or '').strip()[:40], gender or 'male', sample_filename, dest_path,
        original_name, line_count,
    )
    if previous and previous.get('filename') != sample_filename:
        _remove_cast_sample(previous.get('filename'))
        if previous.get('storagePath') and previous.get('storagePath') != entry.get('storagePath'):
            await asyncio.to_thread(supabase_db.storage_delete, supabase_db.VOICE_BUCKET, previous['storagePath'])
    return entry

def _project_media_path(project_key: str) -> Optional[str]:
    """The uploaded video of a session, matched exactly (never another user's newest upload)."""
    name = os.path.basename(project_key or '').strip()
    if not name:
        return None
    for folder in (UPLOADS_DIR, BASE_DIR):
        p = os.path.join(folder, name)
        if os.path.isfile(p):
            return p
    return None

def _cut_voice_ranges(audio_path: str, ranges: list, dest_path: str) -> bool:
    """Join the chosen dialogue ranges of the soundtrack into one short clip."""
    import subprocess
    parts = []
    for k, (st, en) in enumerate(ranges):
        parts.append(f"[0:a]atrim=start={st:.3f}:end={en:.3f},asetpts=PTS-STARTPTS[p{k}]")
    graph = ";".join(parts) + ";" + "".join(f"[p{k}]" for k in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[out]"
    try:
        subprocess.run([
            'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', audio_path,
            '-filter_complex', graph, '-map', '[out]', '-ar', '44100', '-ac', '2', dest_path
        ], check=True, capture_output=True, timeout=180)
        return os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000
    except Exception as e:
        print(f"Cast voice cut notice: {e}")
        return False

class CastRange(BaseModel):
    start: float
    end: float

class CastFromVideoRequest(BaseModel):
    projectKey: str
    speakerKey: str
    marker: Optional[str] = ''
    gender: Optional[str] = 'male'
    lineCount: Optional[int] = 0
    ranges: List[CastRange]
    # Strip music/effects so the clone hears only the character
    cleanVocals: Optional[bool] = True

CAST_CLIP_MAX_RANGE = 12.0
CAST_CLIP_MAX_TOTAL = 30.0

@app.post('/api/cast/voices/from-video')
async def cast_voice_from_video(body: CastFromVideoRequest, request: Request):
    """Clone a character from the lines the user picked in the movie itself."""
    project_key = (body.projectKey or '').strip()[:300]
    speaker_key = (body.speakerKey or '').strip()[:200]
    if not project_key or not speaker_key:
        raise HTTPException(status_code=400, detail="ខ្វះ projectKey ឬ speakerKey")

    ranges, total = [], 0.0
    for r in sorted(body.ranges or [], key=lambda r: r.start):
        st = max(0.0, float(r.start) - 0.1)
        en = min(float(r.end) + 0.15, st + CAST_CLIP_MAX_RANGE)
        if en - st < 0.3:
            continue
        if total + (en - st) > CAST_CLIP_MAX_TOTAL:
            en = st + (CAST_CLIP_MAX_TOTAL - total)
            if en - st < 0.3:
                break
        ranges.append((st, en))
        total += en - st
    if not ranges:
        raise HTTPException(status_code=400, detail="សូមជ្រើសឃ្លាយ៉ាងហោចណាស់ ១ ដែលតួនិយាយ")

    media_path = _project_media_path(project_key)
    if not media_path:
        raise HTTPException(status_code=404, detail="រកមិនឃើញវីដេអូនេះលើ Server — សូម Upload ម្តងទៀត")
    audio_path = os.path.join(OUTPUTS_DIR, f"audio_{os.path.splitext(os.path.basename(project_key))[0]}.mp3")
    if not os.path.exists(audio_path):
        await asyncio.to_thread(audio_processor.extract_audio, media_path, audio_path)

    owner_key, user_id = _cast_owner(request)
    ts = int(time.time() * 1000)
    sample_filename = build_sample_filename(owner_key, project_key, speaker_key, ts)
    dest_path = os.path.join(SAMPLES_DIR, sample_filename)
    clip_path = os.path.join(OUTPUTS_DIR, f"cast_clip_{ts}.wav")
    cleaned_path = None
    try:
        if not await asyncio.to_thread(_cut_voice_ranges, audio_path, ranges, clip_path):
            raise HTTPException(status_code=500, detail="កាត់សំឡេងពីវីដេអូមិនបាន (សូមពិនិត្យ FFmpeg)")
        source_path = clip_path
        if body.cleanVocals:
            from services import vocal_separator
            source_path = await asyncio.to_thread(vocal_separator.isolate_voice_sample, clip_path, OUTPUTS_DIR)
            if source_path != clip_path:
                cleaned_path = source_path
        if not await asyncio.to_thread(_normalize_cast_audio, source_path, dest_path):
            raise HTTPException(status_code=500, detail="រៀបចំសំឡេងក្លូនមិនបាន (សូមពិនិត្យ FFmpeg)")
    finally:
        for p in (clip_path, cleaned_path, os.path.join(OUTPUTS_DIR, f"cast_clip_{ts}_ai_bgm.wav")):
            try:
                if p and os.path.exists(p):
                    os.unlink(p)
            except Exception:
                pass

    original_name = f"ពីរឿង · {len(ranges)} ឃ្លា · {round(total)}s"
    entry = await _save_cast_entry(
        owner_key, user_id, project_key, speaker_key, body.marker, body.gender,
        sample_filename, dest_path, original_name, body.lineCount or 0,
    )
    return {'success': True, 'cast': {**entry, 'exists': True}, 'seconds': round(total, 1)}

@app.get('/api/cast/voices')
async def list_cast_voices(request: Request, projectKey: str):
    owner_key, _ = _cast_owner(request)
    casts = await asyncio.to_thread(cast_store.list, owner_key, projectKey.strip(), SAMPLES_DIR)
    return {'success': True, 'casts': casts, 'cloud': supabase_db.is_supabase_enabled()}

@app.delete('/api/cast/voices')
async def delete_cast_voice(request: Request, projectKey: str, speakerKey: str):
    owner_key, _ = _cast_owner(request)
    removed = await asyncio.to_thread(cast_store.delete, owner_key, projectKey.strip(), speakerKey.strip())
    if removed:
        _remove_cast_sample(removed.get('filename'))
    return {'success': True, 'removed': bool(removed)}

class GeminiTestRequest(BaseModel):
    key: Optional[str] = None

@app.post('/api/gemini/test')
async def gemini_test(body: GeminiTestRequest):
    """Check a Gemini key (the one typed in Settings, or the saved one) and list usable models."""
    from services import gemini_client
    return await asyncio.to_thread(gemini_client.test_key, (body.key or '').strip() or None)

class DetectEmotionTextRequest(BaseModel):
    text: str

@app.post('/api/text/detect-emotion')
async def detect_emotion_from_text(body: DetectEmotionTextRequest):
    """
    Gemini: analyze one line of Khmer dialogue and return
    {emotion, intensity, instruction} for voice-acting direction.
    GEMINI_API_KEY stays server-side only; the frontend never sees it.
    """
    from services import gemini_client
    clean_text = clean_pure_khmer(body.text) or body.text.strip()
    result = await asyncio.to_thread(gemini_client.analyze_text_emotion, clean_text)
    if not result.get('success'):
        status = 400 if not gemini_client.get_key() else 502
        raise HTTPException(status_code=status, detail=result.get('error') or 'Gemini emotion detection failed')
    return result

@app.get('/api/supabase/status')
async def supabase_status(refresh: bool = False):
    return await asyncio.to_thread(supabase_db.get_status, refresh)

# --- Project Persistence (Never lose project data on browser reload) ---
PROJECT_DATA_FILE = os.path.join(DATA_DIR, 'active_project.json')

@app.post('/api/project/save')
async def save_project_state(request: Request):
    try:
        data = await request.json()
        with open(PROJECT_DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return {'success': True, 'message': 'Project state saved successfully'}
    except Exception as e:
        print(f"Error saving project: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/api/project/load')
def load_project_state():
    if not os.path.exists(PROJECT_DATA_FILE):
        return {'success': True, 'project': None}
    try:
        with open(PROJECT_DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {'success': True, 'project': data}
    except Exception as e:
        print(f"Error loading project: {e}")
        return {'success': False, 'project': None, 'error': str(e)}

@app.post('/api/project/clear')
def clear_project_state():
    try:
        if os.path.exists(PROJECT_DATA_FILE):
            os.remove(PROJECT_DATA_FILE)
        return {'success': True, 'message': 'Project state cleared'}
    except Exception as e:
        print(f"Error clearing project: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────────────────────
# VIDEO SHELF (10 VIDEO STORAGE CAPACITY) & PROJECT GROUPS
# ─────────────────────────────────────────────────────────────────────────────
SHELF_FILE = os.path.join(DATA_DIR, 'video_shelf.json')
GROUPS_FILE = os.path.join(DATA_DIR, 'project_groups.json')

def load_video_shelf() -> list:
    if os.path.exists(SHELF_FILE):
        try:
            with open(SHELF_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def save_video_shelf(shelf: list):
    with open(SHELF_FILE, 'w', encoding='utf-8') as f:
        json.dump(shelf, f, ensure_ascii=False, indent=2)

def load_project_groups() -> list:
    if os.path.exists(GROUPS_FILE):
        try:
            with open(GROUPS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    defaults = [
        {"id": "grp_all", "name": "ទូទៅ (General)", "color": "cyan", "description": "គម្រោងវីដេអូទូទៅ", "createdAt": datetime.now().isoformat()},
        {"id": "grp_chinese_drama", "name": "រឿង ដាវទេពយុទ្ធសិល្ប៍", "color": "purple", "description": "ស៊េរីភាពយន្តភាគចិនបុរាណ", "createdAt": datetime.now().isoformat()},
        {"id": "grp_anime_action", "name": "រឿង Anime Action", "color": "emerald", "description": "គំនូរជីវចលផ្សងព្រេង", "createdAt": datetime.now().isoformat()}
    ]
    save_project_groups(defaults)
    return defaults

def save_project_groups(groups: list):
    with open(GROUPS_FILE, 'w', encoding='utf-8') as f:
        json.dump(groups, f, ensure_ascii=False, indent=2)

@app.get('/api/shelf')
def get_video_shelf():
    shelf = load_video_shelf()
    groups = load_project_groups()
    return {
        'success': True,
        'shelf': shelf,
        'count': len(shelf),
        'maxSlots': 10,
        'usedSlots': len(shelf),
        'remainingSlots': max(0, 10 - len(shelf)),
        'groups': groups
    }

@app.post('/api/shelf/add')
def add_video_to_shelf(body: AddShelfVideoRequest, request: Request):
    """
    Add video to local storage tracking (database only stores metadata, not files)
    វីដេអូរក្សាទុកក្នុង Computer មិនធ្ងន់ Database
    """
    user = get_request_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="សូមចូលប្រើប្រាស់ជាមុនសិន")
    
    shelf = load_video_shelf()
    if len(shelf) >= 10:
        raise HTTPException(
            status_code=400,
            detail="ឃ្លាំងផ្ទុកវីដេអូបានកំណត់អតិបរមាត្រឹម ១០ វីដេអូប៉ុណ្ណោះ! សូមលុបវីដេអូចាស់ខ្លះចេញជាមុនសិន។"
        )
    
    # Check if already in shelf
    for s in shelf:
        if s.get('filename') == body.filename:
            return {'success': True, 'message': 'វីដេអូនេះមានក្នុងឃ្លាំងរួចហើយ', 'item': s, 'shelf': shelf, 'count': len(shelf)}

    # Local path in computer (NOT stored in database, only reference)
    local_path = os.path.join(UPLOADS_DIR, body.filename)
    
    item_id = f"shelf_{int(time.time() * 1000)}"
    new_item = {
        'id': item_id,
        'user_id': user['id'],
        'filename': body.filename,
        'originalName': body.originalName or body.filename,
        'localPath': local_path,  # Path to local computer storage
        'size': body.size or 0,
        'duration': body.duration or 0,
        'thumbnail': body.thumbnail,
        'url': f"/media/uploads/{body.filename}",
        'groupId': body.groupId or 'grp_all',
        'groupName': body.groupName or 'ទូទៅ (General)',
        'addedAt': datetime.now().isoformat()
    }
    shelf.append(new_item)
    save_video_shelf(shelf)
    return {'success': True, 'message': 'បានបន្ថែមវីដេអូទៅកាន់ឃ្លាំងជោគជ័យ (Local Storage)', 'item': new_item, 'shelf': shelf, 'count': len(shelf)}

@app.delete('/api/shelf/{item_id}')
def remove_video_from_shelf(item_id: str):
    shelf = load_video_shelf()
    initial_len = len(shelf)
    shelf = [s for s in shelf if s.get('id') != item_id]
    if len(shelf) == initial_len:
        raise HTTPException(status_code=404, detail="រកមិនឃើញវីដេអូក្នុងឃ្លាំងឡើយ")
    save_video_shelf(shelf)
    return {'success': True, 'message': 'បានលុបវីដេអូចេញពីឃ្លាំងរួចរាល់', 'shelf': shelf, 'count': len(shelf), 'usedSlots': len(shelf)}

@app.put('/api/shelf/{item_id}/group')
def update_shelf_video_group(item_id: str, body: UpdateShelfVideoGroupRequest):
    shelf = load_video_shelf()
    updated = False
    for s in shelf:
        if s.get('id') == item_id:
            s['groupId'] = body.groupId or 'grp_all'
            s['groupName'] = body.groupName or 'ទូទៅ'
            updated = True
            break
    if not updated:
        raise HTTPException(status_code=404, detail="រកមិនឃើញវីដេអូក្នុងឃ្លាំងឡើយ")
    save_video_shelf(shelf)
    return {'success': True, 'shelf': shelf}

# --- Project & Series Groups Endpoints ---
@app.get('/api/groups')
def get_project_groups():
    groups = load_project_groups()
    shelf = load_video_shelf()
    counts = {}
    for s in shelf:
        gid = s.get('groupId', 'grp_all')
        counts[gid] = counts.get(gid, 0) + 1
    augmented = []
    for g in groups:
        augmented.append({
            **g,
            'videoCount': counts.get(g['id'], 0)
        })
    return {'success': True, 'groups': augmented}

@app.post('/api/groups/create')
def create_project_group(body: CreateProjectGroupRequest):
    groups = load_project_groups()
    clean_name = body.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="សូមបញ្ចូលឈ្មោះ Group រឿង")
    new_grp = {
        'id': f"grp_{int(time.time() * 1000)}",
        'name': clean_name,
        'color': body.color or 'cyan',
        'description': body.description or '',
        'maleLeadVoice': body.maleLeadVoice or '',
        'femaleLeadVoice': body.femaleLeadVoice or '',
        'narratorVoice': body.narratorVoice or '',
        'supportingVoice': body.supportingVoice or '',
        'createdAt': datetime.now().isoformat()
    }
    groups.append(new_grp)
    save_project_groups(groups)
    return {'success': True, 'group': new_grp, 'groups': groups}

@app.put('/api/groups/{group_id}')
def update_project_group(group_id: str, body: UpdateProjectGroupRequest):
    groups = load_project_groups()
    matched = None
    for g in groups:
        if g['id'] == group_id:
            if body.name is not None: g['name'] = body.name.strip()
            if body.color is not None: g['color'] = body.color
            if body.description is not None: g['description'] = body.description
            if body.maleLeadVoice is not None: g['maleLeadVoice'] = body.maleLeadVoice
            if body.femaleLeadVoice is not None: g['femaleLeadVoice'] = body.femaleLeadVoice
            if body.narratorVoice is not None: g['narratorVoice'] = body.narratorVoice
            if body.supportingVoice is not None: g['supportingVoice'] = body.supportingVoice
            matched = g
            break
    if not matched:
        raise HTTPException(status_code=404, detail="រកមិនឃើញ Group រឿងនេះទេ")
    save_project_groups(groups)
    return {'success': True, 'group': matched, 'groups': groups}

@app.delete('/api/groups/{group_id}')
def delete_project_group(group_id: str):
    if group_id == 'grp_all':
        raise HTTPException(status_code=400, detail="មិនអាចលុប Group ទូទៅបានទេ")
    groups = load_project_groups()
    groups = [g for g in groups if g['id'] != group_id]
    save_project_groups(groups)
    # Reassign shelf videos in this group to grp_all
    shelf = load_video_shelf()
    for s in shelf:
        if s.get('groupId') == group_id:
            s['groupId'] = 'grp_all'
            s['groupName'] = 'ទូទៅ (General)'
    save_video_shelf(shelf)
    return {'success': True, 'groups': groups}

# --- Hardware Acceleration & Performance Endpoint ---
@app.get('/api/system/hardware')
def get_hardware_info():
    cpu_cores = os.cpu_count() or 4
    encoder, enc_flags = audio_processor.detect_best_video_encoder()
    if encoder == 'h264_nvenc':
        gpu_label = "NVIDIA NVENC (GPU Accelerated)"
    elif encoder == 'h264_amf':
        gpu_label = "AMD AMF (GPU Accelerated)"
    elif encoder == 'h264_qsv':
        gpu_label = "Intel QuickSync (QSV)"
    elif encoder == 'h264_videotoolbox':
        gpu_label = "Apple VideoToolbox (Metal)"
    else:
        gpu_label = "CPU Multi-Core Ultrafast"
    is_gpu = encoder != 'libx264'
    return {
        'cpuCores': cpu_cores,
        'cpuThreads': cpu_cores,
        'videoEncoder': encoder,
        'encoderLabel': gpu_label,
        'isGpuAccelerated': is_gpu,
        'turboConcurrency': min(16, max(4, cpu_cores * 2)),
        'hardwareTier': "Ultra High Performance" if cpu_cores >= 8 or is_gpu else "Standard Fast",
        'performanceMode': 'turbo_max'
    }

@app.get('/api/system/network-info')
def get_network_info():
    port = int(os.getenv('PORT', 3000))
    lan_addrs = get_lan_addresses(port)
    return {
        'port': port,
        'localUrl': f"http://localhost:{port}",
        'lanAddresses': lan_addrs,
        'primaryLanUrl': lan_addrs[0]['url'] if lan_addrs else f"http://localhost:{port}"
    }

# --- 2026 Checkpoint & In-App Auto-Update System ---
@app.get('/api/system/version')
def get_system_version():
    """Get current version info and metadata."""
    return auto_updater.get_local_version_info()

@app.post('/api/system/check-update')
def check_system_update():
    """Actively check for new updates from remote GitHub / Supabase / Cloud server."""
    try:
        return auto_updater.check_for_updates(force_remote=True)
    except Exception as e:
        print(f"[API] check_system_update error: {e}")
        return auto_updater.get_local_version_info()

@app.post('/api/system/apply-update')
@app.post('/api/system/update')
async def apply_system_update(req: Optional[dict] = None):
    """
    Download patch from download_url and hot-apply into public/ and services/
    without reinstalling the EXE. Automatically creates a safety Checkpoint first!
    """
    local_info = auto_updater.get_local_version_info()
    target_ver = (req.get('target_version') if req else None) or local_info.get('latest_version')
    download_url = (req.get('download_url') if req else None) or local_info.get('download_url', '').strip()

    if download_url:
        try:
            zip_path = auto_updater.download_patch(download_url)
            result = auto_updater.apply_update_from_zip(
                zip_path=zip_path,
                target_version=target_ver,
                changelog=local_info.get('changelog')
            )
            # Remove temp zip
            try:
                os.unlink(zip_path)
            except Exception:
                pass
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        # Symbolic version update if no download URL provided
        pre_cp = checkpoint_manager.create_checkpoint(
            name=f"Backup មុន Update {target_ver}",
            cp_type="pre_update",
            version=local_info.get('current_version')
        )
        local_info['current_version'] = target_ver
        local_info['has_update'] = False
        local_info['applied_at'] = datetime.now().isoformat()
        with open(VERSION_FILE, 'w', encoding='utf-8') as f:
            json.dump(local_info, f, ensure_ascii=False, indent=2)
        return {
            "success": True,
            "message": f"បាន Update ទៅ {target_ver} ជោគជ័យ!",
            "new_version": target_ver,
            "pre_checkpoint_id": pre_cp['id'],
            "files_updated": False
        }

@app.post('/api/system/upload-patch')
async def upload_system_patch(file: UploadFile = File(...)):
    """Upload and install a patch ZIP directly (Offline / Direct update)."""
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="សូមជ្រើសរើសឯកសារ .zip update patch")

    temp_zip = os.path.join(DATA_DIR, 'updates', f"uploaded_{int(time.time())}.zip")
    os.makedirs(os.path.dirname(temp_zip), exist_ok=True)
    try:
        with open(temp_zip, 'wb') as f:
            content = await file.read()
            f.write(content)

        result = auto_updater.apply_update_from_zip(temp_zip)
        try:
            os.unlink(temp_zip)
        except Exception:
            pass
        return result
    except Exception as e:
        if os.path.exists(temp_zip):
            try:
                os.unlink(temp_zip)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=str(e))

# --- Checkpoints & Restore Endpoints ---
@app.get('/api/system/checkpoints')
def get_system_checkpoints():
    """List all available checkpoints and snapshots."""
    items = checkpoint_manager.list_checkpoints()
    return {
        'success': True,
        'checkpoints': items,
        'count': len(items),
        'current_version': checkpoint_manager.get_current_app_version()
    }

class CreateCheckpointRequest(BaseModel):
    name: Optional[str] = None
    note: Optional[str] = None

@app.post('/api/system/checkpoints/create')
def create_system_checkpoint(body: CreateCheckpointRequest = CreateCheckpointRequest()):
    """Create a manual checkpoint snapshot of current frontend and backend."""
    try:
        cp = checkpoint_manager.create_checkpoint(
            name=body.name,
            cp_type="manual",
            note=body.note or ""
        )
        return {
            'success': True,
            'message': f"បានបង្កើត Checkpoint '{cp['name']}' ជោគជ័យ!",
            'checkpoint': cp
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class RestoreCheckpointRequest(BaseModel):
    checkpoint_id: str

@app.post('/api/system/checkpoints/restore')
def restore_system_checkpoint(body: RestoreCheckpointRequest):
    """Restore application state and files from a specified checkpoint."""
    try:
        result = checkpoint_manager.restore_checkpoint(body.checkpoint_id)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete('/api/system/checkpoints/{checkpoint_id}')
def delete_system_checkpoint(checkpoint_id: str):
    """Delete a checkpoint snapshot."""
    ok = checkpoint_manager.delete_checkpoint(checkpoint_id)
    if not ok:
        raise HTTPException(status_code=404, detail="រកមិនឃើញ Checkpoint សម្រាប់លុបឡើយ")
    return {'success': True, 'message': 'បានលុប Checkpoint រួចរាល់'}

@app.post('/api/system/update/rollback')
def rollback_system_update():
    """Rollback to the latest available checkpoint."""
    cps = checkpoint_manager.list_checkpoints()
    if not cps:
        raise HTTPException(status_code=404, detail="មិនមាន Checkpoint ឬ Backup សម្រាប់ Rollback ឡើយ")
    target_cp = cps[0]
    result = checkpoint_manager.restore_checkpoint(target_cp['id'])
    return result

@app.post('/api/system/admin/publish-update')
def publish_admin_update(req: dict):
    """Admin: publish new version info across all app instances."""
    info = auto_updater.get_local_version_info()
    cur = info.get('current_version', 'V2.1PRO')
    new_ver = req.get('latest_version', cur)

    info['latest_version'] = new_ver
    info['has_update'] = (new_ver != cur)
    if 'changelog' in req:
        info['changelog'] = req['changelog']
    if 'download_url' in req:
        info['download_url'] = req['download_url']
    if 'patch_size_mb' in req:
        info['patch_size_mb'] = req['patch_size_mb']
    info['release_date'] = datetime.now().strftime('%Y-%m-%d')

    with open(VERSION_FILE, 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

    return {"success": True, "message": "បានទម្លាក់ Update ថ្មីជោគជ័យ!", "version": info}


# ============================================================================
# 🔄 Auto-Update System API Endpoints
# ============================================================================

@app.get('/api/update/status')
def get_update_status():
    """Get current update manager status."""
    try:
        update_mgr = get_update_manager()
        return {
            'success': True,
            'status': update_mgr.get_status()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/update/check')
def check_for_updates():
    """Check if new updates are available."""
    try:
        update_mgr = get_update_manager()
        result = update_mgr.check_for_updates()
        return {
            'success': True,
            'result': result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/update/download')
def download_update():
    """Download available updates."""
    try:
        update_mgr = get_update_manager()
        manifest = update_mgr.version_info.get('manifest')
        if not manifest:
            raise HTTPException(status_code=400, detail="គ្មាន Update ដើម្បី Download ទេ! សូម Check Update ជាមុនសិន។")
        
        result = update_mgr.download_update(manifest)
        if result.get('status') == 'success':
            return {
                'success': True,
                'message': 'ទាញយក Update ជោគជ័យ!',
                'result': result
            }
        else:
            return {
                'success': False,
                'message': result.get('error', 'Download failed'),
                'result': result
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/update/install')
def install_update():
    """Install downloaded updates."""
    try:
        update_mgr = get_update_manager()
        result = update_mgr.install_update(backup=True)
        
        if result.get('status') == 'success':
            # Reload updated modules
            module_loader = get_module_loader()
            module_loader.reload_all()
            
            return {
                'success': True,
                'message': f"បាន Install Update ជោគជ័យ! Version: {result.get('version')}",
                'result': result
            }
        else:
            return {
                'success': False,
                'message': result.get('error', 'Installation failed'),
                'result': result
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/update/rollback')
def rollback_update():
    """Rollback to previous version."""
    try:
        update_mgr = get_update_manager()
        result = update_mgr.rollback_update()
        
        if result.get('status') == 'success':
            # Reload modules after rollback
            module_loader = get_module_loader()
            module_loader.reload_all()
            
            return {
                'success': True,
                'message': 'បាន Rollback ជោគជ័យ!',
                'result': result
            }
        else:
            return {
                'success': False,
                'message': result.get('error', 'Rollback failed'),
                'result': result
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/api/update/backups')
def list_backups():
    """List all available backup snapshots."""
    try:
        update_mgr = get_update_manager()
        backup_dir = update_mgr.backup_dir
        
        if not backup_dir.exists():
            return {
                'success': True,
                'backups': []
            }
        
        backups = []
        for backup_path in sorted(backup_dir.iterdir(), reverse=True):
            if backup_path.is_dir():
                # Get backup metadata
                stat = backup_path.stat()
                backups.append({
                    'name': backup_path.name,
                    'path': str(backup_path),
                    'date': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                    'size': sum(f.stat().st_size for f in backup_path.rglob('*') if f.is_file())
                })
        
        return {
            'success': True,
            'backups': backups,
            'count': len(backups)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RollbackRequest(BaseModel):
    backup_name: Optional[str] = None


@app.post('/api/update/rollback')
def rollback_to_backup(body: RollbackRequest = RollbackRequest()):
    """Rollback to a specific backup or latest."""
    try:
        update_mgr = get_update_manager()
        result = update_mgr.rollback_update(backup_name=body.backup_name)
        
        if result.get('status') == 'success':
            # Reload modules after rollback
            module_loader = get_module_loader()
            module_loader.reload_all()
            
            return {
                'success': True,
                'message': 'បាន Rollback ជោគជ័យ!',
                'result': result
            }
        else:
            return {
                'success': False,
                'message': result.get('error', 'Rollback failed'),
                'result': result
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/api/modules/list')
def list_loaded_modules():
    """List all dynamically loaded modules."""
    try:
        module_loader = get_module_loader()
        loaded = module_loader.list_loaded_modules()
        available = module_loader.scan_available_modules()
        
        return {
            'success': True,
            'loaded': loaded,
            'available': available
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ReloadModuleRequest(BaseModel):
    module_name: str


@app.post('/api/modules/reload')
def reload_module(body: ReloadModuleRequest):
    """Reload a specific module at runtime."""
    try:
        module_loader = get_module_loader()
        module = module_loader.reload_module(body.module_name)
        
        if module:
            return {
                'success': True,
                'message': f'បាន Reload Module "{body.module_name}" ជោគជ័យ!',
                'module_info': module_loader.get_module_info(body.module_name)
            }
        else:
            return {
                'success': False,
                'message': f'មិនអាច Reload Module "{body.module_name}" បានទេ!'
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/modules/reload-all')
def reload_all_modules():
    """Reload all loaded modules."""
    try:
        module_loader = get_module_loader()
        results = module_loader.reload_all()
        
        success_count = sum(1 for v in results.values() if v)
        total_count = len(results)
        
        return {
            'success': True,
            'message': f'បាន Reload {success_count}/{total_count} Modules ជោគជ័យ!',
            'results': results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================

@app.get('/mobile')
@app.get('/android')
def serve_mobile_app():
    mobile_file = os.path.join(PUBLIC_DIR, 'mobile.html')
    if os.path.exists(mobile_file):
        return FileResponse(mobile_file)
    raise HTTPException(status_code=404, detail="Mobile app not found")

# --- Static File Mounts ---
app.mount('/media/outputs', StaticFiles(directory=OUTPUTS_DIR), name='outputs')
app.mount('/media/samples', StaticFiles(directory=SAMPLES_DIR), name='samples')
app.mount('/media/uploads', StaticFiles(directory=UPLOADS_DIR), name='uploads')
app.mount('/', StaticFiles(directory=PUBLIC_DIR, html=True), name='public')

if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', 3000))
    print("====================================================")
    print("🎬 AI Voice Clone & Dubbing Studio (Python FastAPI)")
    print(f"💻 Local Machine:    http://localhost:{port}")
    print("====================================================")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
