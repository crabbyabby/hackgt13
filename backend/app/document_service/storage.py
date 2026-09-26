import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path


def now():
    return datetime.now(UTC).isoformat()


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / 'documents.sqlite3'
        with self.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL)')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self, doc):
        with self.connection() as db:
            db.execute('INSERT INTO documents VALUES (?, ?)', (doc['id'], json.dumps(doc)))

    def get(self, doc_id):
        with self.connection() as db:
            row = db.execute('SELECT body FROM documents WHERE id=?', (doc_id,)).fetchone()
        if row is None:
            raise NotFound()
        return json.loads(row[0])

    def list(self):
        with self.connection() as db:
            rows = db.execute('SELECT body FROM documents ORDER BY rowid DESC LIMIT 100').fetchall()
        return [json.loads(row[0]) for row in rows]

    def update(self, doc_id, change, expected=None):
        # One transaction protects against simultaneous edits/retry requests.
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT body FROM documents WHERE id=?', (doc_id,)).fetchone()
            if row is None:
                raise NotFound()
            doc = json.loads(row[0])
            if expected is not None and doc['revision'] != expected:
                raise Conflict('Document changed. Fetch it again before saving.')
            change(doc)
            doc['revision'] += 1
            doc['updatedAt'] = now()
            db.execute('UPDATE documents SET body=? WHERE id=?', (json.dumps(doc), doc_id))
        return doc

    def recover_interrupted(self):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            for doc_id, body in db.execute('SELECT id, body FROM documents').fetchall():
                doc = json.loads(body)
                if doc['status'] == 'processing':
                    doc.update(status='failed', error='Processing interrupted by server restart. Retry conversion.',
                               revision=doc['revision'] + 1, updatedAt=now())
                    db.execute('UPDATE documents SET body=? WHERE id=?', (json.dumps(doc), doc_id))
