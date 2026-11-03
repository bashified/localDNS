
const dns2 = require("dns2");
const { Packet } = dns2;
const { Resolver } = require("node:dns").promises;
const fs = require("fs");
const path = require("path");
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

// Run the portal in the DNS process so both share the same logger and clients.
const { startMonitor } = require("./dnsMonitor");
startMonitor(logger);

module.exports = { logger, server };
