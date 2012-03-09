- an http endpoint destined for an iframe, which offers signin/loggedin+signout

- an http endpoint parametrized by a URL, which returns:
  - # of people who love this url
  - whether you do or not
  JSON or html?

 - redis back end probably uses sets:
    - sadd: declare my love for a url, and a url to my list of loves
    - scard: find out how many people love a url
    - sinter maybe to test whether i love a url

