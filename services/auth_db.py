import os
import sqlite3
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any

import sys
import shutil

if getattr(sys, 'frozen', False):
    APP_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = getattr(sys, '_MEIPASS', APP_DIR)
else:
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    BUNDLE_DIR = APP_DIR

DATA_DIR = os.path.join(APP_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'studio_auth.db')

# Auto-seed initial database if not yet existing on user's machine
from services import supabase_db

bundled_db = os.path.join(BUNDLE_DIR, 'data', 'studio_auth.db')
if not os.path.exists(DB_PATH) and os.path.exists(bundled_db):
    try:
        shutil.copy2(bundled_db, DB_PATH)
    except Exception:
        pass

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize SQLite tables for users, single-device sessions, and license keys."""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            tier TEXT NOT NULL DEFAULT 'free',
            premium_expires_at TEXT,
            has_voxcpm_license INTEGER DEFAULT 0,
            voxcpm_license_expires_at TEXT,
            voxcpm_license_key TEXT,
            current_device_id TEXT,
            created_at TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        )
    ''')
    
    cur.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            device_id TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS license_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_code TEXT UNIQUE NOT NULL COLLATE NOCASE,
            feature TEXT NOT NULL DEFAULT 'voxcpm2',
            days_valid INTEGER NOT NULL DEFAULT 30,
            is_used INTEGER DEFAULT 0,
            used_by_user_id INTEGER,
            used_by_username TEXT,
            used_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(used_by_user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()

    # Safely ensure all columns exist if upgrading an existing SQLite database
    for col, col_def in [
        ('has_voxcpm_license', 'INTEGER DEFAULT 0'),
        ('voxcpm_license_expires_at', 'TEXT'),
        ('voxcpm_license_key', 'TEXT'),
        ('current_device_id', 'TEXT'),
        # Subscription: which paid plan ('monthly' or 'unlimited'), alongside the
        # existing tier/premium_expires_at this reuses for the paid/expiry check.
        # trial_exports_used counts a free account's lifetime renders against
        # STUDIO_TRIAL_EXPORTS (server.py) -- it only ever goes up.
        ('plan', "TEXT DEFAULT 'free'"),
        ('trial_exports_used', 'INTEGER DEFAULT 0'),
    ]:
        try:
            cur.execute(f"ALTER TABLE users ADD COLUMN {col} {col_def}")
        except Exception:
            pass

    try:
        cur.execute("ALTER TABLE sessions ADD COLUMN device_id TEXT")
    except Exception:
        pass

    # Small key/value store for server-wide settings that must survive a
    # container rebuild (unlike .env, this lives in the same persisted
    # studio_data volume as the rest of this database) -- currently just
    # the operator's KHQR payment template.
    cur.execute('''
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT
        )
    ''')

    # One row per subscription QR issued, so a poll can tell whether it was
    # paid and a plan can be granted exactly once.
    cur.execute('''
        CREATE TABLE IF NOT EXISTS subscription_orders (
            ticket TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            plan TEXT NOT NULL,
            amount_usd REAL NOT NULL,
            qr_payload TEXT NOT NULL,
            qr_md5 TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            paid_at TEXT,
            bank_hash TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')
    conn.commit()

    # Pre-seed the exclusive Master Admin: cm5722254@gmail.com
    admin_email = ADMIN_EMAIL
    admin_pwd = admin_password()
    
    # Remove old placeholder admin account
    cur.execute("DELETE FROM users WHERE username = 'admin'")
    
    # Demote any other account to 'user' so only cm5722254@gmail.com is admin
    cur.execute("UPDATE users SET role = 'user' WHERE username != ? AND role = 'admin'", (admin_email,))

    cur.execute("SELECT id FROM users WHERE username = ?", (admin_email,))
    admin_row = cur.fetchone()
    salt = secrets.token_hex(16)
    pwd_hash = hash_password(admin_pwd, salt)
    now_iso = datetime.now().isoformat()

    if not admin_row:
        cur.execute('''
            INSERT INTO users (username, password_hash, salt, role, tier, has_voxcpm_license, created_at, is_active)
            VALUES (?, ?, ?, 'admin', 'premium', 1, ?, 1)
        ''', (admin_email, pwd_hash, salt, now_iso))
    else:
        cur.execute('''
            UPDATE users 
            SET password_hash = ?, salt = ?, role = 'admin', tier = 'premium', has_voxcpm_license = 1, is_active = 1
            WHERE username = ?
        ''', (pwd_hash, salt, admin_email))
    conn.commit()
    conn.close()

    # Sync Master Admin to Supabase if enabled (a server-mode password stays on that server only)
    if supabase_db.is_supabase_enabled() and not PUBLIC_MODE:
        try:
            existing = supabase_db.sb_get('users', {'username': f'eq.{admin_email}'})
            if not existing:
                supabase_db.sb_post('users', {
                    'username': admin_email,
                    'password_hash': pwd_hash,
                    'salt': salt,
                    'role': 'admin',
                    'tier': 'premium',
                    'has_voxcpm_license': 1,
                    'created_at': now_iso,
                    'is_active': 1
                })
            else:
                supabase_db.sb_patch('users', {'username': f'eq.{admin_email}'}, {
                    'password_hash': pwd_hash,
                    'salt': salt,
                    'role': 'admin',
                    'tier': 'premium',
                    'has_voxcpm_license': 1,
                    'is_active': 1
                })
        except Exception as e:
            print(f"Supabase admin sync warning: {e}")

ADMIN_EMAIL = "cm5722254@gmail.com"
PUBLIC_MODE = os.getenv('STUDIO_PUBLIC_MODE', '0') == '1'
_BUILTIN_ADMIN_PASSWORD = "@Iam_Cheatm2"


def admin_password() -> str:
    """STUDIO_ADMIN_PASSWORD overrides the built-in password. In server (VPS) mode it is
    required: the built-in one ships inside every copy of the app."""
    pwd = (os.getenv('STUDIO_ADMIN_PASSWORD') or '').strip()
    if pwd:
        return pwd
    if PUBLIC_MODE:
        raise SystemExit(
            "STUDIO_PUBLIC_MODE=1 requires STUDIO_ADMIN_PASSWORD in .env "
            "(the built-in admin password is not safe on a public server)."
        )
    return _BUILTIN_ADMIN_PASSWORD


def hash_password(password: str, salt: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with 100,000 iterations."""
    return hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    ).hex()

def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    """Verify password against salt and hash."""
    return secrets.compare_digest(hash_password(password, salt), expected_hash)

def check_and_expire_subscription(user: Dict[str, Any]) -> Dict[str, Any]:
    """Auto-check if user's premium or VoxCPM2 license has expired."""
    if user.get('role') == 'admin':
        user['tier'] = 'premium'
        user['plan'] = 'unlimited'
        user['has_voxcpm_license'] = 1
        return user

    conn = None

    # Check Premium expiration
    if user.get('tier') == 'premium':
        expires_at_str = user.get('premium_expires_at')
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(str(expires_at_str).replace('Z', '+00:00')).replace(tzinfo=None)
                if datetime.now() >= expires_at:
                    if not conn:
                        conn = get_db()
                    cur = conn.cursor()
                    cur.execute('UPDATE users SET tier = "free", premium_expires_at = NULL, plan = "free" WHERE id = ?', (user['id'],))
                    conn.commit()
                    user['tier'] = 'free'
                    user['premium_expires_at'] = None
                    user['plan'] = 'free'
                    if supabase_db.is_supabase_enabled():
                        supabase_db.sb_patch('users', {'id': f"eq.{user['id']}"}, {'tier': 'free', 'premium_expires_at': None, 'plan': 'free'})
            except Exception as e:
                print(f"Error checking subscription expiration: {e}")

    # Check VoxCPM2 License expiration
    if user.get('has_voxcpm_license'):
        vox_exp_str = user.get('voxcpm_license_expires_at')
        if vox_exp_str:
            try:
                vox_exp = datetime.fromisoformat(str(vox_exp_str).replace('Z', '+00:00')).replace(tzinfo=None)
                if datetime.now() >= vox_exp:
                    if not conn:
                        conn = get_db()
                    cur = conn.cursor()
                    cur.execute('UPDATE users SET has_voxcpm_license = 0, voxcpm_license_expires_at = NULL WHERE id = ?', (user['id'],))
                    conn.commit()
                    user['has_voxcpm_license'] = 0
                    user['voxcpm_license_expires_at'] = None
                    if supabase_db.is_supabase_enabled():
                        supabase_db.sb_patch('users', {'id': f"eq.{user['id']}"}, {'has_voxcpm_license': 0, 'voxcpm_license_expires_at': None})
            except Exception as e:
                print(f"Error checking VoxCPM2 license expiration: {e}")

    if conn:
        conn.close()

    return user

def register_user(username: str, password: str, device_id: Optional[str] = None) -> Dict[str, Any]:
    """Register a new user (defaults to Role: user, Tier: free, VoxCPM2: LOCKED)."""
    username = username.strip()
    if len(username) < 3:
        raise ValueError("ឈ្មោះគណនីត្រូវតែមានយ៉ាងតិច ៣ តួអក្សរ")
    if len(password) < 4:
        raise ValueError("ពាក្យសម្ងាត់ត្រូវតែមានយ៉ាងតិច ៤ តួអក្សរ")

    # Check Supabase cloud first if enabled
    if supabase_db.is_supabase_enabled():
        sb_existing = supabase_db.sb_get('users', {'username': f'eq.{username}'})
        if sb_existing:
            raise ValueError("ឈ្មោះគណនីនេះត្រូវបានប្រើរួចហើយ សូមជ្រើសរើសឈ្មោះផ្សេង")

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE username = ?", (username,))
    if cur.fetchone():
        conn.close()
        raise ValueError("ឈ្មោះគណនីនេះត្រូវបានប្រើរួចហើយ សូមជ្រើសរើសឈ្មោះផ្សេង")

    salt = secrets.token_hex(16)
    pwd_hash = hash_password(password, salt)
    now_iso = datetime.now().isoformat()

    role = 'user'
    tier = 'free'
    has_voxcpm = 0

    cur.execute('''
        INSERT INTO users (username, password_hash, salt, role, tier, has_voxcpm_license, current_device_id, created_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ''', (username, pwd_hash, salt, role, tier, has_voxcpm, device_id, now_iso))
    user_id = cur.lastrowid
    conn.commit()

    # Enforce 1 account = 1 device session strictly: clear any existing sessions
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    # Create new session
    token = secrets.token_hex(32)
    session_exp = (datetime.now() + timedelta(days=30)).isoformat()
    cur.execute('''
        INSERT INTO sessions (token, user_id, device_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (token, user_id, device_id or 'default', now_iso, session_exp))
    conn.commit()
    conn.close()

    # Sync to Supabase cloud
    if supabase_db.is_supabase_enabled():
        try:
            sb_user = supabase_db.sb_post('users', {
                'username': username,
                'password_hash': pwd_hash,
                'salt': salt,
                'role': role,
                'tier': tier,
                'has_voxcpm_license': has_voxcpm,
                'current_device_id': device_id,
                'created_at': now_iso,
                'is_active': 1
            })
            sb_user_id = sb_user[0]['id'] if sb_user else user_id
            supabase_db.sb_post('sessions', {
                'token': token,
                'user_id': sb_user_id,
                'device_id': device_id or 'default',
                'created_at': now_iso,
                'expires_at': session_exp
            })
        except Exception as e:
            print(f"Supabase sync on register error: {e}")

    return {
        'token': token,
        'user': {
            'id': user_id,
            'username': username,
            'role': role,
            'tier': tier,
            'has_voxcpm_license': False,
            'voxcpm_license_expires_at': None,
            'premium_expires_at': None,
            'device_id': device_id,
            'created_at': now_iso
        }
    }

def login_user(username: str, password: str, device_id: Optional[str] = None) -> Dict[str, Any]:
    """Authenticate user and enforce 1 ACCOUNT = 1 DEVICE SESSION ONLY."""
    username = username.strip()

    # Check Supabase cloud first if available. In server mode the admin is checked locally
    # only, so the built-in password synced to Supabase cannot open a VPS admin account.
    user_dict = None
    if supabase_db.is_supabase_enabled() and not (PUBLIC_MODE and username == ADMIN_EMAIL):
        sb_users = supabase_db.sb_get('users', {'username': f'eq.{username}', 'is_active': 'eq.1'})
        if sb_users:
            u = sb_users[0]
            if verify_password(password, u['salt'], u['password_hash']):
                user_dict = u
                # Mirror user into local SQLite cache
                conn_sync = get_db()
                cur_sync = conn_sync.cursor()
                cur_sync.execute("SELECT id FROM users WHERE username = ?", (username,))
                existing_local = cur_sync.fetchone()
                if not existing_local:
                    cur_sync.execute('''
                        INSERT INTO users (id, username, password_hash, salt, role, tier, has_voxcpm_license, voxcpm_license_expires_at, premium_expires_at, current_device_id, created_at, is_active)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (u['id'], u['username'], u['password_hash'], u['salt'], u['role'], u['tier'], u.get('has_voxcpm_license', 0), u.get('voxcpm_license_expires_at'), u.get('premium_expires_at'), device_id, u.get('created_at'), 1))
                else:
                    cur_sync.execute('''
                        UPDATE users SET password_hash = ?, salt = ?, role = ?, tier = ?, has_voxcpm_license = ?, voxcpm_license_expires_at = ?, premium_expires_at = ?, current_device_id = ?
                        WHERE username = ?
                    ''', (u['password_hash'], u['salt'], u['role'], u['tier'], u.get('has_voxcpm_license', 0), u.get('voxcpm_license_expires_at'), u.get('premium_expires_at'), device_id, username))
                conn_sync.commit()
                conn_sync.close()

    if not user_dict:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,))
        row = cur.fetchone()
        if not row:
            conn.close()
            raise ValueError("ឈ្មោះគណនី ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវទេ")

        user_dict = dict(row)
        if not verify_password(password, user_dict['salt'], user_dict['password_hash']):
            conn.close()
            raise ValueError("ឈ្មោះគណនី ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវទេ")
        conn.close()

    return _start_session(user_dict, device_id)


def _start_session(user_dict: Dict[str, Any], device_id: Optional[str]) -> Dict[str, Any]:
    """Open the account's only session (1 account = 1 device) and return the login payload."""
    # Auto-expire check
    user_dict = check_and_expire_subscription(user_dict)

    # ─────────────────────────────────────────────────────────────
    # CRITICAL: ENFORCE 1 ACCOUNT = 1 DEVICE ONLY!
    # Invalidate and delete ALL prior sessions for this user_id!
    # ─────────────────────────────────────────────────────────────
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_dict['id'],))

    token = secrets.token_hex(32)
    now_iso = datetime.now().isoformat()
    session_exp = (datetime.now() + timedelta(days=30)).isoformat()

    cur.execute('''
        INSERT INTO sessions (token, user_id, device_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (token, user_dict['id'], device_id or 'default', now_iso, session_exp))

    cur.execute("UPDATE users SET current_device_id = ? WHERE id = ?", (device_id, user_dict['id']))
    conn.commit()
    conn.close()

    # Sync to Supabase cloud
    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_delete('sessions', {'user_id': f"eq.{user_dict['id']}"})
            supabase_db.sb_post('sessions', {
                'token': token,
                'user_id': user_dict['id'],
                'device_id': device_id or 'default',
                'created_at': now_iso,
                'expires_at': session_exp
            })
            supabase_db.sb_patch('users', {'id': f"eq.{user_dict['id']}"}, {'current_device_id': device_id})
        except Exception as e:
            print(f"Supabase login sync error: {e}")

    has_voxcpm = bool(user_dict.get('has_voxcpm_license') or user_dict.get('role') == 'admin')

    return {
        'token': token,
        'user': {
            'id': user_dict['id'],
            'username': user_dict['username'],
            'role': user_dict['role'],
            'tier': user_dict['tier'],
            'has_voxcpm_license': has_voxcpm,
            'voxcpm_license_expires_at': user_dict.get('voxcpm_license_expires_at'),
            'premium_expires_at': user_dict.get('premium_expires_at'),
            'device_id': device_id,
            'created_at': user_dict['created_at']
        }
    }

def login_telegram_user(tg_user: Dict[str, Any], device_id: Optional[str] = None,
                        make_admin: bool = False, allow_signup: bool = True) -> Dict[str, Any]:
    """Log in (or create on first use) the account bound to a verified Telegram user.
    The account is local only: its username is tg_<id> and it has no usable password."""
    tg_id = str(tg_user.get('id') or '').strip()
    if not tg_id.isdigit():
        raise ValueError("Telegram user id មិនត្រឹមត្រូវ")
    username = f"tg_{tg_id}"
    display = (tg_user.get('username') and f"@{tg_user['username']}") or tg_user.get('first_name') or username

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cur.fetchone()
    if row is None:
        if not allow_signup:
            conn.close()
            raise PermissionError("Server នេះបិទការបង្កើតគណនីថ្មី — សូមឲ្យ Admin បើកឲ្យ")
        salt = secrets.token_hex(16)
        pwd_hash = hash_password(secrets.token_hex(32), salt)  # never typed: Telegram is the login
        cur.execute('''
            INSERT INTO users (username, password_hash, salt, role, tier, has_voxcpm_license, current_device_id, created_at, is_active)
            VALUES (?, ?, ?, ?, 'free', ?, ?, ?, 1)
        ''', (username, pwd_hash, salt, 'admin' if make_admin else 'user', 1 if make_admin else 0, device_id, datetime.now().isoformat()))
        conn.commit()
        print(f"New Telegram account {username} ({display})")
    elif make_admin and row['role'] != 'admin':
        cur.execute("UPDATE users SET role = 'admin', has_voxcpm_license = 1 WHERE username = ?", (username,))
        conn.commit()
    cur.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,))
    row = cur.fetchone()
    conn.close()
    if row is None:
        raise PermissionError("គណនីនេះត្រូវបានបិទ")
    result = _start_session(dict(row), device_id or f"telegram:{tg_id}")
    result['user']['displayName'] = display
    return result


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    """Retrieve and validate user from active session token."""
    if not token:
        return None

    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        SELECT u.* FROM users u
        INNER JOIN sessions s ON s.user_id = u.id
        WHERE s.token = ? AND u.is_active = 1
    ''', (token,))
    row = cur.fetchone()
    conn.close()

    if row:
        user_dict = dict(row)
        user_dict = check_and_expire_subscription(user_dict)
        user_dict.pop('password_hash', None)
        user_dict.pop('salt', None)
        user_dict['has_voxcpm_license'] = bool(user_dict.get('has_voxcpm_license') or user_dict.get('role') == 'admin')
        return user_dict

    # Check Supabase if enabled
    if supabase_db.is_supabase_enabled():
        try:
            sb_sessions = supabase_db.sb_get('sessions', {'token': f'eq.{token}'})
            if sb_sessions:
                s = sb_sessions[0]
                sb_users = supabase_db.sb_get('users', {'id': f"eq.{s['user_id']}", 'is_active': 'eq.1'})
                if sb_users:
                    u = sb_users[0]
                    u = check_and_expire_subscription(u)
                    u.pop('password_hash', None)
                    u.pop('salt', None)
                    u['has_voxcpm_license'] = bool(u.get('has_voxcpm_license') or u.get('role') == 'admin')
                    return u
        except Exception as e:
            print(f"Supabase get_user_by_token error: {e}")

    return None

def logout_user(token: str):
    """Delete session token."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_delete('sessions', {'token': f'eq.{token}'})
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# LICENSE KEY MANAGEMENT (VOXCPM2 ACCESS CONTROL)
# ─────────────────────────────────────────────────────────────────────────────

def get_license_tier_label(days: int) -> str:
    """Return friendly Khmer label for standard license tiers."""
    if days == 7:
        return "សាកល្បង ៧ ថ្ងៃ (7-Day Trial)"
    elif days == 30:
        return "១ ខែ (1 Month)"
    elif days == 365:
        return "១ ឆ្នាំ (1 Year)"
    elif days == -1 or days <= 0:
        return "ជារៀងរហូត (Lifetime VIP)"
    return f"{days} ថ្ងៃ"

def create_license_key(days_valid: int = 30, feature: str = 'voxcpm2') -> Dict[str, Any]:
    """Generate a new secure License Key (Admin Only). Format: VOX-XXXX-XXXX-XXXX"""
    part1 = secrets.token_hex(2).upper()
    part2 = secrets.token_hex(2).upper()
    part3 = secrets.token_hex(2).upper()
    key_code = f"VOX-{part1}-{part2}-{part3}"
    now_iso = datetime.now().isoformat()
    # Normalize lifetime
    normalized_days = -1 if days_valid <= 0 else days_valid

    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO license_keys (key_code, feature, days_valid, is_used, created_at)
        VALUES (?, ?, ?, 0, ?)
    ''', (key_code, feature, normalized_days, now_iso))
    key_id = cur.lastrowid
    conn.commit()
    conn.close()

    # Sync to Supabase cloud
    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_post('license_keys', {
                'key_code': key_code,
                'feature': feature,
                'days_valid': normalized_days,
                'is_used': 0,
                'created_at': now_iso
            })
        except Exception as e:
            print(f"Supabase create key error: {e}")

    return {
        'id': key_id,
        'key_code': key_code,
        'feature': feature,
        'days_valid': normalized_days,
        'tier_label': get_license_tier_label(normalized_days),
        'is_used': False,
        'created_at': now_iso
    }

def activate_license_key(user_id: int, key_code: str) -> Dict[str, Any]:
    """Activate a VoxCPM2 license key for a user account."""
    clean_key = key_code.strip().upper()
    if not clean_key:
        raise ValueError("សូមបញ្ចូល Key License")

    # If Supabase is enabled, check Supabase key first
    sb_key = None
    if supabase_db.is_supabase_enabled():
        try:
            res = supabase_db.sb_get('license_keys', {'key_code': f'eq.{clean_key}'})
            if res:
                sb_key = res[0]
        except Exception:
            pass

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM license_keys WHERE key_code = ?", (clean_key,))
    key_row = cur.fetchone()

    if not key_row and not sb_key:
        conn.close()
        raise ValueError("Key License មិនត្រឹមត្រូវទេ សូមពិនិត្យឡើងវិញ!")

    key_dict = sb_key if sb_key else dict(key_row)
    if key_dict.get('is_used'):
        conn.close()
        raise ValueError("Key License នេះត្រូវបានប្រើប្រាស់រួចហើយ!")

    cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user_row = cur.fetchone()
    if not user_row:
        conn.close()
        raise ValueError("រកមិនឃើញគណនីអ្នកប្រើប្រាស់ឡើយ")

    username = user_row['username']
    now = datetime.now()
    now_iso = now.isoformat()
    days = key_dict['days_valid']
    expires_at_iso = None if (days == -1 or days <= 0) else (now + timedelta(days=days)).isoformat()

    # Mark key as used in SQLite
    cur.execute('''
        UPDATE license_keys 
        SET is_used = 1, used_by_user_id = ?, used_by_username = ?, used_at = ?
        WHERE key_code = ?
    ''', (user_id, username, now_iso, clean_key))

    # Upgrade user to have VoxCPM2 in SQLite
    cur.execute('''
        UPDATE users 
        SET has_voxcpm_license = 1, voxcpm_license_expires_at = ?, voxcpm_license_key = ?
        WHERE id = ?
    ''', (expires_at_iso, clean_key, user_id))
    conn.commit()
    conn.close()

    # Sync key usage and user upgrade to Supabase cloud
    if supabase_db.is_supabase_enabled():
        try:
            sb_user = supabase_db.sb_get('users', {'username': f'eq.{username}'})
            sb_uid = sb_user[0]['id'] if sb_user else None
            supabase_db.sb_patch('license_keys', {'key_code': f'eq.{clean_key}'}, {
                'is_used': 1,
                'used_by_user_id': sb_uid,
                'used_by_username': username,
                'used_at': now_iso
            })
            supabase_db.sb_patch('users', {'username': f'eq.{username}'}, {
                'has_voxcpm_license': 1,
                'voxcpm_license_expires_at': expires_at_iso,
                'voxcpm_license_key': clean_key
            })
        except Exception as e:
            print(f"Supabase activate key sync error: {e}")


    tier_label = get_license_tier_label(days)

    return {
        'success': True,
        'message': f"បានបើកដំណើរការ VoxCPM2 ({tier_label}) ដោយជោគជ័យ!",
        'has_voxcpm_license': True,
        'voxcpm_license_expires_at': expires_at_iso,
        'tier_label': tier_label,
        'user': {
            'id': user_id,
            'username': username,
            'role': user_row['role'],
            'tier': user_row['tier'],
            'has_voxcpm_license': True,
            'voxcpm_license_expires_at': expires_at_iso
        }
    }

def list_license_keys() -> List[Dict[str, Any]]:
    """List all generated license keys for Admin inspection."""
    if supabase_db.is_supabase_enabled():
        try:
            sb_keys = supabase_db.sb_get('license_keys', {'order': 'id.desc'})
            if sb_keys is not None:
                for d in sb_keys:
                    d['tier_label'] = get_license_tier_label(d.get('days_valid', 30))
                return sb_keys
        except Exception as e:
            print(f"Supabase list_license_keys error: {e}")

    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, key_code, feature, days_valid, is_used, used_by_user_id, used_by_username, used_at, created_at
        FROM license_keys ORDER BY id DESC
    ''')
    rows = cur.fetchall()
    conn.close()
    res = []
    for r in rows:
        d = dict(r)
        d['tier_label'] = get_license_tier_label(d['days_valid'])
        res.append(d)
    return res

def delete_license_key(key_id: int):
    """Delete a license key from the system."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM license_keys WHERE id = ?", (key_id,))
    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_delete('license_keys', {'id': f'eq.{key_id}'})
        except Exception:
            pass

def admin_toggle_user_voxcpm(user_id: int, enable: bool, days: int = 30) -> Dict[str, Any]:
    """Directly toggle VoxCPM2 license for a user in the Admin console."""
    conn = get_db()
    cur = conn.cursor()
    
    exp_iso = None
    if enable:
        now = datetime.now()
        exp_iso = (now + timedelta(days=days)).isoformat() if days != -1 else None
        cur.execute('''
            UPDATE users SET has_voxcpm_license = 1, voxcpm_license_expires_at = ? WHERE id = ?
        ''', (exp_iso, user_id))
    else:
        cur.execute('''
            UPDATE users SET has_voxcpm_license = 0, voxcpm_license_expires_at = NULL WHERE id = ?
        ''', (user_id,))
        
    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_patch('users', {'id': f'eq.{user_id}'}, {
                'has_voxcpm_license': 1 if enable else 0,
                'voxcpm_license_expires_at': exp_iso
            })
        except Exception:
            pass

    return {'id': user_id, 'has_voxcpm_license': enable}

# ─────────────────────────────────────────────────────────────────────────────
# USER ADMIN LISTING & MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

def sync_supabase_users_to_local(sb_users: List[Dict[str, Any]]):
    """Sync list of users from Supabase into local SQLite so local DB is always consistent."""
    if not sb_users:
        return
    try:
        conn = get_db()
        cur = conn.cursor()
        for u in sb_users:
            uid = u.get('id')
            uname = u.get('username')
            if not uid or not uname:
                continue
            cur.execute("DELETE FROM users WHERE username = ? AND id != ?", (uname, uid))
            cur.execute('''
                INSERT INTO users (id, username, password_hash, salt, role, tier, premium_expires_at, has_voxcpm_license, voxcpm_license_expires_at, voxcpm_license_key, current_device_id, created_at, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    username = excluded.username,
                    password_hash = excluded.password_hash,
                    salt = excluded.salt,
                    role = excluded.role,
                    tier = excluded.tier,
                    premium_expires_at = excluded.premium_expires_at,
                    has_voxcpm_license = excluded.has_voxcpm_license,
                    voxcpm_license_expires_at = excluded.voxcpm_license_expires_at,
                    voxcpm_license_key = excluded.voxcpm_license_key,
                    current_device_id = excluded.current_device_id,
                    is_active = excluded.is_active
            ''', (
                uid,
                uname,
                u.get('password_hash', ''),
                u.get('salt', ''),
                u.get('role', 'user'),
                u.get('tier', 'free'),
                u.get('premium_expires_at'),
                1 if u.get('has_voxcpm_license') else 0,
                u.get('voxcpm_license_expires_at'),
                u.get('voxcpm_license_key'),
                u.get('current_device_id'),
                u.get('created_at', datetime.now().isoformat()),
                u.get('is_active', 1)
            ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error syncing Supabase users to local: {e}")

def list_all_users() -> List[Dict[str, Any]]:
    """List all registered users for Admin panel."""
    if supabase_db.is_supabase_enabled():
        try:
            sb_users = supabase_db.sb_get('users', {'order': 'id.desc'})
            if sb_users is not None:
                sync_supabase_users_to_local(sb_users)
                res = []
                for u in sb_users:
                    u = check_and_expire_subscription(u)
                    u['has_voxcpm_license'] = bool(u.get('has_voxcpm_license') or u.get('role') == 'admin')
                    res.append(u)
                return res
        except Exception as e:
            print(f"Supabase list_all_users error: {e}")

    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, username, role, tier, premium_expires_at, has_voxcpm_license, voxcpm_license_expires_at, current_device_id, created_at, is_active 
        FROM users ORDER BY id DESC
    ''')
    rows = cur.fetchall()
    conn.close()

    users = []
    for r in rows:
        u = dict(r)
        u = check_and_expire_subscription(u)
        u['has_voxcpm_license'] = bool(u.get('has_voxcpm_license') or u.get('role') == 'admin')
        users.append(u)
    return users

def set_user_premium(user_id: int, days: int) -> Dict[str, Any]:
    """Grant Premium tier to a user with specific duration in days (or -1 for lifetime)."""
    user_row = None
    current_tier = 'free'
    current_exp = None

    # Check Supabase first if enabled
    if supabase_db.is_supabase_enabled():
        try:
            sb_users = supabase_db.sb_get('users', {'id': f'eq.{user_id}'})
            if sb_users:
                user_row = sb_users[0]
                current_tier = user_row.get('tier', 'free')
                current_exp = user_row.get('premium_expires_at')
        except Exception as e:
            print(f"Supabase set_user_premium lookup error: {e}")

    conn = get_db()
    cur = conn.cursor()
    if not user_row:
        cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        local_row = cur.fetchone()
        if local_row:
            user_row = dict(local_row)
            current_tier = user_row.get('tier', 'free')
            current_exp = user_row.get('premium_expires_at')

    if not user_row:
        conn.close()
        raise ValueError("រកមិនឃើញគណនីនេះទេ")

    if days == -1:
        expires_at_iso = None
    else:
        if current_exp and current_tier == 'premium':
            try:
                base_str = str(current_exp).replace('Z', '+00:00')
                base_dt = max(datetime.now(), datetime.fromisoformat(base_str).replace(tzinfo=None))
            except Exception:
                base_dt = datetime.now()
        else:
            base_dt = datetime.now()
        expires_at_iso = (base_dt + timedelta(days=days)).isoformat()

    cur.execute('''
        UPDATE users 
        SET tier = 'premium', premium_expires_at = ? 
        WHERE id = ?
    ''', (expires_at_iso, user_id))

    if cur.rowcount == 0 and user_row:
        try:
            cur.execute('''
                INSERT OR REPLACE INTO users (id, username, password_hash, salt, role, tier, premium_expires_at, has_voxcpm_license, voxcpm_license_expires_at, voxcpm_license_key, current_device_id, created_at, is_active)
                VALUES (?, ?, ?, ?, ?, 'premium', ?, ?, ?, ?, ?, ?, 1)
            ''', (
                user_id,
                user_row.get('username'),
                user_row.get('password_hash', ''),
                user_row.get('salt', ''),
                user_row.get('role', 'user'),
                expires_at_iso,
                user_row.get('has_voxcpm_license', 0),
                user_row.get('voxcpm_license_expires_at'),
                user_row.get('voxcpm_license_key'),
                user_row.get('current_device_id'),
                user_row.get('created_at', datetime.now().isoformat())
            ))
        except Exception as e:
            print(f"Error caching user into local SQLite: {e}")

    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_patch('users', {'id': f'eq.{user_id}'}, {
                'tier': 'premium',
                'premium_expires_at': expires_at_iso
            })
        except Exception as e:
            print(f"Supabase patch premium error: {e}")

    return {
        'id': user_id,
        'tier': 'premium',
        'premium_expires_at': expires_at_iso
    }

def revoke_user_premium(user_id: int) -> Dict[str, Any]:
    """Downgrade a user back to Free tier."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        UPDATE users 
        SET tier = 'free', premium_expires_at = NULL 
        WHERE id = ?
    ''', (user_id,))
    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_patch('users', {'id': f'eq.{user_id}'}, {
                'tier': 'free',
                'premium_expires_at': None
            })
        except Exception as e:
            print(f"Supabase revoke premium error: {e}")

    return {'id': user_id, 'tier': 'free', 'premium_expires_at': None}

def delete_user(user_id: int) -> bool:
    """Delete a user account and any associated sessions."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    cur.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_delete('sessions', {'user_id': f'eq.{user_id}'})
            supabase_db.sb_delete('users', {'id': f'eq.{user_id}'})
        except Exception as e:
            print(f"Supabase delete user error: {e}")

    return True

def reset_user_device(user_id: int) -> bool:
    """Unlock a user's bound device so they can login from another machine."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE users SET current_device_id = NULL WHERE id = ?", (user_id,))
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_patch('users', {'id': f'eq.{user_id}'}, {'current_device_id': None})
            supabase_db.sb_delete('sessions', {'user_id': f'eq.{user_id}'})
        except Exception as e:
            print(f"Supabase reset device error: {e}")

    return True

def reset_user_password(user_id: int, new_password: str) -> bool:
    """Admin reset of a user's account password."""
    conn = get_db()
    cur = conn.cursor()
    salt = secrets.token_hex(16)
    pwd_hash = hash_password(new_password.strip(), salt)
    cur.execute("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?", (pwd_hash, salt, user_id))
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

    if supabase_db.is_supabase_enabled():
        try:
            supabase_db.sb_patch('users', {'id': f'eq.{user_id}'}, {'password_hash': pwd_hash, 'salt': salt})
            supabase_db.sb_delete('sessions', {'user_id': f'eq.{user_id}'})
        except Exception as e:
            print(f"Supabase reset password error: {e}")

    return True


def get_or_create_device_user(device_id: str) -> Dict[str, Any]:
    """Find existing user for device or auto-create a persistent local user record."""
    device_id = (device_id or 'default').strip()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE current_device_id = ? AND is_active = 1", (device_id,))
    row = cur.fetchone()
    if row:
        user_dict = dict(row)
        conn.close()
        return user_dict

    now_iso = datetime.now().isoformat()
    clean_dev = device_id.replace('dev_', '').replace('-', '')[:8]
    username = f"user_{clean_dev}" if clean_dev else f"user_{secrets.token_hex(3)}"

    # Avoid collision
    cur.execute("SELECT id FROM users WHERE username = ?", (username,))
    if cur.fetchone():
        username = f"{username}_{secrets.token_hex(2)}"

    salt = secrets.token_hex(16)
    pwd_hash = hash_password("123456", salt)
    cur.execute('''
        INSERT INTO users (username, password_hash, salt, role, tier, has_voxcpm_license, current_device_id, created_at, is_active)
        VALUES (?, ?, ?, 'user', 'free', 0, ?, ?, 1)
    ''', (username, pwd_hash, salt, device_id, now_iso))
    user_id = cur.lastrowid
    conn.commit()
    cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user_dict = dict(cur.fetchone())
    conn.close()
    return user_dict

def create_session_for_user(user_id: int, device_id: str = 'default') -> str:
    """Create a persistent 365-day session token for a user."""
    conn = get_db()
    cur = conn.cursor()
    token = secrets.token_hex(32)
    now_iso = datetime.now().isoformat()
    session_exp = (datetime.now() + timedelta(days=365)).isoformat()
    cur.execute('''
        INSERT INTO sessions (token, user_id, device_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (token, user_id, device_id, now_iso, session_exp))
    cur.execute("UPDATE users SET current_device_id = ? WHERE id = ?", (device_id, user_id))
    conn.commit()
    conn.close()
    return token

# ── Subscriptions (KHQR) ─────────────────────────────────────────────────────

def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
    row = cur.fetchone()
    conn.close()
    return row['value'] if row else default

def set_setting(key: str, value: str) -> None:
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    ''', (key, value, datetime.now().isoformat()))
    conn.commit()
    conn.close()

# Plan catalogue: price, what it grants, and how many days it lasts. The
# trial itself isn't here -- STUDIO_TRIAL_EXPORTS (server.py) governs it.
SUBSCRIPTION_PLANS: Dict[str, Dict[str, Any]] = {
    'monthly': {'label_km': 'ប្រចាំខែ', 'label_en': 'Monthly', 'price_usd': 5, 'days': 30, 'voxcpm': False},
    'unlimited': {'label_km': 'គ្មានដែនកំណត់', 'label_en': 'Unlimited', 'price_usd': 30, 'days': 30, 'voxcpm': True},
}

def create_subscription_order(user_id: int, username: str, plan: str, ticket: str, qr_payload: str, qr_md5: str) -> Dict[str, Any]:
    if plan not in SUBSCRIPTION_PLANS:
        raise ValueError(f"Unknown plan: {plan}")
    conn = get_db()
    cur = conn.cursor()
    now_iso = datetime.now().isoformat()
    cur.execute('''
        INSERT INTO subscription_orders (ticket, user_id, username, plan, amount_usd, qr_payload, qr_md5, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ''', (ticket, user_id, username, plan, SUBSCRIPTION_PLANS[plan]['price_usd'], qr_payload, qr_md5, now_iso))
    conn.commit()
    conn.close()
    return {'ticket': ticket, 'plan': plan, 'amount_usd': SUBSCRIPTION_PLANS[plan]['price_usd'],
            'qr_payload': qr_payload, 'status': 'pending', 'created_at': now_iso}

def get_subscription_order(ticket: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM subscription_orders WHERE ticket = ?", (ticket,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None

def grant_subscription(user_id: int, plan: str) -> None:
    """Applies a paid plan to a user: extends premium_expires_at from whichever
    is later (now or the current expiry), so paying early never shortens an
    active subscription. 'unlimited' also grants the VoxCPM2 clone license
    on the same expiry, reusing check_and_expire_subscription's existing
    VoxCPM2 auto-expiry -- no new expiry code needed."""
    spec = SUBSCRIPTION_PLANS[plan]
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT premium_expires_at, plan FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    base = datetime.now()
    if row and row['premium_expires_at']:
        try:
            current_exp = datetime.fromisoformat(str(row['premium_expires_at']).replace('Z', '+00:00')).replace(tzinfo=None)
            if current_exp > base:
                base = current_exp
        except Exception:
            pass
    new_exp = (base + timedelta(days=spec['days'])).isoformat()
    if spec['voxcpm']:
        cur.execute('''
            UPDATE users SET tier = 'premium', plan = ?, premium_expires_at = ?,
                has_voxcpm_license = 1, voxcpm_license_expires_at = ? WHERE id = ?
        ''', (plan, new_exp, new_exp, user_id))
    else:
        cur.execute('''
            UPDATE users SET tier = 'premium', plan = ?, premium_expires_at = ? WHERE id = ?
        ''', (plan, new_exp, user_id))
    conn.commit()
    conn.close()
    if supabase_db.is_supabase_enabled():
        patch = {'tier': 'premium', 'plan': plan, 'premium_expires_at': new_exp}
        if spec['voxcpm']:
            patch.update({'has_voxcpm_license': 1, 'voxcpm_license_expires_at': new_exp})
        try:
            supabase_db.sb_patch('users', {'id': f"eq.{user_id}"}, patch)
        except Exception as e:
            print(f"Supabase subscription sync warning: {e}")

def mark_order_paid(ticket: str, bank_hash: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Marks a pending order paid and grants its plan. Returns the updated order,
    or None if it was already handled (paid/expired) or doesn't exist -- so a
    caller can never grant the same order's plan twice."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM subscription_orders WHERE ticket = ? AND status = 'pending'", (ticket,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return None
    now_iso = datetime.now().isoformat()
    cur.execute("UPDATE subscription_orders SET status = 'paid', paid_at = ?, bank_hash = ? WHERE ticket = ?",
                (now_iso, bank_hash, ticket))
    conn.commit()
    conn.close()
    grant_subscription(row['user_id'], row['plan'])
    return {**dict(row), 'status': 'paid', 'paid_at': now_iso}

def increment_trial_exports(user_id: int) -> None:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE users SET trial_exports_used = COALESCE(trial_exports_used, 0) + 1 WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()

# Auto-initialize DB tables on module import
init_db()

