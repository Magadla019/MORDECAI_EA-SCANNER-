import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { requireAuth } from './auth.js';
import { encrypt } from '../crypto.js';
import { linkAccount, fetchAccountSnapshot, fetchClosedHistory } from '../metaapi.js';

const router = Router();

// Body: { login, password, server, broker?, accountType?, label? }
// Works for live and demo accounts. Password is encrypted at rest (AES-256-GCM).
router.post('/link', requireAuth, async (req, res) => {
  const { login, password, server, label, broker, accountType } = req.body;
  if (!login || !password || !server) {
    return res.status(400).json({ error: 'Login, password, and server are all required' });
  }

  const id = nanoid();
  const deviceToken = nanoid(24); // unused for login-linked accounts, kept for schema consistency
  const enc = encrypt(password);

  db.prepare(`INSERT INTO mt5_connections
    (id, user_id, device_token, account_number, broker, server, account_type, status, link_method,
     encrypted_password, encrypted_iv, encrypted_authtag, created_at)
    VALUES (?,?,?,?,?,?,?, 'connecting', 'login', ?,?,?, ?)`)
    .run(id, req.userId, deviceToken, login, broker || null, server, accountType === 'demo' ? 'demo' : 'live',
         enc.ciphertext, enc.iv, enc.authTag, Date.now());

  try {
    const metaapiAccountId = await linkAccount({ login, password, server, label });
    db.prepare('UPDATE mt5_connections SET metaapi_account_id=?, status=?, last_sync_at=? WHERE id=?')
      .run(metaapiAccountId, 'connected', Date.now(), id);
    res.json({ ok: true, connectionId: id, status: 'connected' });
  } catch (err) {
    console.error('MetaApi link failed:', err.message);
    // Credentials are saved either way so the account isn't lost - just not yet verified live.
    res.status(502).json({
      ok: false,
      connectionId: id,
      error: err.message,
      note: 'Credentials were saved, but the live connection could not be verified. Check backend/.env METAAPI_TOKEN and that metaapi.cloud-sdk is installed.'
    });
  }
});

// Pulls the latest snapshot from MetaApi and writes it into the same
// account_snapshots table the EA-based flow uses, so the rest of the app
// (Live Trading, Performance) works identically regardless of link method.
router.post('/:connectionId/refresh', requireAuth, async (req, res) => {
  const conn = db.prepare('SELECT * FROM mt5_connections WHERE id=? AND user_id=?').get(req.params.connectionId, req.userId);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  if (conn.link_method !== 'login' || !conn.metaapi_account_id) {
    return res.status(400).json({ error: 'This connection is not a login-linked MetaApi account' });
  }

  try {
    const snap = await fetchAccountSnapshot(conn.metaapi_account_id);
    db.prepare(`UPDATE mt5_connections SET status='connected', broker=?, currency=?, last_sync_at=? WHERE id=?`)
      .run(snap.broker, snap.currency, Date.now(), conn.id);
    db.prepare(`INSERT INTO account_snapshots
      (id, connection_id, balance, equity, margin, free_margin, margin_level, open_positions_json, taken_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(nanoid(), conn.id, snap.balance, snap.equity, snap.margin, snap.freeMargin, snap.marginLevel,
           JSON.stringify(snap.positions), Date.now());

    const deals = await fetchClosedHistory(conn.metaapi_account_id, conn.last_sync_at);
    const insert = db.prepare(`INSERT OR IGNORE INTO trade_history
      (id, connection_id, deal_id, order_id, symbol, direction, volume, price, profit, commission, swap, closed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const d of deals) {
      insert.run(nanoid(), conn.id, d.deal_id, d.order_id, d.symbol, d.type, d.volume, d.price, d.profit, d.commission, d.swap, d.time * 1000);
    }

    res.json({ ok: true, ...snap });
  } catch (err) {
    console.error('MetaApi refresh failed:', err.message);
    db.prepare(`UPDATE mt5_connections SET status='disconnected' WHERE id=?`).run(conn.id);
    res.status(502).json({ error: err.message });
  }
});

router.post('/:connectionId/unlink', requireAuth, (req, res) => {
  const conn = db.prepare('SELECT * FROM mt5_connections WHERE id=? AND user_id=?').get(req.params.connectionId, req.userId);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  // Clears the stored ciphertext outright rather than just marking disconnected.
  db.prepare(`UPDATE mt5_connections SET status='disconnected',
    encrypted_password=NULL, encrypted_iv=NULL, encrypted_authtag=NULL WHERE id=?`).run(conn.id);
  res.json({ ok: true });
});

export default router;
