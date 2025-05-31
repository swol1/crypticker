package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	webview "github.com/webview/webview_go"
)

// #cgo darwin CFLAGS: -x objective-c
// #cgo darwin LDFLAGS: -framework Cocoa
// #import <Cocoa/Cocoa.h>
//
// void setAlwaysOnTop() {
//     NSApplication *app = [NSApplication sharedApplication];
//     NSArray *windows = [app windows];
//     for (NSWindow *window in windows) {
//         [window setLevel:NSFloatingWindowLevel];
//     }
// }
import "C"

type (
	PriceResponse struct {
		Symbol             string `json:"symbol"`
		Price              string `json:"lastPrice"`
		Volume             string `json:"volume"`
		PriceChangePercent string `json:"priceChangePercent"`
	}

	CoinData struct {
		Price     string    `json:"price"`
		Volume    string    `json:"volume"`
		Change24h string    `json:"change24h"`
		History   []float64 `json:"history"`
		Interval  string    `json:"interval"`
	}

	Prices map[string]CoinData

	intervalConfig struct {
		startTime time.Duration
		limit     int
	}
)

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	wsConnections   = make(map[*websocket.Conn]bool)
	wsMutex         sync.RWMutex
	lastPrices      = make(Prices)
	pricesMutex     sync.RWMutex
	availableCoins  = []string{"BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "TRX", "SUI"}
	currentInterval = "5m"
	debug           = false
	updateInterval  = 10 * time.Second

	intervalConfigs = map[string]intervalConfig{
		"5m":  {12 * time.Hour, 144},     // 12h * 12 (5min intervals)
		"15m": {36 * time.Hour, 144},     // 36h * 4 (15min intervals)
		"30m": {72 * time.Hour, 144},     // 72h * 2 (30min intervals)
		"1h":  {144 * time.Hour, 144},    // 144h (6 days)
		"1d":  {30 * 24 * time.Hour, 30}, // 30 days
	}
)

func logDebug(format string, v ...interface{}) {
	if debug {
		log.Printf(format, v...)
	}
}

func fetchPrice(ctx context.Context, symbol string) (*PriceResponse, error) {
	url := fmt.Sprintf("https://api.binance.com/api/v3/ticker/24hr?symbol=%sUSDT", symbol)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("making request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var pr PriceResponse
	if err := json.Unmarshal(body, &pr); err != nil {
		return nil, fmt.Errorf("unmarshaling response: %w", err)
	}

	return &pr, nil
}

func fetchHistoricalData(ctx context.Context, symbol string, interval string) ([]float64, error) {
	config := intervalConfigs[interval]

	endTime := time.Now()
	startTime := endTime.Add(-config.startTime)

	url := fmt.Sprintf(
		"https://api.binance.com/api/v3/klines?symbol=%sUSDT&interval=%s&startTime=%d&endTime=%d&limit=%d",
		symbol,
		interval,
		startTime.UnixMilli(),
		endTime.UnixMilli(),
		config.limit,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("making request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	var klines [][]any
	if err := json.Unmarshal(body, &klines); err != nil {
		return nil, fmt.Errorf("unmarshaling response: %w", err)
	}

	prices := make([]float64, len(klines))
	for i, kline := range klines {
		if len(kline) > 4 {
			closePrice, _ := strconv.ParseFloat(kline[4].(string), 64)
			prices[i] = closePrice
		}
	}

	return prices, nil
}

func broadcastUpdate(prices Prices) {
	wsMutex.RLock()
	defer wsMutex.RUnlock()

	for conn := range wsConnections {
		if err := conn.WriteJSON(prices); err != nil {
			logDebug("Failed to broadcast to client: %v", err)
		}
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	logDebug("New WebSocket connection request from %s", r.RemoteAddr)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logDebug("Failed to upgrade connection: %v", err)
		return
	}

	wsMutex.Lock()
	wsConnections[conn] = true
	wsMutex.Unlock()

	defer func() {
		wsMutex.Lock()
		delete(wsConnections, conn)
		wsMutex.Unlock()
		conn.Close()
		logDebug("WebSocket connection closed")
	}()

	logDebug("Sending initial data to client")
	pricesMutex.RLock()
	if err := conn.WriteJSON(lastPrices); err != nil {
		logDebug("Failed to send initial data: %v", err)
		pricesMutex.RUnlock()
		return
	}
	pricesMutex.RUnlock()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			logDebug("Error reading message: %v", err)
			break
		}

		var data struct {
			Interval string `json:"interval"`
		}
		if err := json.Unmarshal(message, &data); err == nil && data.Interval != "" {
			logDebug("Received interval update request: %s", data.Interval)
			currentInterval = data.Interval
			updateAllPrices()
		}
	}
}

func updateAllPrices() {
	logDebug("Updating prices for all coins")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	type result struct {
		symbol  string
		price   *PriceResponse
		history []float64
		err     error
	}

	results := make(chan result, len(availableCoins))
	var wg sync.WaitGroup

	wg.Add(len(availableCoins))

	for _, symbol := range availableCoins {
		go func(sym string) {
			defer wg.Done()

			pr, err := fetchPrice(ctx, sym)
			if err != nil {
				logDebug("Failed to fetch price for %s: %v", sym, err)
				results <- result{symbol: sym, err: err}
				return
			}

			history, err := fetchHistoricalData(ctx, sym, currentInterval)
			if err != nil {
				logDebug("Failed to fetch history for %s: %v", sym, err)
				history = []float64{}
			}

			results <- result{
				symbol:  sym,
				price:   pr,
				history: history,
			}
		}(symbol)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	pricesMutex.Lock()
	defer pricesMutex.Unlock()

	for res := range results {
		if res.err != nil {
			continue
		}

		lastPrices[res.symbol] = CoinData{
			Price:     res.price.Price,
			Volume:    res.price.Volume,
			Change24h: res.price.PriceChangePercent,
			History:   res.history,
			Interval:  currentInterval,
		}
		logDebug("Updated %s: price=%s, volume=%s, change=%s",
			res.symbol, res.price.Price, res.price.Volume, res.price.PriceChangePercent)
	}

	logDebug("Broadcasting updates to %d clients", len(wsConnections))
	broadcastUpdate(lastPrices)
}

func updatePrices() {
	ticker := time.NewTicker(updateInterval)
	defer ticker.Stop()

	for len(wsConnections) == 0 {
		time.Sleep(100 * time.Millisecond)
	}

	updateAllPrices()

	for range ticker.C {
		updateAllPrices()
	}
}

func main() {
	fs := http.FileServer(http.Dir("."))
	http.Handle("/", fs)

	http.HandleFunc("/ws", wsHandler)
	http.HandleFunc("/coins", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(availableCoins)
	})
	http.HandleFunc("/history", func(w http.ResponseWriter, r *http.Request) {
		symbol := r.URL.Query().Get("symbol")
		interval := r.URL.Query().Get("interval")

		if symbol == "" || interval == "" {
			http.Error(w, "Missing symbol or interval", http.StatusBadRequest)
			return
		}

		history, err := fetchHistoricalData(r.Context(), symbol, interval)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(history)
	})

	go func() {
		log.Fatal(http.ListenAndServe("127.0.0.1:8080", nil))
	}()
	go updatePrices()
	debug = false
	w := webview.New(debug)
	defer w.Destroy()

	w.SetSize(370, 230, webview.HintNone)
	w.Navigate(fmt.Sprintf("http://127.0.0.1:8080/?v=%d", time.Now().UnixNano()))

	if err := w.Bind("openExternalLink", openExternalLink); err != nil {
		log.Fatalf("Failed to bind openExternalLink: %v", err)
	}

	if runtime.GOOS == "darwin" {
		time.Sleep(1 * time.Second)
		C.setAlwaysOnTop()
	}

	w.Run()
}

func openExternalLink(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin": // macOS
		cmd = exec.Command("open", url)
	case "windows": // Windows
		cmd = exec.Command("cmd", "/c", "start", url)
	case "linux": // Linux
		cmd = exec.Command("xdg-open", url)
	default:
		log.Printf("Unsupported operating system: %s", runtime.GOOS)
		return
	}

	if err := cmd.Start(); err != nil {
		log.Printf("Failed to open URL %s: %v", url, err)
	}
}
