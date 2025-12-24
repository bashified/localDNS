const dns2 = require("dns2");
const { Packet } = dns2;
const dns = require("node:dns").promises;

const LOCAL_IP = "0.0.0.0";

const server = dns2.createServer({
  udp: true,
  tcp: true,

  handle: async (request, send, rinfo) => {
    const response = Packet.createResponseFromRequest(request);
    const question = request.questions[0];
    const { name, type } = question;

    console.log(`DNS ${rinfo.address}:${rinfo.port} → ${name} (${Packet.TYPE[type] || type})`);

    try {
      // LOCAL OVERRIDE
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

      // EXTERNAL RESOLUTION
      let answers = [];

      switch (type) {
        case Packet.TYPE.A: {
          const ips = await dns.resolve4(name);
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
          const ips = await dns.resolve6(name);
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
          const cnames = await dns.resolveCname(name);
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
          // pass through other records (TXT, etc.)
          const records = await dns.resolve(name);
          records.forEach(r => {
            response.answers.push({
              name,
              type,
              class: Packet.CLASS.IN,
              ttl: 300,
              data: r
            });
          });

          response.header.rcode = 0; // NOERROR
          send(response);
          return;
        }
      }

      if (answers.length > 0) {
        response.answers.push(...answers);
        response.header.rcode = 0; // NOERROR
      } else {
        response.header.rcode = 3; // NXDOMAIN
      }
    } catch (err) {
      console.error("Resolution error:", err);
      response.header.rcode = 3; // NXDOMAIN on error
    }

    send(response);
  }
});

server.on("listening", () => {
  console.log("DNS server listening on:");
  console.log(server.addresses());
});

server.on("error", err => {
  console.error("DNS server error:", err);
});

server.listen({
  udp: { port: 53, address: LOCAL_IP, type: "udp4" },
  tcp: { port: 53, address: LOCAL_IP }
});
