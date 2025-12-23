const dns = require("node:dns");

const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

function resolveName(name, type, callback) {
    switch (type) {
        case "A":
            resolver.resolve4(name, callback);
            break;

        case "AAAA":
            resolver.resolve6(name, callback);
            break;

        case "CNAME":
            resolver.resolveCname(name, callback);
            break;

        default:
            resolver.resolve(name, type, callback);
            break;
    }
}

/*
resolveName("example.com", function (ips) {
    console.log(ips);
});
*/

module.exports = { resolveName };