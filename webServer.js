const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.WEB_PORT || 8080;
const CONFIG_PATH = path.join(__dirname, "config.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

app.listen(PORT, () => {
  console.log(`LocalDNS Web UI running at http://localhost:${PORT}`);
});
