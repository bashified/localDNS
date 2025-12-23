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

		if (type === Packet.TYPE.A) {

            // local override for lab.local
            // add more overrides as needed for local network

			if (name === "home.lab") {
				console.log(`✅ Local override: ${name} → 192.168.1.50`);
				response.answers.push({
					name,
					type: Packet.TYPE.A,
					class: Packet.CLASS.IN,
					ttl: 60,
					address: "192.168.1.50"
				});
				send(response);
				return;
			}

            // continue with external resolution

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

server.listen({
	udp: { port: 53, address: '0.0.0.0', type: 'udp4' },
	tcp: { port: 53, address: '0.0.0.0' }
});
