const dns2 = require('dns2');
const { Packet } = dns2;
const { resolveName } = require('./lib/resolver.js');

const server = dns2.createServer({
  udp: true,
  tcp: true,
  handle: (request, send, rinfo) => {
    const response = Packet.createResponseFromRequest(request);
    const [question] = request.questions;
    const { name, type } = question;

    console.log(`DNS query for ${name} (${type})`);

    // A record queries (IPv4)
    if (type === Packet.TYPE.A) {
      resolveName(name, (addresses) => {
        if (addresses && addresses.length > 0) {

            addresses.forEach((address) => {
            response.answers.push({
              name,
              type: Packet.TYPE.A,
              class: Packet.CLASS.IN,
              ttl: 300,
              address: address
            });
          });
        } else {
            response.header.rcode = Packet.RCODE.NXDOMAIN;
        }
        send(response);
      });
    } else {
      // Unsupported record
      response.header.rcode = Packet.RCODE.REFUSED;
      send(response);
    }
  }
});

server.on('request', (request, response, rinfo) => {
  console.log(`Request from ${rinfo.address}:${rinfo.port}`);
});

server.on('listening', () => {
  console.log('DNS server listening on:', server.addresses());
});

server.on('close', () => {
  console.log('DNS server closed');
});

// 53 (standard DNS port)
server.listen({
  udp: { port: 53, address: '0.0.0.0', type: 'udp4' },
  tcp: { port: 53, address: '0.0.0.0' }
});