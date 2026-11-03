const dns2 = require("dns2");
const { Packet } = dns2;
const { Resolver } = require("node:dns").promises;
const fs = require("fs");
const path = require("path");

// Initialize an isolated upstream resolver
const upstreamResolver = new Resolver();

// Load configuration
let config = {
  dns: {
    port: 6767,
    bind: "0.0.0.0",
    upstream: ["1.1.1.1", "1.0.0.1"]
  },
  overrides: []
};

function loadConfig() {
  try {
    const configPath = path.join(__dirname, "config.json");
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(raw);
      if (config.dns && config.dns.upstream) {
        upstreamResolver.setServers(config.dns.upstream);
      }
      console.log(`Loaded config with ${config.overrides?.filter(o => o.enabled).length || 0} active overrides`);
    } else {
      console.log("No config.json found, using defaults");
      upstreamResolver.setServers(["1.1.1.1", "1.0.0.1"]);
    }
  } catch (err) {
    console.error("Error loading config:", err.message);
    upstreamResolver.setServers(["1.1.1.1", "1.0.0.1"]);
  }
}

loadConfig();

// Watch for config changes
const configPath = path.join(__dirname, "config.json");
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
    
    // Ensure there's actually a question in the packet payload
    if (!request.questions || request.questions.length === 0) {
      response.header.rcode = 1; // FORMERR
      send(response);
      return;
    }

    const question = request.questions[0];
    const { name, type } = question;
    const typeName = Packet.TYPE[type] || type;

    console.log(`DNS ${rinfo.address}:${rinfo.port} → ${name} (${typeName})`);

    try {
      // Check for local overrides
      if (config.overrides && Array.isArray(config.overrides)) {
        const override = config.overrides.find(o => 
          o.enabled && o.name.toLowerCase() === name.toLowerCase() && 
          (o.type === typeName || o.type === type)
        );
        
        if (override) {
          if (override.type === "A" || type === Packet.TYPE.A) {
            response.answers.push({
              name,
              type: Packet.TYPE.A,
              class: Packet.CLASS.IN,
              ttl: override.ttl || 60,
              address: override.value
            });
            response.header.rcode = 0;
            send(response);
            return;
          } else if (override.type === "AAAA" || type === Packet.TYPE.AAAA) {
            response.answers.push({
              name,
              type: Packet.TYPE.AAAA,
              class: Packet.CLASS.IN,
              ttl: override.ttl || 60,
              address: override.value
            });
            response.header.rcode = 0;
            send(response);
            return;
          } else if (override.type === "CNAME" || type === Packet.TYPE.CNAME) {
            response.answers.push({
              name,
              type: Packet.TYPE.CNAME,
              class: Packet.CLASS.IN,
              ttl: override.ttl || 300,
              domain: override.value
            });
            response.header.rcode = 0;
            send(response);
            return;
          }
        }
      }

      // EXTERNAL RESOLUTION FALLBACK
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
          break;
        }

        default: {
          try {
            const rawRecords = await upstreamResolver.resolve(name, Packet.TYPE[type]);
            answers = rawRecords.map(r => ({
              name,
              type,
              class: Packet.CLASS.IN,
              ttl: 300,
              data: typeof r === 'string' ? r : JSON.stringify(r)
            }));
          } catch (e) {
            answers = [];
          }
          break;
        }
      }

      if (answers.length > 0) {
        response.answers.push(...answers);
        response.header.rcode = 0;
      } else {
        response.header.rcode = 3; // NXDOMAIN
      }

    } catch (err) {
      if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
        console.error(`Resolution error for ${name}:`, err.message);
      }
      response.header.rcode = 3;
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
  udp: { port: config.dns.port || 6767, address: config.dns.bind || "0.0.0.0", type: "udp4" },
  tcp: { port: config.dns.port || 6767, address: config.dns.bind || "0.0.0.0" }
});
