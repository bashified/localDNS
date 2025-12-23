# Local DNS

- While configuring my home lab, I wanted to assign a custom domain name to the server that i have in my room without paying for an actual domain.

- The solution? Reinventing the wheel, writing my own DNS server and adding a little `if () {}` so that when a query is made for a domain that I have kept for my room server, the response is the ip to that server.

- Works on my local network after configuring the router to use this as the default DNS server instead of ISP/Dynamic

# References

- NodeJS's official [DNS](https://nodejs.org/api/dns.html#dns) documentation

# Checkmate

- After completing this DNS server, i was hit with the cold reality that almost no search engine or web browser uses system enforced DNS server, which means for example if i have an exception for `home.lab`->`192.168.1.50` and i enter the same url in the browser after i have set my system to use custom DNS, google will still not resolve it because it uses its own DNS and not the one that user has implemented system wide. The blows to one's privacy is insane.