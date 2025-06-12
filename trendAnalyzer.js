const PRICE_HISTORY_LENGTH = 20; // ~3.3 min of 10 s ticks
const MOMENTUM_REQUIREMENT_STRONG = 14; // ≥70% for "strong"
const MOMENTUM_REQUIREMENT_SLIGHT = 11; // ≥55% for "slight"
const BASE_THRESHOLD = 1.8;
const SLIGHT_TREND_FACTOR = 0.6;
const VOLATILITY_MULTIPLIER = 0.3;
const VOLATILITY_CAP = 2.0;
const HYSTERESIS_BUFFER = 0.15;

// Logging configuration
const LOGGING_ENABLED = false;

function log(symbol, message, data = null) {
  if (!LOGGING_ENABLED) return;
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${symbol}] ${message}`;
  if (data) {
    console.log(logMessage, data);
  } else {
    console.log(logMessage);
  }
}

class TrendAnalyzer {
  constructor() {
    this.priceHistory = new Map();
    this.lastStates = new Map();
    log("SYSTEM", "TrendAnalyzer initialized");
  }

  calculatePriceState(symbol, newPrice) {
    let history = this.priceHistory.get(symbol);
    if (!history) {
      history = [];
      this.priceHistory.set(symbol, history);
      log(symbol, "Created new price history array", { capacity: PRICE_HISTORY_LENGTH });
    }

    history.push(newPrice);
    if (history.length > PRICE_HISTORY_LENGTH) {
      history.shift();
    }
    log(symbol, "New price added to history", { price: newPrice, historySize: history.length });

    if (history.length < PRICE_HISTORY_LENGTH) {
      log(symbol, "Insufficient history length", {
        current: history.length,
        required: PRICE_HISTORY_LENGTH,
      });
      return "price-neutral";
    }

    log(symbol, "Full price history", {
      prices: history,
      oldest: history[0],
      newest: history[history.length - 1],
    });

    let sumUp = 0;
    let sumDown = 0;
    let totalMove = 0;
    let maxMove = 0;
    let lastPrice = null;
    let recentMoves = [];

    for (let i = 0; i < history.length; i++) {
      const price = history[i];
      if (lastPrice === null) {
        lastPrice = price;
        continue;
      }

      const move = price - lastPrice;
      const absMove = Math.abs(move);

      if (move > 0) {
        sumUp += absMove;
        recentMoves.push(1);
      } else if (move < 0) {
        sumDown += absMove;
        recentMoves.push(-1);
      } else {
        recentMoves.push(0);
      }

      totalMove += absMove;
      maxMove = Math.max(maxMove, absMove);
      lastPrice = price;
    }

    const avgMove = totalMove / (history.length - 1);
    const volatility = Math.min(maxMove / avgMove, VOLATILITY_CAP);
    const threshold = BASE_THRESHOLD + volatility * VOLATILITY_MULTIPLIER;

    const netMove = sumUp - sumDown;
    const movementQuality = Math.abs(netMove) / avgMove;

    const upMoves = recentMoves.filter((move) => move > 0).length;
    const downMoves = recentMoves.filter((move) => move < 0).length;

    const upMomentum = upMoves / PRICE_HISTORY_LENGTH;
    const downMomentum = downMoves / PRICE_HISTORY_LENGTH;

    const hasStrongUpMomentum = upMoves >= MOMENTUM_REQUIREMENT_STRONG;
    const hasStrongDownMomentum = downMoves >= MOMENTUM_REQUIREMENT_STRONG;
    const hasSlightUpMomentum = upMoves >= MOMENTUM_REQUIREMENT_SLIGHT;
    const hasSlightDownMomentum = downMoves >= MOMENTUM_REQUIREMENT_SLIGHT;

    log(symbol, "Movement analysis", {
      sumUp,
      sumDown,
      netMove,
      totalMove,
      maxMove,
      avgMove,
      volatility,
      threshold,
      movementQuality,
      allMoves: recentMoves,
      upMoves,
      downMoves,
      upMomentum,
      downMomentum,
      hasStrongUpMomentum,
      hasStrongDownMomentum,
      hasSlightUpMomentum,
      hasSlightDownMomentum,
    });

    const direction = netMove > 0 ? 1 : -1;
    const lastState = this.lastStates.get(symbol) || "price-neutral";
    const isStrongState = lastState.includes("strong");

    let newState;

    if (movementQuality > threshold && hasStrongUpMomentum) {
      newState = "price-up-strong";
    } else if (movementQuality > threshold && hasStrongDownMomentum) {
      newState = "price-down-strong";
    }
    else if (movementQuality > threshold * SLIGHT_TREND_FACTOR && hasSlightUpMomentum) {
      newState = "price-up-slight";
    } else if (movementQuality > threshold * SLIGHT_TREND_FACTOR && hasSlightDownMomentum) {
      newState = "price-down-slight";
    } else {
      newState = "price-neutral";
    }

    log(symbol, "State calculation", {
      direction,
      movementQuality,
      threshold,
      hasStrongUpMomentum,
      hasStrongDownMomentum,
      hasSlightUpMomentum,
      hasSlightDownMomentum,
      lastState,
      newState,
    });

    if (lastState !== newState) {
      const currentThreshold = isStrongState ? threshold : threshold * SLIGHT_TREND_FACTOR;
      const requiredQuality = currentThreshold * (1 + HYSTERESIS_BUFFER);

      if (movementQuality < requiredQuality) {
        log(symbol, "Hysteresis applied - keeping previous state", {
          requiredQuality,
          movementQuality,
          lastState,
        });
        newState = lastState;
      }
    }

    this.lastStates.set(symbol, newState);
    log(symbol, "Final state determined", { newState });
    return newState;
  }
}

window.TrendAnalyzer = TrendAnalyzer;
