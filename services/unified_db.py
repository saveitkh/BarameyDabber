"""
Unified Database Service
គ្រប់គ្រង Database តែមួយសម្រាប់ Options ទាំងបី (VoxCPM2, Pure Khmer, ElevenLabs)
រួមបញ្ចូល SQLite (Local) និង Supabase (Cloud) ស្វ័យប្រវត្តិ
"""

import os
import sys
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any, Union
from pathlib import Path

# Import existing services
from services import supabase_db

logger = logging.getLogger("unified_db")

# Setup paths
if getattr(sys, 'frozen', False):
    APP_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = getattr(sys, '_MEIPASS', APP_DIR)
else:
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    BUNDLE_DIR = APP_DIR

DATA_DIR = os.path.join(APP_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'unified_studio.db')

class UnifiedDatabase:
    """
    Unified Database Manager
    - Automatic sync between SQLite (local) and Supabase (cloud)
    - Single source of truth for all 3 processing modes
    - Offline-first with cloud backup
    """
    
    def __init__(self):
        self.db_path = DB_PATH
        self.init_local_db()
    
    def get_connection(self) -> sqlite3.Connection:
        """Get SQLite connection with Row factory"""
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn
    
    def init_local_db(self):
        """Initialize local SQLite database with unified schema"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        # Processing jobs table (unified for all 3 modes)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS processing_jobs (
                id TEXT PRIMARY KEY,
                user_id INTEGER,
                video_filename TEXT,
                job_type TEXT NOT NULL,
                processing_mode TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                progress INTEGER DEFAULT 0,
                message TEXT,
                params TEXT,
                result TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT
            )
        ''')
        
        # Video library table (local storage tracking)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS video_library (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                filename TEXT NOT NULL,
                original_name TEXT,
                local_path TEXT NOT NULL,
                file_size INTEGER,
                duration REAL,
                thumbnail_path TEXT,
                group_id TEXT,
                group_name TEXT,
                processing_status TEXT DEFAULT 'ready',
                metadata TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        
        # Processing history (unified for all modes)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS processing_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                job_id TEXT,
                processing_mode TEXT NOT NULL,
                video_filename TEXT,
                success INTEGER DEFAULT 0,
                duration_seconds REAL,
                output_files TEXT,
                created_at TEXT NOT NULL
            )
        ''')
        
        # Mode usage statistics
        cur.execute('''
            CREATE TABLE IF NOT EXISTS mode_usage_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                mode TEXT NOT NULL,
                usage_count INTEGER DEFAULT 0,
                total_duration_seconds REAL DEFAULT 0,
                last_used_at TEXT,
                created_at TEXT NOT NULL
            )
        ''')
        
        # Create indexes for performance
        cur.execute('CREATE INDEX IF NOT EXISTS idx_jobs_user ON processing_jobs(user_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_jobs_mode ON processing_jobs(processing_mode)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_videos_user ON video_library(user_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_history_user ON processing_history(user_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_history_mode ON processing_history(processing_mode)')
        
        conn.commit()
        conn.close()
        logger.info("✅ Unified database initialized successfully")
    
    # ==========================================
    # PROCESSING JOBS (Unified for all 3 modes)
    # ==========================================
    
    def create_job(self, job_data: Dict[str, Any]) -> str:
        """
        Create new processing job
        Supports: VoxCPM2, Pure Khmer, ElevenLabs
        """
        conn = self.get_connection()
        cur = conn.cursor()
        
        job_id = job_data.get('id')
        user_id = job_data.get('user_id')
        video_filename = job_data.get('video_filename')
        job_type = job_data.get('job_type', 'dubbing')
        processing_mode = job_data.get('processing_mode', 'pure_khmer')
        status = job_data.get('status', 'pending')
        progress = job_data.get('progress', 0)
        message = job_data.get('message', 'Initializing...')
        params = json.dumps(job_data.get('params', {}))
        now = datetime.now().isoformat()
        
        cur.execute('''
            INSERT INTO processing_jobs 
            (id, user_id, video_filename, job_type, processing_mode, status, progress, message, params, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (job_id, user_id, video_filename, job_type, processing_mode, status, progress, message, params, now, now))
        
        conn.commit()
        conn.close()
        
        # Sync to cloud if available
        self._sync_job_to_cloud(job_id)
        
        return job_id
    
    def update_job(self, job_id: str, updates: Dict[str, Any]) -> bool:
        """Update job progress and status"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        updates['updated_at'] = datetime.now().isoformat()
        
        if updates.get('status') in ['completed', 'failed']:
            updates['completed_at'] = updates['updated_at']
        
        set_clause = ', '.join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [job_id]
        
        cur.execute(f'UPDATE processing_jobs SET {set_clause} WHERE id = ?', values)
        
        affected = cur.rowcount
        conn.commit()
        conn.close()
        
        # Sync to cloud
        if affected > 0:
            self._sync_job_to_cloud(job_id)
        
        return affected > 0
    
    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job by ID"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        cur.execute('SELECT * FROM processing_jobs WHERE id = ?', (job_id,))
        row = cur.fetchone()
        conn.close()
        
        if row:
            return dict(row)
        return None
    
    def get_user_jobs(self, user_id: int, mode: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """Get user's processing jobs, optionally filtered by mode"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        if mode:
            cur.execute('''
                SELECT * FROM processing_jobs 
                WHERE user_id = ? AND processing_mode = ?
                ORDER BY created_at DESC LIMIT ?
            ''', (user_id, mode, limit))
        else:
            cur.execute('''
                SELECT * FROM processing_jobs 
                WHERE user_id = ?
                ORDER BY created_at DESC LIMIT ?
            ''', (user_id, limit))
        
        rows = cur.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    # ==========================================
    # VIDEO LIBRARY (Local storage tracking)
    # ==========================================
    
    def add_video(self, video_data: Dict[str, Any]) -> int:
        """Add video to library (stores metadata only, not file)"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        now = datetime.now().isoformat()
        metadata = json.dumps(video_data.get('metadata', {}))
        
        cur.execute('''
            INSERT INTO video_library 
            (user_id, filename, original_name, local_path, file_size, duration, 
             thumbnail_path, group_id, group_name, processing_status, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            video_data.get('user_id'),
            video_data.get('filename'),
            video_data.get('original_name'),
            video_data.get('local_path'),
            video_data.get('file_size'),
            video_data.get('duration'),
            video_data.get('thumbnail_path'),
            video_data.get('group_id'),
            video_data.get('group_name'),
            video_data.get('processing_status', 'ready'),
            metadata,
            now,
            now
        ))
        
        video_id = cur.lastrowid
        conn.commit()
        conn.close()
        
        # Sync to cloud
        self._sync_video_to_cloud(video_id)
        
        return video_id
    
    def get_user_videos(self, user_id: int, group_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get user's video library"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        if group_id:
            cur.execute('''
                SELECT * FROM video_library 
                WHERE user_id = ? AND group_id = ?
                ORDER BY created_at DESC
            ''', (user_id, group_id))
        else:
            cur.execute('''
                SELECT * FROM video_library 
                WHERE user_id = ?
                ORDER BY created_at DESC
            ''', (user_id,))
        
        rows = cur.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    def delete_video(self, video_id: int, user_id: int) -> bool:
        """Delete video from library (metadata only)"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        cur.execute('DELETE FROM video_library WHERE id = ? AND user_id = ?', (video_id, user_id))
        
        affected = cur.rowcount
        conn.commit()
        conn.close()
        
        return affected > 0
    
    # ==========================================
    # PROCESSING HISTORY & STATISTICS
    # ==========================================
    
    def add_history(self, history_data: Dict[str, Any]) -> int:
        """Add processing history entry"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        now = datetime.now().isoformat()
        output_files = json.dumps(history_data.get('output_files', []))
        
        cur.execute('''
            INSERT INTO processing_history 
            (user_id, job_id, processing_mode, video_filename, success, duration_seconds, output_files, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            history_data.get('user_id'),
            history_data.get('job_id'),
            history_data.get('processing_mode'),
            history_data.get('video_filename'),
            history_data.get('success', 0),
            history_data.get('duration_seconds', 0),
            output_files,
            now
        ))
        
        history_id = cur.lastrowid
        conn.commit()
        conn.close()
        
        # Update mode usage stats
        self._update_mode_stats(
            history_data.get('user_id'),
            history_data.get('processing_mode'),
            history_data.get('duration_seconds', 0)
        )
        
        return history_id
    
    def get_user_history(self, user_id: int, mode: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """Get user's processing history"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        if mode:
            cur.execute('''
                SELECT * FROM processing_history 
                WHERE user_id = ? AND processing_mode = ?
                ORDER BY created_at DESC LIMIT ?
            ''', (user_id, mode, limit))
        else:
            cur.execute('''
                SELECT * FROM processing_history 
                WHERE user_id = ?
                ORDER BY created_at DESC LIMIT ?
            ''', (user_id, limit))
        
        rows = cur.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    def get_mode_stats(self, user_id: int) -> Dict[str, Any]:
        """Get usage statistics for all processing modes"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        cur.execute('''
            SELECT mode, usage_count, total_duration_seconds, last_used_at
            FROM mode_usage_stats
            WHERE user_id = ?
        ''', (user_id,))
        
        rows = cur.fetchall()
        conn.close()
        
        stats = {}
        for row in rows:
            stats[row['mode']] = {
                'usage_count': row['usage_count'],
                'total_duration_seconds': row['total_duration_seconds'],
                'last_used_at': row['last_used_at']
            }
        
        # Ensure all modes are present
        for mode in ['voxcpm2', 'pure_khmer', 'elevenlabs']:
            if mode not in stats:
                stats[mode] = {
                    'usage_count': 0,
                    'total_duration_seconds': 0,
                    'last_used_at': None
                }
        
        return stats
    
    def _update_mode_stats(self, user_id: int, mode: str, duration: float):
        """Update mode usage statistics"""
        conn = self.get_connection()
        cur = conn.cursor()
        
        now = datetime.now().isoformat()
        
        cur.execute('''
            INSERT INTO mode_usage_stats (user_id, mode, usage_count, total_duration_seconds, last_used_at, created_at)
            VALUES (?, ?, 1, ?, ?, ?)
            ON CONFLICT(user_id, mode) DO UPDATE SET
                usage_count = usage_count + 1,
                total_duration_seconds = total_duration_seconds + ?,
                last_used_at = ?
        ''', (user_id, mode, duration, now, now, duration, now))
        
        # Create unique index if not exists
        try:
            cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_mode_stats_user_mode ON mode_usage_stats(user_id, mode)')
        except:
            pass
        
        conn.commit()
        conn.close()
    
    # ==========================================
    # CLOUD SYNC (Supabase)
    # ==========================================
    
    @staticmethod
    def _json_columns(row: Dict[str, Any], columns: tuple) -> Dict[str, Any]:
        """SQLite stores JSON as TEXT; send real objects to Supabase JSONB columns."""
        out = dict(row)
        for col in columns:
            val = out.get(col)
            if isinstance(val, str) and val:
                try:
                    out[col] = json.loads(val)
                except (ValueError, TypeError):
                    pass
        return out

    def _sync_job_to_cloud(self, job_id: str):
        """Sync job to Supabase (optional cloud backup)"""
        if not supabase_db.is_supabase_enabled():
            return
        
        try:
            job = self.get_job(job_id)
            if job:
                supabase_db.sb_upsert('processing_jobs', self._json_columns(job, ('params', 'result')), on_conflict='id')
        except Exception as e:
            logger.warning(f"Cloud sync failed for job {job_id}: {e}")
    
    def _sync_video_to_cloud(self, video_id: int):
        """Sync video metadata to Supabase"""
        if not supabase_db.is_supabase_enabled():
            return
        
        try:
            conn = self.get_connection()
            cur = conn.cursor()
            cur.execute('SELECT * FROM video_library WHERE id = ?', (video_id,))
            video = cur.fetchone()
            conn.close()
            
            if video:
                video_dict = self._json_columns(dict(video), ('metadata',))
                supabase_db.sb_upsert('video_library', video_dict, on_conflict='id')
        except Exception as e:
            logger.warning(f"Cloud sync failed for video {video_id}: {e}")

# Global instance
unified_db = UnifiedDatabase()
