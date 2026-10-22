import { API } from './config.js';

/**
 * Applies one Binance mini-ticker ({ s: 'BTCUSDT', c: close, o: 24h open }) to our coins.
 * `coinForSymbol` maps a ticker like "BTC" to our coin object (or undefined).
 * Returns the coin it updated, or null.
 */
export function applyTicker(t, coinForSymbol, now = Date.now()) {
  if (!t.s?.endsWith('USDT')) return null;
  const coin = coinForSymbol(t.s.slice(0, -4));
  const price = Number(t.c);
  const open = Number(t.o);
  if (!coin || !(price > 0)) return null;
  // Tickers can collide between coins: ignore a Binance pair whose price is far from ours.
  if (coin.usd > 0 && Math.abs(price - coin.usd) / coin.usd > 0.15) return null;
  coin.usd = price;
  if (open > 0) coin.change24h = ((price - open) / open) * 100;
  coin.priced = now;
  coin.live = true;
  return coin;
}

/**
 * Real-time crypto prices from Binance's public market-data stream (about one update per second
 * for every coin traded against USDT). Calls onTick(updatedCoins) after each message.
 * Reconnects with backoff; stop() closes it.
 */
export function startLivePrices({ coinForSymbol, onTick, onState }) {
  let ws = null;
  let stopped = false;
  let retry = 1000;
  let timer;

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(API.binanceStream);
    } catch {
      return schedule();
    }
    ws.addEventListener('open', () => { retry = 1000; onState?.('live'); });
    ws.addEventListener('message', e => {
      let tickers;
      try { tickers = JSON.parse(e.data); } catch { return; }
      const now = Date.now();
      const updated = tickers.map(t => applyTicker(t, coinForSymbol, now)).filter(Boolean);
      if (updated.length) onTick(updated);
    });
    ws.addEventListener('close', () => { onState?.('down'); schedule(); });
    ws.addEventListener('error', () => ws?.close());
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, 30000);
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
