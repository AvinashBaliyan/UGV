"""
database.py — SQLite persistence for terrain maps.
"""
import json
import sqlite3
import logging
from pathlib import Path

log = logging.getLogger(__name__)
DB_PATH = Path(__file__).parent / "ugv_maps.db"


class DatabaseManager:
    def __init__(self):
        self.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        self._init_schema()

    def _init_schema(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS maps (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                cells_json  TEXT NOT NULL DEFAULT '[]',
                vehicle_json TEXT NOT NULL DEFAULT '{}',
                cell_count  INTEGER DEFAULT 0,
                source_type TEXT DEFAULT 'map',
                file_path   TEXT DEFAULT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}'
            )
        """)

        columns = [row[1] for row in self.conn.execute("PRAGMA table_info(maps)").fetchall()]
        for column_name, ddl in {
            "source_type": "ALTER TABLE maps ADD COLUMN source_type TEXT DEFAULT 'map'",
            "file_path": "ALTER TABLE maps ADD COLUMN file_path TEXT DEFAULT NULL",
            "metadata_json": "ALTER TABLE maps ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
        }.items():
            if column_name not in columns:
                try:
                    self.conn.execute(ddl)
                except sqlite3.OperationalError:
                    pass

        self.conn.commit()
        log.info("Database initialized at %s", DB_PATH)

    def save_map(self, name: str, cells: list, vehicle: dict, source_type: str = 'map', file_path: str | None = None, metadata: dict | None = None) -> int:
        from datetime import datetime
        cur = self.conn.execute(
            "INSERT INTO maps (name, created_at, cells_json, vehicle_json, cell_count, source_type, file_path, metadata_json) VALUES (?,?,?,?,?,?,?,?)",
            (name, datetime.utcnow().isoformat(), json.dumps(cells), json.dumps(vehicle), len(cells), source_type, file_path, json.dumps(metadata or {}))
        )
        self.conn.commit()
        log.info("Saved map '%s' with %d cells (id=%d)", name, len(cells), cur.lastrowid)
        return cur.lastrowid

    def save_video_memory(self, name: str, file_path: str) -> int:
        from datetime import datetime
        cur = self.conn.execute(
            "INSERT INTO maps (name, created_at, cells_json, vehicle_json, cell_count, source_type, file_path) VALUES (?,?,?,?,?,?,?)",
            (name, datetime.utcnow().isoformat(), '[]', '{}', 0, 'video', file_path)
        )
        self.conn.commit()
        log.info("Saved video memory '%s' at %s (id=%d)", name, file_path, cur.lastrowid)
        return cur.lastrowid

    def list_maps(self) -> list:
        rows = self.conn.execute(
            "SELECT id, name, created_at, cell_count, source_type, file_path FROM maps ORDER BY created_at DESC"
        ).fetchall()
        return [{
            "id": r[0],
            "name": r[1],
            "created_at": r[2],
            "cell_count": r[3],
            "source_type": r[4],
            "file_path": r[5],
        } for r in rows]

    def get_map(self, map_id: int) -> dict:
        row = self.conn.execute(
            "SELECT id, name, created_at, cells_json, vehicle_json, cell_count, source_type, file_path, metadata_json FROM maps WHERE id=?",
            (map_id,)
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0], "name": row[1], "created_at": row[2],
            "cells": json.loads(row[3]), "vehicle": json.loads(row[4]),
            "cell_count": row[5], "source_type": row[6], "file_path": row[7],
            "metadata": json.loads(row[8] or "{}"),
        }

    def delete_map(self, map_id: int):
        self.conn.execute("DELETE FROM maps WHERE id=?", (map_id,))
        self.conn.commit()
