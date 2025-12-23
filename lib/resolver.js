const dns = require('node:dns');

function ipv4(domain) {
    const ip = dns.resolve4(domain);
    return ip;
}

let ip = ipv4("google.com");
console.log(ip);