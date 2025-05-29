const DEFAULT_ACTIVE_COINS = ["BTC", "SOL"]; // fix later some day maybe

let ws = null;
let lastPrices = {};
let prevPrices = {};
let activeCoins = new Set(DEFAULT_ACTIVE_COINS);
let chartManager = new ChartManager();

const elements = {
  error: document.getElementById("error"),
  loading: document.getElementById("loading"),
  badges: document.querySelector(".badges"),
  ticker: document.getElementById("ticker"),
};

async function initializeApp() {
  try {
    const response = await fetch("/coins");
    if (!response.ok) {
      throw new Error("Failed to fetch coins");
    }
    coins = await response.json();
    createBadges(coins);
    connect();
  } catch (error) {
    showError(`Failed to initialize: ${error.message}`);
  }
}

function connect() {
  if (ws) ws.close();
  elements.loading.style.display = "block";

  ws = new WebSocket(`ws://${window.location.host}/ws`);

  ws.onopen = () => {
    elements.loading.style.display = "none";
  };

  ws.onmessage = handleWebSocketMessage;
  ws.onerror = (error) => {
    showError(`WebSocket error: ${error.message}`);
  };
  ws.onclose = () => {
    elements.loading.style.display = "block";
    setTimeout(connect, 1000);
  };
}

function handleWebSocketMessage(event) {
  try {
    const data = JSON.parse(event.data);
    lastPrices = data;
    updateUI(data);
    chartManager.updateCharts(data);
  } catch (e) {
    showError(`Error parsing data: ${e.message}`);
  }
}

function updateUI(data) {
  if (!Object.keys(data).length) {
    elements.loading.style.display = "block";
    return;
  }

  elements.loading.style.display = "none";

  try {
    const html = Array.from(activeCoins)
      .map((symbol) => createCoinElement(symbol, data[symbol]))
      .join("");
    elements.ticker.innerHTML = html;
  } catch (e) {
    showError(`Error updating UI: ${e.message}`);
  }
}

function createBadges(coins) {
  elements.badges.innerHTML = coins.map(
    (symbol) => `
      <div 
        class="badge ${activeCoins.has(symbol) ? "active" : ""}" 
        data-symbol="${symbol}"
        onclick="toggleCoin('${symbol}')"
      >
        ${symbol}
      </div>
    `
  ).join("");
}

function toggleCoin(symbol) {
  if (activeCoins.has(symbol)) {
    activeCoins.delete(symbol);
  } else {
    activeCoins.add(symbol);
  }

  const badge = document.querySelector(`.badge[data-symbol="${symbol}"]`);
  badge.classList.toggle("active");

  updateUI(lastPrices);

  const activeData = {};
  activeCoins.forEach((coin) => {
    if (lastPrices[coin]) {
      activeData[coin] = lastPrices[coin];
    }
  });

  if (Object.keys(activeData).length > 0) {
    chartManager.updateCharts(activeData);
  }
}

function createCoinElement(symbol, data) {
  if (!data) return "";

  try {
    const price = parseFloat(data.price) || 0;
    const change = parseFloat(data.change24h) || 0;
    const volume = parseFloat(data.volume) || 0;

    const prev = prevPrices[symbol] ?? price;
    const isDown = price < prev;
    prevPrices[symbol] = price;

    const changeInfo = formatChange(change);

    return `
      <div class="coin" data-symbol="${symbol}">
        <div class="coin-info">
          <span class="symbol">${symbol}</span>
          <span class="volume">Vol: ${formatNumber(volume)}</span>
        </div>
        <div class="price-info">
          <span class="price${isDown ? " price-down" : ""}">${formatPrice(price)}</span>
          <span class="change ${changeInfo.class}">${changeInfo.symbol} ${changeInfo.value}</span>
        </div>
        ${chartManager.createChartContainer(symbol)}
      </div>
    `;
  } catch (e) {
    return "";
  }
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.style.display = "block";
  setTimeout(() => (elements.error.style.display = "none"), 5000);
}

function formatPrice(price) {
  return `${price.toFixed(2)} USDT`;
}

function formatChange(change) {
  const isPositive = change >= 0;
  return {
    symbol: isPositive ? "↑" : "↓",
    value: `${Math.abs(change).toFixed(2)}%`,
    class: isPositive ? "positive" : "negative",
  };
}

function formatNumber(num) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(num);
}

function updateInterval(interval) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ interval }));
  }
}

initializeApp();
