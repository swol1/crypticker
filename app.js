const DEFAULT_ACTIVE_COINS = ["BTC", "SOL"]; // fix later some day maybe

let ws = null;
let lastPrices = {};
let activeCoins = new Set(DEFAULT_ACTIVE_COINS);
let chartManager = new ChartManager();
let coinPriceHistory = new Map();

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
  elements.badges.innerHTML = coins
    .map(
      (symbol) => `
      <div 
        class="badge ${activeCoins.has(symbol) ? "active" : ""}" 
        data-symbol="${symbol}"
        onclick="toggleCoin('${symbol}')"
      >
        ${symbol}
      </div>
    `
    )
    .join("");
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

    const priceClass = calculatePriceState(symbol, price);
    const changeInfo = formatChange(change);

    return `
      <div class="coin" data-symbol="${symbol}" onclick="openExternalLink('https://www.binance.com/en/trade/${symbol}_USDT')">
        <div class="coin-info">
          <span class="symbol">${symbol}</span>
          <span class="volume">Vol: ${formatNumber(volume)}</span>
        </div>
        <div class="price-info">
          <span class="price ${priceClass}">${formatPrice(price)}</span>
          <span class="change ${changeInfo.class}">${changeInfo.symbol} ${changeInfo.value}</span>
        </div>
        ${chartManager.createChartContainer(symbol)}
      </div>
    `;
  } catch (e) {
    console.error(`Error creating coin element for ${symbol}: ${e.message}`);
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

function calculatePriceState(symbol, newPrice) {
  let history = coinPriceHistory.get(symbol) || [];
  history.push(newPrice);
  if (history.length > 5) {
    history.shift();
  }
  coinPriceHistory.set(symbol, history);

  if (history.length < 5) {
    return "price-neutral";
  }

  const oldestPrice = history[0];
  const latestPrice = history[history.length - 1];
  const percentChange = ((latestPrice - oldestPrice) / oldestPrice) * 100;

  let upTicks = 0;
  let downTicks = 0;
  let lastDirection = "flat";

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const current = history[i];

    if (current > prev) {
      upTicks++;
      lastDirection = "up";
    } else if (current < prev) {
      downTicks++;
      lastDirection = "down";
    }
  }

  let momentum = lastDirection === "up" ? upTicks : lastDirection === "down" ? downTicks : 0;

  if (lastDirection === "up" && momentum >= 4 && percentChange >= 0.2) {
    return "price-up-strong";
  } else if (lastDirection === "up" && momentum >= 3 && percentChange >= 0.05 && percentChange < 0.2) {
    return "price-up-slight";
  } else if ((percentChange > -0.05 && percentChange < 0.05) || momentum < 3) {
    return "price-neutral";
  } else if (lastDirection === "down" && momentum >= 3 && percentChange <= -0.05 && percentChange > -0.2) {
    return "price-down-slight";
  } else if (lastDirection === "down" && momentum >= 4 && percentChange <= -0.2) {
    return "price-down-strong";
  }

  return "price-neutral";
}

function updateInterval(interval) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ interval }));
  }
}

initializeApp();
