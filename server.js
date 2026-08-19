import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import syncRoutes from './routes/sync.js';
import analyzeRoutes from './routes/analyze.js';
import signalsRoutes from './routes/signals.js';
import performanceRoutes from './routes/performance.js';
import mt5linkRoutes from './routes/mt5link.js';

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in .env - refusing to start. See .env.example.');
  process.exit(1);
}

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow no-origin requests (e.g. the MT5 EA's WebRequest) and any whitelisted frontend origin
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  }
}));
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'MORDECAI_EA SCANNER backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/signals', signalsRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/mt5', mt5linkRoutes);

// This backend intentionally has no endpoint that places, closes, or modifies
// MT5 trades. All execution happens manually, by the user, inside MT5.

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`MORDECAI_EA SCANNER backend running on port ${port}`));
