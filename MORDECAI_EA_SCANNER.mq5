//+------------------------------------------------------------------+
//|                                       MORDECAI_EA_SCANNER.mq5     |
//|  SMART MONEY CONCEPTS - DATA BRIDGE (READ-ONLY)                   |
//|                                                                     |
//|  THIS EA NEVER OPENS, CLOSES, OR MODIFIES TRADES.                 |
//|  It only reads account/market data and pushes it to the cloud     |
//|  backend over HTTPS. All trade decisions are made manually by     |
//|  the user based on signals shown in the MORDECAI_EA SCANNER app.  |
//+------------------------------------------------------------------+
#property copyright "MORDECAI_EA SCANNER"
#property link      ""
#property version   "1.00"
#property strict

//--- INPUTS -----------------------------------------------------------
input string   InpBackendURL      = "https://your-backend.example.com"; // Backend base URL (set after deployment)
input string   InpDeviceToken     = "";                                  // Pairing token from the app (Settings > MT5 Connection)
input string   InpSymbolsWatch    = "EURUSD,GBPUSD,USDJPY,XAUUSD,US30";  // Comma-separated symbols to report on
input int      InpSyncIntervalSec = 5;                                   // How often to push account/position data
input int      InpHistorySyncSec  = 30;                                  // How often to check for newly closed trades

//--- STATE --------------------------------------------------------------
datetime g_lastAccountSync = 0;
datetime g_lastHistorySync = 0;
ulong    g_lastKnownDeal   = 0;

int OnInit()
  {
   // WebRequest requires InpBackendURL to be whitelisted in
   // Tools > Options > Expert Advisors > "Allow WebRequest for listed URL"
   if(InpDeviceToken == "")
     {
      Print("MORDECAI_EA SCANNER: no pairing token set. Open the app, go to MT5 Connection, and paste the token here.");
     }
   EventSetTimer(1);
   Print("MORDECAI_EA SCANNER data bridge started. Read-only mode: no trade actions will ever be sent.");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTimer()
  {
   datetime now = TimeCurrent();

   if(now - g_lastAccountSync >= InpSyncIntervalSec)
     {
      SyncAccountAndPositions();
      g_lastAccountSync = now;
     }

   if(now - g_lastHistorySync >= InpHistorySyncSec)
     {
      SyncClosedHistory();
      g_lastHistorySync = now;
     }
  }

//+------------------------------------------------------------------+
//| Build JSON for account state, open positions and watched symbols  |
//+------------------------------------------------------------------+
void SyncAccountAndPositions()
  {
   string json = "{";
   json += "\"device_token\":\"" + InpDeviceToken + "\",";
   json += "\"broker\":\"" + AccountInfoString(ACCOUNT_COMPANY) + "\",";
   json += "\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\",";
   json += "\"account\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += "\"currency\":\"" + AccountInfoString(ACCOUNT_CURRENCY) + "\",";
   json += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   json += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   json += "\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   json += "\"free_margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   json += "\"margin_level\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + ",";
   json += "\"timestamp\":" + IntegerToString((long)TimeCurrent()) + ",";

   json += "\"positions\":[";
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(i > 0) json += ",";
      json += "{";
      json += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      json += "\"symbol\":\"" + PositionGetString(POSITION_SYMBOL) + "\",";
      json += "\"type\":\"" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "buy" : "sell") + "\",";
      json += "\"volume\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + ",";
      json += "\"price_open\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), _Digits) + ",";
      json += "\"sl\":" + DoubleToString(PositionGetDouble(POSITION_SL), _Digits) + ",";
      json += "\"tp\":" + DoubleToString(PositionGetDouble(POSITION_TP), _Digits) + ",";
      json += "\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + ",";
      json += "\"open_time\":" + IntegerToString((long)PositionGetInteger(POSITION_TIME));
      json += "}";
     }
   json += "],";

   json += "\"symbols\":[";
   string symbols[];
   int symCount = StringSplit(InpSymbolsWatch, ',', symbols);
   for(int s = 0; s < symCount; s++)
     {
      string sym = symbols[s];
      StringTrimLeft(sym); StringTrimRight(sym);
      if(sym == "") continue;
      MqlTick tick;
      if(!SymbolInfoTick(sym, tick)) continue;
      if(s > 0) json += ",";
      json += "{";
      json += "\"symbol\":\"" + sym + "\",";
      json += "\"bid\":" + DoubleToString(tick.bid, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)) + ",";
      json += "\"ask\":" + DoubleToString(tick.ask, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)) + ",";
      json += "\"spread\":" + IntegerToString((long)SymbolInfoInteger(sym, SYMBOL_SPREAD)) + ",";
      json += "\"digits\":" + IntegerToString((long)SymbolInfoInteger(sym, SYMBOL_DIGITS)) + ",";
      json += "\"contract_size\":" + DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE), 2) + ",";
      json += "\"volume_min\":" + DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), 2) + ",";
      json += "\"volume_max\":" + DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), 2) + ",";
      json += "\"volume_step\":" + DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), 2) + ",";
      json += "\"tick_value\":" + DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE), 5) + ",";
      json += "\"tick_size\":" + DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), 5) + ",";
      json += "\"stops_level\":" + IntegerToString((long)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL));
      json += "}";
     }
   json += "]";
   json += "}";

   PostJSON("/api/sync/account", json);
  }

//+------------------------------------------------------------------+
//| Push any newly closed deals since the last known deal ticket      |
//+------------------------------------------------------------------+
void SyncClosedHistory()
  {
   datetime from = 0; // full history; backend dedupes by deal ticket
   if(!HistorySelect(from, TimeCurrent())) return;

   int deals = HistoryDealsTotal();
   string json = "{\"device_token\":\"" + InpDeviceToken + "\",\"account\":" +
                 IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",\"deals\":[";

   bool first = true;
   int sent = 0;
   for(int i = 0; i < deals; i++)
     {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket <= g_lastKnownDeal) continue;
      if(HistoryDealGetInteger(dealTicket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue; // only closed legs

      if(!first) json += ",";
      first = false;
      json += "{";
      json += "\"deal_id\":" + IntegerToString((long)dealTicket) + ",";
      json += "\"order_id\":" + IntegerToString((long)HistoryDealGetInteger(dealTicket, DEAL_ORDER)) + ",";
      json += "\"symbol\":\"" + HistoryDealGetString(dealTicket, DEAL_SYMBOL) + "\",";
      json += "\"type\":\"" + (HistoryDealGetInteger(dealTicket, DEAL_TYPE) == DEAL_TYPE_BUY ? "buy" : "sell") + "\",";
      json += "\"volume\":" + DoubleToString(HistoryDealGetDouble(dealTicket, DEAL_VOLUME), 2) + ",";
      json += "\"price\":" + DoubleToString(HistoryDealGetDouble(dealTicket, DEAL_PRICE), _Digits) + ",";
      json += "\"profit\":" + DoubleToString(HistoryDealGetDouble(dealTicket, DEAL_PROFIT), 2) + ",";
      json += "\"commission\":" + DoubleToString(HistoryDealGetDouble(dealTicket, DEAL_COMMISSION), 2) + ",";
      json += "\"swap\":" + DoubleToString(HistoryDealGetDouble(dealTicket, DEAL_SWAP), 2) + ",";
      json += "\"time\":" + IntegerToString((long)HistoryDealGetInteger(dealTicket, DEAL_TIME));
      json += "}";

      if(dealTicket > g_lastKnownDeal) g_lastKnownDeal = dealTicket;
      sent++;
     }
   json += "]}";

   if(sent > 0) PostJSON("/api/sync/history", json);
  }

//+------------------------------------------------------------------+
//| Generic HTTPS POST helper. READ-ONLY: this file contains no       |
//| function anywhere that calls OrderSend / OrderModify / etc.       |
//+------------------------------------------------------------------+
void PostJSON(string path, string jsonBody)
  {
   string url = InpBackendURL + path;
   string headers = "Content-Type: application/json\r\n";
   char postData[];
   char result[];
   string resultHeaders;

   StringToCharArray(jsonBody, postData, 0, StringLen(jsonBody));

   int res = WebRequest("POST", url, headers, 5000, postData, result, resultHeaders);
   if(res == -1)
     {
      int err = GetLastError();
      if(err == 4060)
         Print("MORDECAI_EA SCANNER: add ", InpBackendURL, " to Tools > Options > Expert Advisors > Allow WebRequest for listed URL.");
      else
         Print("MORDECAI_EA SCANNER: sync failed, error ", err);
     }
  }
//+------------------------------------------------------------------+
