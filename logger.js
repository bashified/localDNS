const fs = require("fs");
const path = require("path");

class Logger {
  constructor() {
    this.logsDir = path.join(__dirname, "logs");
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
    this.logFile = path.join(this.logsDir, `dns-${this.getDateString()}.log`);
    this.clients = new Map(); // ip -> client info
  }

  getDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  logQuery(clientIp, domain, type, result, cached = false) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      clientIp,
      domain,
      type,
      result,
      cached
    };
    
    // Track client
    if (!this.clients.has(clientIp)) {
      this.clients.set(clientIp, {
        ip: clientIp,
        firstSeen: timestamp,
        lastSeen: timestamp,
        queryCount: 0,
        blocked: false,
        hostname: null
      });
    }
    
    const client = this.clients.get(clientIp);
    client.lastSeen = timestamp;
    client.queryCount++;
    
    // Write to file
    const logLine = `[${timestamp}] ${clientIp} -> ${domain} (${type}) [${result}]${cached ? ' (cached)' : ''}\n`;
    fs.appendFile(this.logFile, logLine, (err) => {
      if (err) console.error("Log write error:", err);
    });
    
    return entry;
  }

  getClients() {
    return Array.from(this.clients.values());
  }

  blockClient(ip) {
    if (this.clients.has(ip)) {
      this.clients.get(ip).blocked = true;
      return true;
    }
    return false;
  }

  unblockClient(ip) {
    if (this.clients.has(ip)) {
      this.clients.get(ip).blocked = false;
      return true;
    }
    return false;
  }

  clearClient(ip) {
    this.clients.delete(ip);
    return true;
  }

  getLogs(lines = 100) {
    try {
      const content = fs.readFileSync(this.logFile, "utf8");
      const allLines = content.trim().split('\n').filter(l => l);
      return allLines.slice(-lines).reverse();
    } catch (err) {
      return [];
    }
  }

  getAllLogFiles() {
    try {
      return fs.readdirSync(this.logsDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logsDir, f),
          size: fs.statSync(path.join(this.logsDir, f)).size
        }))
        .sort((a,b) => b.name.localeCompare(a.name));
    } catch (err) {
      return [];
    }
  }
}

module.exports = Logger;
