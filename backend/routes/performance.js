import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = Router();

function getConnectionId(userId) {
  const conn = db.prepare('SELECT id FROM mt5_connections WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(userId);
  return conn?.id || null;
}

// Real synced trade history, filtered by range. No synthetic data is ever generated -
// if there is no connection or no trades, the arrays are simply empty.
router.get('/history', requireAuth, (req, res) => {
  const connId = getConnectionId(req.userId);
  if (!connId) return res.json({ trades: [] });

  const { from, to } = req.query;
  let query = 'SELECT * FROM trade_history WHERE connection_id=?';
  const params = [connId];
  if (from) { query += ' AND closed_at >= ?'; params.push(Number(from)); }
  if (to)   { query += ' AND closed_at <= ?'; params.push(Number(to)); }
  query += ' ORDER BY closed_at DESC LIMIT 500';

  res.json({ trades: db.prepare(query).all(...params) });
});

router.get('/summary', requireAuth, (req, res) => {
  const connId = getConnectionId(req.userId);
  if (!connId) return res.json({ hasData: false });

  const trades = db.prepare('SELECT * FROM trade_history WHERE connection_id=? ORDER BY closed_at ASC').all(connId);
  if (trades.length === 0) return res.json({ hasData: false });

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const sum = (arr) => arr.reduce((s, t) => s + t.profit, 0);

  const today = trades.filter(t => now - t.closed_at < day);
  const week = trades.filter(t => now - t.closed_at < 7 * day);
  const month = trades.filter(t => now - t.closed_at < 30 * day);

  const wins = trades.filter(t => t.profit > 0);
  const losses = trades.filter(t => t.profit < 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const grossWin = sum(wins);
  const grossLoss = Math.abs(sum(losses));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  // Equity curve from running balance snapshots
  const snapshots = db.prepare('SELECT balance, equity, taken_at FROM account_snapshots WHERE connection_id=? ORDER BY taken_at ASC').all(connId);

  res.json({
    hasData: true,
    todayPL: sum(today),
    weekPL: sum(week),
    monthPL: sum(month),
    totalPL: sum(trades),
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: Number(winRate.toFixed(1)),
    averageWin: wins.length ? Number((grossWin / wins.length).toFixed(2)) : 0,
    averageLoss: losses.length ? Number((grossLoss / losses.length).toFixed(2)) : 0,
    largestWin: wins.length ? Math.max(...wins.map(t => t.profit)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map(t => t.profit)) : 0,
    profitFactor,
    totalTrades: trades.length,
    equityCurve: snapshots.map(s => ({ t: s.taken_at, balance: s.balance, equity: s.equity }))
  });
});

export default router;
