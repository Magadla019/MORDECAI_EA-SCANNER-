import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import db from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and a password of 8+ characters are required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Account already exists' });

  const id = nanoid();
  const password_hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, email, password_hash, Date.now());

  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

// Generate a pairing token the user pastes into the MT5 EA's InpDeviceToken input.
// This token identifies the terminal to the backend - it is NOT the MT5 password,
// and the MT5 master password is never sent to or stored by this backend.
router.post('/mt5/pair', requireAuth, (req, res) => {
  const deviceToken = nanoid(24);
  const id = nanoid();
  db.prepare(`INSERT INTO mt5_connections (id, user_id, device_token, status, created_at)
              VALUES (?, ?, ?, 'connecting', ?)`)
    .run(id, req.userId, deviceToken, Date.now());
  res.json({ connectionId: id, deviceToken });
});

router.post('/mt5/logout', requireAuth, (req, res) => {
  const { connectionId } = req.body;
  db.prepare(`UPDATE mt5_connections SET status = 'disconnected' WHERE id = ? AND user_id = ?`)
    .run(connectionId, req.userId);
  res.json({ ok: true });
});

export default router;
