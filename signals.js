import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM signals WHERE user_id=? ORDER BY created_at DESC LIMIT 200')
    .all(req.userId);
  res.json(rows.map(r => ({ ...r, reasoning: JSON.parse(r.reasoning_json || '[]') })));
});

router.patch('/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const allowed = ['DETECTED','CONFIRMED','ACTIVE','TP1','TP2','TP3','INVALIDATED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE signals SET status=? WHERE id=? AND user_id=?').run(status, req.params.id, req.userId);
  res.json({ ok: true });
});

export default router;
