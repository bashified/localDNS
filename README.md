# LocalDNS

A configurable local DNS server with a modern web UI. Route specific domains to custom IPs and forward everything else to public upstream resolvers.

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

Dependencies: [`dns2`](https://www.npmjs.com/package/dns2), [`express`](https://www.npmjs.com/package/express).

## Running

**Start the DNS server:**
```bash
node dnsServer.js
```
The server listens on the configured port (default `6767`) for both UDP and TCP.

**Start the Web UI (for configuration):**
```bash
node webServer.js
```
Open http://localhost:8080 to configure overrides and settings via the web interface. Config changes are automatically picked up by the DNS server.

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

## Configuration

All configuration is stored in `config.json`. You can edit it directly or use the web UI at http://localhost:8080.

### Via Web UI
1. Start the web server: `node webServer.js`
2. Open http://localhost:8080
3. Add/edit domain overrides and server settings
4. Save and restart the DNS server if needed (DNS server auto-reloads config on file changes)

### Via config.json
```json
{
  "dns": {
    "port": 6767,
    "bind": "0.0.0.0",
    "upstream": ["1.1.1.1", "1.0.0.1"]
  },
  "overrides": [
    {
      "id": "lab-pi",
      "enabled": true,
      "name": "lab.pi",
      "type": "A",
      "value": "10.42.0.1",
      "ttl": 60,
      "notes": "Home lab server"
    }
  ]
}
```

Supported override types: `A`, `AAAA`, `CNAME`. The DNS server watches `config.json` and reloads automatically when it changes.

## Project files

- `dnsServer.js`: the DNS server (main entry point).
- `webServer.js`: web UI server for configuration.
- `config.json`: configuration file for overrides and settings.
- `public/`: web UI files (HTML, CSS, JS).
- `lib/resolver.js`: a standalone helper for resolving names. It is not used by the server.

## Limitations

- Browsers and some apps, such as Chrome and Firefox with DNS-over-HTTPS enabled, can bypass the system DNS server and use their own resolver. In that case, a name like `home.lab` may not resolve in the browser even though it works from the command line. Disabling secure DNS in the browser, or using a DNS setting that points at the lab's DNS server, fixes this.
- Caching is not implemented.
- Web UI runs on a separate server (default port 8080).

## References

- Node.js [DNS](https://nodejs.org/api/dns.html#dns) documentation
- [dns2](https://www.npmjs.com/package/dns2) library
- [dnsmasq](https://thekelleys.org.uk/dnsmasq/doc.html) documentation
