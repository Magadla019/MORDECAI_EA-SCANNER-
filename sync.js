import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = Router();

function connectionByToken(deviceToken) {
  return db.prepare('SELECT * FROM mt5_connections WHERE device_token = ?').get(deviceToken);
}

// --- Called by the MT5 EA (mt5-ea/MORDECAI_EA_SCANNER.mq5) --------------
// Read-only ingest: account snapshot + open positions + watched symbols.
// There is no corresponding endpoint that sends trade instructions back.
router.post('/account', (req, res) => {
  const { device_token, broker, server, account, currency, balance, equity,
          margin, free_margin, margin_level, positions } = req.body;

  const conn = connectionByToken(device_token);
  if (!conn) return res.status(404).json({ error: 'Unknown device token' });

  db.prepare(`UPDATE mt5_connections
              SET status='connected', account_number=?, broker=?, server=?, currency=?, last_sync_at=?
              WHERE id=?`)
    .run(account, broker, server, currency, Date.now(), conn.id);

  db.prepare(`INSERT INTO account_snapshots
              (id, connection_id, balance, equity, margin, free_margin, margin_level, open_positions_json, taken_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(nanoid(), conn.id, balance, equity, margin, free_margin, margin_level,
         JSON.stringify(positions || []), Date.now());

  res.json({ ok: true });
});

// Closed-trade history push, deduped by (connection, deal_id).
router.post('/history', (req, res) => {
  const { device_token, deals } = req.body;
  const conn = connectionByToken(device_token);
  if (!conn) return res.status(404).json({ error: 'Unknown device token' });

  const insert = db.prepare(`INSERT OR IGNORE INTO trade_history
    (id, connection_id, deal_id, order_id, symbol, direction, volume, price, profit, commission, swap, closed_at)
    VALUES (@id, @connection_id, @deal_id, @order_id, @symbol, @direction, @volume, @price, @profit, @commission, @swap, @closed_at)`);

  let imported = 0;
  const tx = db.transaction((rows) => {
    for (const d of rows) {
      const result = insert.run({
        id: nanoid(), connection_id: conn.id, deal_id: d.deal_id, order_id: d.order_id,
        symbol: d.symbol, direction: d.type, volume: d.volume, price: d.price,
        profit: d.profit, commission: d.commission, swap: d.swap, closed_at: d.time * 1000
      });
      if (result.changes > 0) imported++;
    }
  });
  tx(deals || []);

  const maxDeal = Math.max(conn.last_deal_id || 0, ...(deals || []).map(d => d.deal_id), 0);
  db.prepare('UPDATE mt5_connections SET last_deal_id=? WHERE id=?').run(maxDeal, conn.id);

  res.json({ ok: true, imported });
});

// --- Called by the frontend dashboard ------------------------------------
router.get('/status', requireAuth, (req, res) => {
  const conn = db.prepare('SELECT * FROM mt5_connections WHERE user_id=? ORDER BY created_at DESC LIMIT 1')
    .get(req.userId);
  if (!conn) return res.json({ connected: false });

  const snapshot = db.prepare('SELECT * FROM account_snapshots WHERE connection_id=? ORDER BY taken_at DESC LIMIT 1')
    .get(conn.id);

  // A connection older than 30s since last EA push is considered offline,
  // even though the DB row still says "connected" - never fake a green dot.
  const freshMs = 30_000;
  const isLive = conn.last_sync_at && (Date.now() - conn.last_sync_at) < freshMs;

  res.json({
    connected: !!isLive,
    connectionId: conn.id,
    broker: conn.broker,
    server: conn.server,
    account: conn.account_number,
    currency: conn.currency,
    lastSync: conn.last_sync_at,
    balance: snapshot?.balance ?? null,
    equity: snapshot?.equity ?? null,
    marginLevel: snapshot?.margin_level ?? null,
    openPositions: snapshot ? JSON.parse(snapshot.open_positions_json) : []
  });
});

export default router;
