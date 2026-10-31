# Local DNS

A small custom DNS server written in Node.js. It answers a few local lab names (for example `lab.pi`) with private IPs and forwards everything else to public upstream resolvers.

## Why

While setting up my home lab, I wanted to give the server in my room a custom domain name without paying for a real domain.

Instead of buying one, I wrote a DNS server with a simple override: when a query comes in for a name I reserved for the lab server, it returns that server's IP. Every other query is resolved normally through Cloudflare's public DNS.

## How it fits into my home lab

This is running on my home lab network, and my network is set up like this:

1. A Linux box acts as a hotspot and router for the lab network.
2. `dnsmasq` runs on that router box and serves DHCP and DNS to the clients.
3. `dnsmasq` forwards DNS queries to this server (`localDNS`) instead of the ISP's resolver.
4. This server answers the lab names itself and forwards all other queries to `1.1.1.1` and `1.0.0.1`.

```
Client  ──DNS──>  dnsmasq (hotspot router)  ──DNS──>  localDNS (port 6767)
                                                        ├─ lab.pi  -> 10.42.0.1
                                                        └─ everything else -> 1.1.1.1 / 1.0.0.1
```

## Requirements

- Node.js
- npm

## Setup

```bash
git clone <this repo>
cd localDNS
npm install
```

The only dependency is [`dns2`](https://www.npmjs.com/package/dns2).

## Running

```bash
node dnsServer.js
```

The server listens on `0.0.0.0:6767` for both UDP and TCP.

## Configuring dnsmasq

On the hotspot/router box, point dnsmasq at this server. Replace `192.168.x.x` with the IP of the machine running `localDNS`:

```conf
# /etc/dnsmasq.conf (or a file in /etc/dnsmasq.d/)
server=192.168.x.x#6767
```

Then restart dnsmasq:

```bash
sudo systemctl restart dnsmasq
```

Because this server listens on port 6767 rather than the standard port 53, the `#6767` suffix is required. Clients keep using the router as their DNS server through DHCP, and dnsmasq handles the forwarding.

## Customizing the lab names

The overrides live in the query handler in `dnsServer.js`:

```js
if (name === "lab.pi" && type === Packet.TYPE.A) {
  // returns 10.42.0.1
}
```

To add another name, copy that block and change the hostname and IP. Overrides only apply to `A` records.

To change the upstream resolvers, edit this line:

```js
upstreamResolver.setServers(["1.1.1.1", "1.0.0.1"]);
```

## Project files

- `dnsServer.js`: the DNS server (main entry point).
- `lib/resolver.js`: a standalone helper for resolving names. It is not used by the server.

## Limitations

- Browsers and some apps, such as Chrome and Firefox with DNS-over-HTTPS enabled, can bypass the system DNS server and use their own resolver. In that case, a name like `home.lab` may not resolve in the browser even though it works from the command line. Disabling secure DNS in the browser, or using a DNS setting that points at the lab's DNS server, fixes this.
- Only `A` records are overridden. Other record types are forwarded upstream.
- The server does not cache responses.

## References

- Node.js [DNS](https://nodejs.org/api/dns.html#dns) documentation
- [dns2](https://www.npmjs.com/package/dns2) library
- [dnsmasq](https://thekelleys.org.uk/dnsmasq/doc.html) documentation
