const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error loading config:", err.message);
    return {
      dns: { port: 6767, bind: "0.0.0.0", upstream: ["1.1.1.1", "1.0.0.1"] },
      overrides: []
    };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function startMonitor(logger) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });
  const PORT = process.env.WEB_PORT || 4242;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  function getLogFilePath(filename) {
    if (path.basename(filename) !== filename || !filename.endsWith(".log")) {
      return null;
    }
    return path.join(logger.logsDir, filename);
  }

  // WebSocket for live logs
  wss.on('connection', (ws) => {
    console.log('Web client connected');

    // Send initial data
    ws.send(JSON.stringify({
      type: 'init',
      clients: logger.getClients(),
      logs: logger.getLogs(50)
    }));

    ws.on('close', () => {
      console.log('Web client disconnected');
    });
  });

  // Broadcast function
  function broadcast(data) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  // Hook into logger to broadcast
  const originalLogQuery = logger.logQuery.bind(logger);
  logger.logQuery = function(clientIp, domain, type, result, cached = false) {
    const entry = originalLogQuery(clientIp, domain, type, result, cached);
    broadcast({
      type: 'log',
      entry: {
        timestamp: entry.timestamp,
        clientIp,
        domain,
        type,
        result
      },
      clients: logger.getClients()
    });
    return entry;
  };

  app.get("/api/config", (req, res) => {
    res.json(loadConfig());
  });

  app.post("/api/config", (req, res) => {
    try {
      const config = req.body;
      saveConfig(config);
      res.json({ success: true, message: "Config saved" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/overrides", (req, res) => {
    try {
      const config = loadConfig();
      const override = req.body;
      if (!override.id) {
        override.id = Date.now().toString();
      }
      const idx = config.overrides.findIndex(o => o.id === override.id);
      if (idx >= 0) {
        config.overrides[idx] = override;
      } else {
        config.overrides.push(override);
      }
      saveConfig(config);
      res.json({ success: true, override });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/api/overrides/:id", (req, res) => {
    try {
      const config = loadConfig();
      config.overrides = config.overrides.filter(o => o.id !== req.params.id);
      saveConfig(config);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Client management
  app.get("/api/clients", (req, res) => {
    res.json(logger.getClients());
  });

  app.post("/api/clients/:ip/block", (req, res) => {
    const success = logger.blockClient(req.params.ip);
    broadcast({ type: 'clients', clients: logger.getClients() });
    res.json({ success });
  });

  app.post("/api/clients/:ip/unblock", (req, res) => {
    const success = logger.unblockClient(req.params.ip);
    broadcast({ type: 'clients', clients: logger.getClients() });
    res.json({ success });
  });

  app.delete("/api/clients/:ip", (req, res) => {
    const success = logger.clearClient(req.params.ip);
    broadcast({ type: 'clients', clients: logger.getClients() });
    res.json({ success });
  });

  // Logs
  app.get("/api/logs", (req, res) => {
    const lines = parseInt(req.query.lines) || 100;
    res.json({ logs: logger.getLogs(lines), files: logger.getAllLogFiles() });
  });

  app.get("/api/logs/file/:filename", (req, res) => {
    try {
      const filePath = getLogFilePath(req.params.filename);
      if (!filePath) {
        return res.status(400).json({ error: 'Invalid log filename' });
      }
      const content = fs.readFileSync(filePath, "utf8");
      res.json({ content });
    } catch (err) {
      const status = err.code === 'ENOENT' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.delete("/api/logs/file/:filename", (req, res) => {
    try {
      const filePath = getLogFilePath(req.params.filename);
      if (!filePath) {
        return res.status(400).json({ error: 'Invalid log filename' });
      }
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } catch (err) {
      const status = err.code === 'ENOENT' ? 404 : 500;
      res.status(status).json({ success: false, error: err.message });
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`LocalDNS Web UI running at ${PORT}`);
  });

  return server;
}

module.exports = { startMonitor };

// Keep `node dnsMonitor.js` working as an alias for the integrated server.
if (require.main === module) {
  require("./dnsServer");
}
