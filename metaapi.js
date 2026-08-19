// Wraps the MetaApi cloud SDK (https://metaapi.cloud) so this backend can read
// balance/positions/history for an MT5 account WITHOUT any terminal running on
// the client's own machine. MetaApi runs the actual MT5 session in their cloud.
//
// Setup required (see README "Login-based MT5 connection" section):
//   1. Create a free account at https://metaapi.cloud
//   2. Generate an API token, put it in backend/.env as METAAPI_TOKEN
//   3. npm install metaapi.cloud-sdk  (in backend/)
//
// IMPORTANT: this file is a best-effort integration written against MetaApi's
// documented SDK usage pattern. MetaApi's SDK evolves - if a call here errors,
// check https://metaapi.cloud/docs/client/ for the current method names before
// assuming the credentials are wrong.
//
// This module only ever READS account data (accountInformation, positions,
// history). It never calls any trade-placing method (createMarketBuyOrder,
// createMarketSellOrder, modifyPosition, etc.) - none of those are imported
// or referenced anywhere below, by design.

let MetaApiSDK = null;
async function loadSdk() {
  if (MetaApiSDK) return MetaApiSDK;
  try {
    const mod = await import('metaapi.cloud-sdk');
    MetaApiSDK = mod.default || mod;
    return MetaApiSDK;
  } catch (err) {
    throw new Error('metaapi.cloud-sdk is not installed. Run: npm install metaapi.cloud-sdk (in backend/)');
  }
}

function requireToken() {
  const token = process.env.METAAPI_TOKEN;
  if (!token) throw new Error('METAAPI_TOKEN is not set in backend/.env - see README for MetaApi setup');
  return token;
}

// Provisions (or re-uses) a MetaApi account entry for this login/server, using
// the INVESTOR (read-only) password. Returns MetaApi's internal account id,
// which is what gets stored - never the password itself.
export async function linkAccount({ login, investorPassword, server, label }) {
  const MetaApi = await loadSdk();
  const api = new MetaApi(requireToken());

  const existing = await api.metatraderAccountApi.getAccounts().catch(() => []);
  let account = existing.find(a => String(a.login) === String(login) && a.server === server);

  if (!account) {
    account = await api.metatraderAccountApi.createAccount({
      name: label || `MORDECAI-${login}`,
      type: 'cloud',
      login: String(login),
      password: investorPassword, // investor/read-only password only
      server,
      platform: 'mt5',
      magic: 0
    });
  }

  await account.deploy();
  await account.waitConnected();
  return account.id;
}

export async function fetchAccountSnapshot(metaapiAccountId) {
  const MetaApi = await loadSdk();
  const api = new MetaApi(requireToken());
  const account = await api.metatraderAccountApi.getAccount(metaapiAccountId);
  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  const info = await connection.getAccountInformation();
  const positions = await connection.getPositions();

  return {
    broker: info.broker,
    server: info.server,
    currency: info.currency,
    balance: info.balance,
    equity: info.equity,
    margin: info.margin,
    freeMargin: info.freeMargin,
    marginLevel: info.marginLevel,
    positions: (positions || []).map(p => ({
      ticket: p.id, symbol: p.symbol, type: p.type === 'POSITION_TYPE_BUY' ? 'buy' : 'sell',
      volume: p.volume, price_open: p.openPrice, sl: p.stopLoss, tp: p.takeProfit,
      profit: p.profit, open_time: p.time ? new Date(p.time).getTime() / 1000 : null
    }))
  };
}

export async function fetchClosedHistory(metaapiAccountId, sinceMs) {
  const MetaApi = await loadSdk();
  const api = new MetaApi(requireToken());
  const account = await api.metatraderAccountApi.getAccount(metaapiAccountId);
  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  const from = new Date(sinceMs || 0);
  const to = new Date();
  const deals = await connection.getDealsByTimeRange(from, to);

  return (deals || [])
    .filter(d => d.entryType === 'DEAL_ENTRY_OUT')
    .map(d => ({
      deal_id: d.id, order_id: d.orderId, symbol: d.symbol,
      type: d.type === 'DEAL_TYPE_BUY' ? 'buy' : 'sell', volume: d.volume, price: d.price,
      profit: d.profit, commission: d.commission, swap: d.swap,
      time: Math.floor(new Date(d.time).getTime() / 1000)
    }));
}
