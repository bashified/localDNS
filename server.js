const dns2 = require("dns2");
const { Packet } = dns2;
const { Resolver } = require("node:dns").promises;

// Initialize an isolated upstream resolver to prevent infinite network lookup loops
const upstreamResolver = new Resolver();
upstreamResolver.setServers(["1.1.1.1", "1.0.0.1"]);

const LOCAL_IP = "0.0.0.0";

const server = dns2.createServer({
  udp: true,
  tcp: true,

  handle: async (request, send, rinfo) => {
    const response = Packet.createResponseFromRequest(request);
    
    // Ensure there's actually a question in the packet payload
    if (!request.questions || request.questions.length === 0) {
      response.header.rcode = 1; // FORMERR (Format Error)
      send(response);
      return;
    }

    const question = request.questions[0];
    const { name, type } = question;

    console.log(`DNS ${rinfo.address}:${rinfo.port} → ${name} (${Packet.TYPE[type] || type})`);

    try {
      // 1. LOCAL LAB OVERRIDE
      if (name === "home.lab" && type === Packet.TYPE.A) {
        response.answers.push({
          name,
          type: Packet.TYPE.A,
          class: Packet.CLASS.IN,
          ttl: 60,
          address: "192.168.1.50"
        });

        response.header.rcode = 0; // NOERROR
        send(response);
        return;
      }

      // 2. EXTERNAL RESOLUTION FALLBACK
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
            domain: cname // dns2 maps CNAME targets to the 'domain' field
          }));
          break;
        }

        default: {
          // Fallback pass-through for other records using the native lookup
          const rawRecords = await upstreamResolver.resolve(name, Packet.TYPE[type]);
          // Minimal mapping layout; specialized types might require explicit object parsing
          answers = rawRecords.map(r => ({
            name,
            type,
            class: Packet.CLASS.IN,
            ttl: 300,
            data: typeof r === 'string' ? r : JSON.stringify(r)
          }));
          break;
        }
      }

      if (answers.length > 0) {
        response.answers.push(...answers);
        response.header.rcode = 0; // NOERROR
      } else {
        response.header.rcode = 3; // NXDOMAIN
      }

    } catch (err) {
      // If code is ENODATA or ENOTFOUND, it's a standard missing domain. Don't spam errors.
      if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
        console.error(`Resolution error for ${name}:`, err.message);
      }
      response.header.rcode = 3; // NXDOMAIN
    }

    // Single send guarantee
    send(response);
  }
});

server.on("listening", () => {
  console.log("DNS server successfully listening on:");
  console.log(server.addresses());
});

server.on("error", err => {
  console.error("DNS server structural error:", err);
});

// Run with sudo / Admin access privileges to claim Port 53
server.listen({
  udp: { port: 53, address: LOCAL_IP, type: "udp4" },
  tcp: { port: 53, address: LOCAL_IP }
});
