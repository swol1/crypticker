class ChartManager {
  constructor() {
    this.charts = new Map();
    this.dpr = window.devicePixelRatio || 1;
    this.width = 80;
    this.height = 30;
  }

  updateCharts(data) {
    Object.entries(data).forEach(([symbol, coinData]) => {
      const canvas = document.getElementById(`chart-${symbol}`);
      if (!canvas || !coinData.history || !coinData.history.length) return;

      const ctx = canvas.getContext("2d");
      const prices = coinData.history;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const range = max - min;
      const pad = range ? range * 0.1 : max * 0.05 || 1;
      const bottom = Math.max(0, min - pad);
      const top = max + pad;
      const denom = top - bottom;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();

      canvas.width = this.width * this.dpr;
      canvas.height = this.height * this.dpr;
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
      ctx.scale(this.dpr, this.dpr);

      ctx.clearRect(0, 0, this.width, this.height);
      ctx.beginPath();

      ctx.strokeStyle = prices[prices.length - 1] >= prices[0] ? "#64ffda" : "#f44336";
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      prices.forEach((price, i) => {
        const x = (i / (prices.length - 1)) * this.width;
        const y = this.height - ((price - bottom) / denom) * this.height;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prevX = ((i - 1) / (prices.length - 1)) * this.width;
          const prevY = this.height - ((prices[i - 1] - bottom) / denom) * this.height;

          const cp1x = prevX + (x - prevX) * 0.5;
          const cp1y = prevY;
          const cp2x = prevX + (x - prevX) * 0.5;
          const cp2y = y;

          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        }
      });

      ctx.stroke();
      ctx.restore();
    });
  }

  createChartContainer(symbol) {
    return `
      <div class="chart-container">
        <canvas id="chart-${symbol}" width="80" height="30"></canvas>
      </div>
    `;
  }
}

window.ChartManager = ChartManager;
