const dns = require("node:dns");

const resolver = new dns.Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);

function resolveName(domain, callback) {
    resolver.resolve4(domain, function (err, addresses) {
        if (err) {
            callback(null);
            return;
        }
        callback(addresses);
    });
}

/*
resolveName("example.com", function (ips) {
    console.log(ips);
});
*/

module.exports = {
    resolveName
};