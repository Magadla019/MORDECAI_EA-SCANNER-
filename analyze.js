import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB max, per spec section 53 "Maximum image size"
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPEG or WEBP screenshots are accepted'), ok);
  }
});

const SYSTEM_PROMPT = `You are the analysis engine inside MORDECAI_EA SCANNER, a Smart Money Concepts
market scanner. You are shown one chart screenshot and the user's trade parameters. You must:

1. Only describe structure, liquidity, order blocks, FVGs, BOS/MSS, trend and momentum that are
   ACTUALLY VISIBLE in the image. If the image is unclear, cropped, or missing price/candle data,
   respond with insufficient_data=true and list exactly what is missing. Never invent price levels.
2. Never generate a signal from a single indicator alone - require confluence (structure + liquidity
   + order block or FVG + momentum) as described in the Smart Money strategy.
3. If the user's requested target does not match the structural target implied by the chart, report
   the conflict explicitly instead of forcing the requested number.
4. Score confidence 0-100 using: market structure 20, liquidity 15, order block 15, FVG 10, momentum 10,
   trend 10, volume 5, volatility 5, risk/reward 5, session 5. Map to verdict: 0-49 NO TRADE,
   50-64 WEAK SETUP, 65-74 VALID SETUP, 75-84 STRONG SIGNAL, 85-100 HIGH-CONFLUENCE SIGNAL.
5. NEVER claim a signal guarantees profit or a specific outcome. This is analysis, not a promise.
6. Respond with ONLY a JSON object, no other text, matching this shape:
{
  "insufficient_data": false,
  "missing_info": [],
  "symbol": "string",
  "direction": "buy | sell | no_trade",
  "verdict": "NO TRADE | WEAK SETUP | VALID SETUP | STRONG SIGNAL | HIGH-CONFLUENCE SIGNAL",
  "confidence": 0,
  "entry_low": null, "entry_high": null, "stop_loss": null,
  "tp1": null, "tp2": null, "tp3": null,
  "risk_reward": null,
  "target_conflict": null,
  "reasoning": ["short bullet", "short bullet"],
  "market_structure": "string", "liquidity": "string", "trend": "string", "momentum": "string"
}`;

router.post('/screenshot', requireAuth, upload.single('screenshot'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No screenshot uploaded' });

  const { symbol, timeframe, balance, lotSize, positions, riskPercent, targetPips } = req.body;

  const userText = `Symbol: ${symbol || 'unspecified'}
Timeframe: ${timeframe || 'unspecified'}
Account balance: ${balance || 'unspecified'}
Lot size: ${lotSize || 'unspecified'}
Number of positions requested: ${positions || 1}
Risk %: ${riskPercent || 'unspecified'}
User's requested target: ${targetPips || 'unspecified'}

Analyze the attached chart screenshot per your instructions and return only the JSON object.`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: req.file.buffer.toString('base64') } },
            { type: 'text', text: userText }
          ]
        }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Anthropic API error:', errText);
      return res.status(502).json({ error: 'AI analysis service unavailable' });
    }

    const data = await apiRes.json();
    const textBlock = data.content.find(b => b.type === 'text')?.text || '{}';
    const clean = textBlock.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(clean);

    if (analysis.insufficient_data) {
      return res.json({ insufficient_data: true, missing_info: analysis.missing_info });
    }

    const setupId = `${(symbol || analysis.symbol || 'UNKNOWN')}-${analysis.direction?.toUpperCase()}-${new Date().toISOString().slice(0,10)}-${nanoid(4)}`;
    const id = nanoid();

    db.prepare(`INSERT INTO signals
      (id, user_id, setup_id, symbol, direction, verdict, confidence, entry_low, entry_high,
       stop_loss, tp1, tp2, tp3, risk_reward, reasoning_json, status, source, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.userId, setupId, symbol || analysis.symbol, analysis.direction, analysis.verdict,
           analysis.confidence, analysis.entry_low, analysis.entry_high, analysis.stop_loss,
           analysis.tp1, analysis.tp2, analysis.tp3, analysis.risk_reward,
           JSON.stringify(analysis.reasoning || []), 'DETECTED', 'screenshot', Date.now());

    res.json({ insufficient_data: false, setupId, ...analysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

export default router;
