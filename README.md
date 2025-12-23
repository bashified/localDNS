# Local DNS

- While configuring my home lab, I wanted to assign a custom domain name to the server that i have in my room without paying for an actual domain.

- The solution? Reinventing the wheel, writing my own DNS server and adding a little `if () {}` so that when a query is made for a domain that I have kept for my room server, the response is the ip to that server.

- Works on my local network after configuring the router to use this as the default DNS server instead of ISP/Dynamic