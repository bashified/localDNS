
const dns2 = require("dns2");
const { Packet } = dns2;
const { Resolver } = require("node:dns").promises;
const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const Logger = require("./logger");

const upstreamResolver = new Resolver();
const logger = new Logger();

let config = {
    dns: {
        port: 6767,
        bind: "0.0.0.0",
        upstream: ["1.1.1.1", "1.0.0.1"]
    },
    overrides: []
};

const configPath = path.join(__dirname, "config.json");

function normalizeName(name) {
    return String(name).replace(/\.$/, "").toLowerCase();
}

function getTypeName(type) {
    const direct = Packet.TYPE[type];

    if (typeof direct === "string") {
        return direct.toUpperCase();
    }

    const reverse = Object.keys(Packet.TYPE).find(
        key => Packet.TYPE[key] === type
    );

    return reverse ? reverse.toUpperCase() : String(type);
}

function loadConfig() {
    try {
        if (!fs.existsSync(configPath)) {
            console.log("No config.json found, using defaults");
            upstreamResolver.setServers(["1.1.1.1", "1.0.0.1"]);
            return;
        }

        const raw = fs.readFileSync(configPath, "utf8");
        const newConfig = JSON.parse(raw);

        if (newConfig.dns?.upstream) {
            upstreamResolver.setServers(newConfig.dns.upstream);
        }

        config = {
            ...config,
            ...newConfig,
            dns: {
                ...config.dns,
                ...newConfig.dns
            }
        };

        const activeOverrides = config.overrides.filter(
            override => override && override.enabled === true
        );

        console.log(`Loaded config from: ${configPath}`);
        console.log(`Loaded config with ${activeOverrides.length} active overrides`);

    } catch (err) {
        console.error("Error loading config:", err.message);
    }
}

loadConfig();

// Watch for configuration changes
if (fs.existsSync(configPath)) {
    fs.watchFile(configPath, { interval: 1000 }, () => {
        console.log("Config file changed, reloading...");
        loadConfig();
    });
}

const server = dns2.createServer({
    udp: true,
    tcp: true,

    handle: async (request, send, rinfo) => {
        const response = Packet.createResponseFromRequest(request);
        const clientIp = rinfo.address;

        // Check if client is blocked
        const clientInfo = logger.clients.get(clientIp);

        if (clientInfo && clientInfo.blocked) {
            response.header.rcode = 5;

            logger.logQuery(
                clientIp,
                request.questions?.[0]?.name || "?",
                getTypeName(request.questions?.[0]?.type),
                "REFUSED"
            );

            send(response);
            return;
        }

        // Validate request
        if (!request.questions || request.questions.length === 0) {
            response.header.rcode = 1;
            send(response);
            return;
        }

        const question = request.questions[0];
        const { name, type } = question;
        const typeName = getTypeName(type);

        console.log(`DNS ${clientIp}:${rinfo.port} → ${name} (${typeName})`);

        try {
            // Check local overrides
            const override = Array.isArray(config.overrides)
                ? config.overrides.find(o =>
                    o &&
                    o.enabled === true &&
                    normalizeName(o.name) === normalizeName(name) &&
                    String(o.type).toUpperCase() === typeName
                )
                : undefined;

            if (override) {
                const overrideType = String(override.type).toUpperCase();

                if (overrideType === "A" && type === Packet.TYPE.A) {
                    response.answers.push({
                        name,
                        type: Packet.TYPE.A,
                        class: Packet.CLASS.IN,
                        ttl: override.ttl || 60,
                        address: override.value
                    });

                } else if (
                    overrideType === "AAAA" &&
                    type === Packet.TYPE.AAAA
                ) {
                    response.answers.push({
                        name,
                        type: Packet.TYPE.AAAA,
                        class: Packet.CLASS.IN,
                        ttl: override.ttl || 60,
                        address: override.value
                    });

                } else if (
                    overrideType === "CNAME" &&
                    type === Packet.TYPE.CNAME
                ) {
                    response.answers.push({
                        name,
                        type: Packet.TYPE.CNAME,
                        class: Packet.CLASS.IN,
                        ttl: override.ttl || 300,
                        domain: override.value
                    });
                }

                if (response.answers.length > 0) {
                    response.header.rcode = 0;

                    logger.logQuery(
                        clientIp,
                        name,
                        typeName,
                        `OVERRIDE->${override.value}`
                    );

                    send(response);
                    return;
                }
            }

            // Resolve through upstream DNS
            let answers = [];

            switch (type) {
                case Packet.TYPE.A: {
                    const ips = await upstreamResolver.resolve4(name);

                    answers = ips.map(ip => ({
                        name,
                        type,
                        class: Packet.CLASS.IN,
                        ttl: 300,
                        address: ip
                    }));

                    logger.logQuery(
                        clientIp,
                        name,
                        typeName,
                        `UPSTREAM->${ips.join(",")}`
                    );
                    break;
                }

                case Packet.TYPE.AAAA: {
                    const ips = await upstreamResolver.resolve6(name);

                    answers = ips.map(ip => ({
                        name,
                        type,
                        class: Packet.CLASS.IN,
                        ttl: 300,
                        address: ip
                    }));

                    logger.logQuery(
                        clientIp,
                        name,
                        typeName,
                        `UPSTREAM->${ips.join(",")}`
                    );
                    break;
                }

                case Packet.TYPE.CNAME: {
                    const cnames = await upstreamResolver.resolveCname(name);

                    answers = cnames.map(cname => ({
                        name,
                        type,
                        class: Packet.CLASS.IN,
                        ttl: 300,
                        domain: cname
                    }));

                    logger.logQuery(
                        clientIp,
                        name,
                        typeName,
                        `UPSTREAM->${cnames.join(",")}`
                    );
                    break;
                }

                default: {
                    try {
                        const records = await upstreamResolver.resolve(
                            name,
                            typeName
                        );

                        answers = records.map(record => ({
                            name,
                            type,
                            class: Packet.CLASS.IN,
                            ttl: 300,
                            data: typeof record === "string"
                                ? record
                                : JSON.stringify(record)
                        }));

                        logger.logQuery(
                            clientIp,
                            name,
                            typeName,
                            "UPSTREAM->OK"
                        );

                    } catch (err) {
                        if (err.code === "ENODATA") {
                            response.header.rcode = 0;

                            logger.logQuery(
                                clientIp,
                                name,
                                typeName,
                                "NOERROR/NODATA"
                            );

                            send(response);
                            return;
                        }

                        throw err;
                    }
                    break;
                }
            }

            if (answers.length > 0) {
                response.answers.push(...answers);
            }

            response.header.rcode = 0;

        } catch (err) {
            if (err.code === "ENODATA") {
                response.header.rcode = 0;
            } else if (err.code === "ENOTFOUND") {
                response.header.rcode = 3;
            } else {
                response.header.rcode = 2;
                console.error(`Resolution error for ${name}:`, err.message);
            }

            logger.logQuery(
                clientIp,
                name,
                typeName,
                `ERROR/${err.code || "UNKNOWN"}`
            );
        }

        send(response);
    }
});

server.on("listening", () => {
    console.log("LocalDNS server listening on:");
    console.log(server.addresses());
});

server.on("error", err => {
    console.error("DNS server error:", err);
});

server.listen({
    udp: {
        port: config.dns.port || 6767,
        address: config.dns.bind || "0.0.0.0",
        type: "udp4"
    },
    tcp: {
        port: config.dns.port || 6767,
        address: config.dns.bind || "0.0.0.0"
    }
});

function startWebPortal() {
    const app = express();
    const webServer = http.createServer(app);
    const wss = new WebSocket.Server({ server: webServer });
    const port = process.env.WEB_PORT || 4242;

    app.use(express.json());
    app.use(express.static(path.join(__dirname, "public")));

    function readConfig() {
        try {
            return JSON.parse(fs.readFileSync(configPath, "utf8"));
        } catch (err) {
            console.error("Error loading config:", err.message);
            return {
                dns: {
                    port: 6767,
                    bind: "0.0.0.0",
                    upstream: ["1.1.1.1", "1.0.0.1"]
                },
                overrides: []
            };
        }
    }

    function saveConfig(newConfig) {
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    }

    function getLogFilePath(filename) {
        if (path.basename(filename) !== filename || !filename.endsWith(".log")) {
            return null;
        }
        return path.join(logger.logsDir, filename);
    }

    function broadcast(data) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }

    wss.on("connection", ws => {
        console.log("Web client connected");

        ws.send(JSON.stringify({
            type: "init",
            clients: logger.getClients(),
            logs: logger.getLogs(50)
        }));

        ws.on("close", () => {
            console.log("Web client disconnected");
        });
    });

    // Broadcast queries while retaining the same logger used by the DNS server.
    const originalLogQuery = logger.logQuery.bind(logger);
    logger.logQuery = function(clientIp, domain, type, result, cached = false) {
        const entry = originalLogQuery(clientIp, domain, type, result, cached);
        broadcast({
            type: "log",
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
        res.json(readConfig());
    });

    app.post("/api/config", (req, res) => {
        try {
            saveConfig(req.body);
            res.json({ success: true, message: "Config saved" });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post("/api/overrides", (req, res) => {
        try {
            const currentConfig = readConfig();
            const override = req.body;
            if (!override.id) {
                override.id = Date.now().toString();
            }
            const idx = currentConfig.overrides.findIndex(o => o.id === override.id);
            if (idx >= 0) {
                currentConfig.overrides[idx] = override;
            } else {
                currentConfig.overrides.push(override);
            }
            saveConfig(currentConfig);
            res.json({ success: true, override });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.delete("/api/overrides/:id", (req, res) => {
        try {
            const currentConfig = readConfig();
            currentConfig.overrides = currentConfig.overrides.filter(
                o => o.id !== req.params.id
            );
            saveConfig(currentConfig);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.get("/api/clients", (req, res) => {
        res.json(logger.getClients());
    });

    app.post("/api/clients/:ip/block", (req, res) => {
        const success = logger.blockClient(req.params.ip);
        broadcast({ type: "clients", clients: logger.getClients() });
        res.json({ success });
    });

    app.post("/api/clients/:ip/unblock", (req, res) => {
        const success = logger.unblockClient(req.params.ip);
        broadcast({ type: "clients", clients: logger.getClients() });
        res.json({ success });
    });

    app.delete("/api/clients/:ip", (req, res) => {
        const success = logger.clearClient(req.params.ip);
        broadcast({ type: "clients", clients: logger.getClients() });
        res.json({ success });
    });

    app.get("/api/logs", (req, res) => {
        const lines = parseInt(req.query.lines) || 100;
        res.json({
            logs: logger.getLogs(lines),
            files: logger.getAllLogFiles()
        });
    });

    app.get("/api/logs/file/:filename", (req, res) => {
        try {
            const filePath = getLogFilePath(req.params.filename);
            if (!filePath) {
                return res.status(400).json({ error: "Invalid log filename" });
            }
            const content = fs.readFileSync(filePath, "utf8");
            res.json({ content });
        } catch (err) {
            const status = err.code === "ENOENT" ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    });

    app.delete("/api/logs/file/:filename", (req, res) => {
        try {
            const filePath = getLogFilePath(req.params.filename);
            if (!filePath) {
                return res.status(400).json({ error: "Invalid log filename" });
            }
            fs.unlinkSync(filePath);
            res.json({ success: true });
        } catch (err) {
            const status = err.code === "ENOENT" ? 404 : 500;
            res.status(status).json({ success: false, error: err.message });
        }
    });

    webServer.listen(port, "0.0.0.0", () => {
        console.log(`LocalDNS Web UI running at ${port}`);
    });

    return webServer;
}

const webServer = startWebPortal();

module.exports = { logger, server, webServer };
