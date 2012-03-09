
/**
 * Module dependencies.
 */

const express = require('express'),
sessions = require('connect-cookie-session'),
path = require('path'),
cluster = require('cluster'),
postprocess = require('postprocess'),
https = require('https'),
querystring = require('querystring'),
url = require('url');
less = require('less');
var redis = require("redis");



if (process.env.VCAP_SERVICES) {
  console.log("VCAP_SERVICES=", process.env.VCAP_SERVICES);
  redisConfig = JSON.parse(process.env.VCAP_SERVICES)['redis-2.2'][0].credentials;
  redis_host = redisConfig.host;
  redis_port = redisConfig.port;
  db = redis.createClient(redis_port, redis_host);
  db.auth(redisConfig.password);
} else {
  db = redis.createClient();
}

var RedisStore = require('connect-redis')(express);

var app = module.exports = express.createServer();

// Configuration

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

// Routes

// the key with which session cookies are encrypted
const COOKIE_SECRET = process.env.SEKRET || 'love conquers like';

// The IP Address to listen on.
const IP_ADDRESS = process.env.VCAP_APP_HOST || '127.0.0.1';

// The port to listen to.
const PORT = process.env.VCAP_APP_PORT || 8003;

// localHostname is the address to which we bind.  It will be used
// as our external address ('audience' to which assertions will be set)
// if no 'Host' header is present on incoming login requests.
var localHostname = undefined;


// do some logging
app.use(express.logger({ format: 'dev' }));
// parse cookies
app.use(express.cookieParser());
// app.use(express.session({ secret: COOKIE_SECRET, store: new RedisStore }));
// parse post bodies
app.use(express.bodyParser());

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  // a substitution middleware allows us to easily point at different browserid servers
  app.use(postprocess.middleware(function(req, body) {
    var browseridURL = determineBrowserIDURL(req);
    return body.toString().replace(new RegExp("https://browserid.org", 'g'), browseridURL);
  }));
  app.use(express.compiler({ src: __dirname + '/public', enable: ['less'] }));
  app.use(express.methodOverride());
  app.use(express.static(__dirname + '/public'));
});


// session support using signed cookies
app.use(function (req, res, next) {
  if (/^\/api/.test(req.url)) {
    return sessions({
      secret: COOKIE_SECRET,
      key: 'sylviatime_session',
      cookie: {
        path: '/api',
        httpOnly: true,
        // when you're logged in, you're logged in for a month
        maxAge: (30 * 24 * 60 * 60 * 1000), 
        secure: false
      }
    })(req, res, next);
  } else {
    return next();
  }
});

// The next three functions contain some fancy logic to make it so
// we can run multiple different versions of myfavoritebeer on the
// same server, each which uses a different browserid server
// (dev/beta/prod):

function determineEnvironment(req) {
  if (req.headers['host'] === 'sylviatime.com') return 'prod';
  else if (req.headers['host'] === 'beta.sylviatime.com') return 'beta';
  else if (req.headers['host'] === 'dev.sylviatime.com') return 'dev';
  else return 'local';
}

function determineBrowserIDURL(req) {
  // first defer to the environment
  if (process.env.BROWSERID_URL) return process.env.BROWSERID_URL;

  return ({
    prod:   'https://browserid.org',
    beta:   'https://browserid.org',
    dev:    'https://browserid.org',
    local:  'https://browserid.org'
  })[determineEnvironment(req)];
}

function determineBrowserIDHost(req) {
  return determineBrowserIDURL(req).replace(/http(s?):\/\//, '');
}


// /api/whoami is an API that returns the authentication status of the current session.
// it returns a JSON encoded string containing the currently authenticated user's email
// if someone is logged in, otherwise it returns null.
app.get("/api/whoami", function (req, res) {
  if (req.session && typeof req.session.email === 'string') 
    return res.json({'email': req.session.email,
                     'loves': 3});
  return res.json({'email': null,
                   'loves': 12});
});


app.get("/api/wholoves/*", function (req, res) {
  var url = req.params[0];
  var email = null;
  if (req.session && typeof req.session.email === 'string') 
    email = req.session.email;
  console.log("we have email = ", email);
  db.scard(url, function(err, answer) {
    var count = answer;
    console.log("count = ", count);
    db.sismember(email, url, function (err, answer) {
      console.log("does email love it? = ", answer);
      return res.json({'email': email,
                       'you': answer,
                       'loves': count});
    });
  })
});

app.post("/api/loveit/*", function (req, res) {
  console.log(req.session);
  if (! req.session.email) {
    console.log("we're not authed"); 
    res.writeHead(500);
    res.end();
  }
  var url = req.params[0];
  var email = req.session.email;
  console.log("email is ", email);
  db.sadd(url, email, function(err, ok) {
    db.sadd(email, url, function(err, ok) {
      return res.json({'status': 'ok'});
    })
  })

})

// /api/login is an API which authenticates the current session.  The client includes 
// an assertion in the post body (returned by browserid's navigator.id.getVerifiedEmail()).
// if the assertion is valid an (encrypted) cookie is set to start the user's session.
// returns a json encoded email if the session is successfully authenticated, otherwise
// null.
app.post("/api/login", function (req, res) {
  // To verify the assertion we initiate a POST request to the browserid verifier service.
  // If we didn't want to rely on this service, it's possible to implement verification
  // in a library and to do it ourselves.  
  var vreq = https.request({
    host: determineBrowserIDHost(req),
    path: "/verify",
    method: 'POST'
  }, function(vres) {
    var body = "";
    vres.on('data', function(chunk) { body+=chunk; } )
        .on('end', function() {
          try {
            try {
              var verifierResp = JSON.parse(body);
            } catch (e) {
              console.log("non-JSON response from verifier:" + body.toString());
            }
            // console.log("verifierResp: " + verifierResp);
            // console.log("verifierResp.status: " + verifierResp.status);
            // console.log("verifierResp.email: " + verifierResp.email);
            var valid = verifierResp && verifierResp.status === "okay";
            var email = valid ? verifierResp.email : null;
            req.session.email = email;
            if (valid) {
              console.log("assertion verified successfully for email:", email);
            } else {
              console.log("failed to verify assertion:", verifierResp.reason);
            }
            res.json(email);
          } catch(e) {
            console.log("SOME OTHER EXCEPTION: ", e);
            // bogus response from verifier!  return null
            res.json(null);
          }
        });
  });
  vreq.setHeader('Content-Type', 'application/x-www-form-urlencoded');

  // An "audience" argument is embedded in the assertion and must match our hostname.
  // Because this one server runs on multiple different domain names we just use
  // the host parameter out of the request.
  var audience = req.headers['host'] ? req.headers['host'] : localHostname;
  console.log("audience = ", audience);
  var data = querystring.stringify({
    assertion: req.body.assertion,
    audience: audience
  });
  vreq.setHeader('Content-Length', data.length);
  vreq.write(data);
  vreq.end();
  console.log("verifying assertion!");
});

// /api/logout clears the session cookie, effectively terminating the current session.
app.post("/api/logout", function (req, res) {
  req.session.email = null;
  res.json(true);
});

// /api/get requires an authenticated session, and accesses the current user's favorite
// beer out of the database.
app.get("/api/deadlines", function (req, res) {
  var email;

  if (req.session && typeof req.session.email === 'string') email = req.session.email;

  if (!email) {
    res.writeHead(400, {"Content-Type": "text/plain"});
    res.write("Bad Request: you must be authenticated to play");
    res.end();
    return;
  }

  var key = email+'-deadlines';
  db.exists(key, function(err, exists) {
    if (!exists) {
      // user unknown
      res.json([]);
      return;
    }
    db.smembers(key, function(err, deadline_keys) {
      if (err) {
        console.log("error getting deadline_keys for", email); 
        res.writeHead(500);
        res.end();
        return;
      }
      console.log('deadline_keys:', deadline_keys);
      if (deadline_keys.length == 0) {
        return res.json([
          {id:1, what:"xmas", when:"12/25/2011", ready:true},
          {id:2, what:"new year", when:"1/1/2012", ready:true},
          ]);
      }
      db.mget(deadline_keys, function(err, deadlines) {
        if (err) {
          console.log("error getting deadlines for", deadline_keys); 
          res.writeHead(500);
          res.end();
          return;
        }

        deadlines_objs = [];
        for (var i=0; i < deadlines.length; i++) {
          deadlines_objs.push(JSON.parse(deadlines[i]));
        }
        function sortByDate(a,b) {
          if (new Date(a['when']) < new Date(b['when'])) return -1;
          return 1;
        }
        deadlines_objs.sort(sortByDate);
        res.json(deadlines_objs);
      });
    });
  })
});


app.put("/api/deadlines/:id", function(req, res) {
  var email = req.session.email;
  console.log("changing deadline to", JSON.stringify(req.body));

  if (!email) {
    res.writeHead(400, {"Content-Type": "text/plain"});
    res.write("Bad Request: you must be authenticated to get your beer");
    res.end();
    return;
  }
  var deadline_key = req.params.id;
  var deadlines_key = email + '-deadlines';
  var deadline = req.body;

  db.set(deadline_key, JSON.stringify(req.body), function(err) {
    console.log("setting deadline ", deadline_key, "to", JSON.stringify(deadline)); 
    if (err) {
      res.writeHead(500);
      res.end();
      return;
    } 
  });
});

app.delete("/api/deadlines/:id", function(req, res) {
  var email = req.session.email;
  console.log("deleting deadline", JSON.stringify(req.body));

  if (!email) {
    res.writeHead(400, {"Content-Type": "text/plain"});
    res.write("Bad Request: you must be authenticated to delete a deadline");
    res.end();
    return;
  }
  var deadline_key = req.params.id;
  var deadlines_key = email + '-deadlines';
  var deadline = req.body;

  db.del(deadline_key, function(err) {
    // console.log("setting deadline ", deadline_key, "to", JSON.stringify(req.body)); 
    if (err) {
      res.writeHead(500);
      res.end();
      return;
    } 
    console.log("doing srem of ", deadline_key, "from", deadlines_key);
    db.srem(deadlines_key, deadline_key, function(err) {
      if (err) {
        console.log("error doing srem of ", deadline_key, "from", deadlines_key);
        res.writeHead(500);
        res.end();
        return;
      }
      res.json(true);
    });
  });  
});


app.post("/api/deadlines", function(req, res) {
  var email = req.session.email;

  if (!email) {
    res.writeHead(400, {"Content-Type": "text/plain"});
    res.write("Bad Request: you must be authenticated to get your beer");
    res.end();
    return;
  }

  var deadlines_key = email + '-deadlines';
  var watermark = email + '-wmark';
  var deadline = req.body;
  db.incr(watermark, function(err, index) {
    var deadline_key = email + '-deadline-' + String(index);
    deadline['id'] = deadline_key;

    db.set(deadline_key, JSON.stringify(deadline), function(err) {
      // console.log("setting deadline ", deadline_key, "to", JSON.stringify(req.body)); 
      if (err) {
        res.writeHead(500);
        res.end();
        return;
      } 
      // console.log("ADDING ", deadline_key, " TO ", deadlines_key);
      db.sadd(deadlines_key, deadline_key, function(err) {
        if (err) {
          console.log("error doing sadd of ", deadline_key, "to", deadlines_key, "err:", err);
          res.writeHead(500);
          res.end();
          return;
        }
        res.json({'id': deadline_key});
      });
    });
  });
})

app.get('/', function(req, res){
  res.render('home', {
    title: 'Love Machine'
  });
});
app.get('/loves', function(req, res){
  res.render('loves', {
    title: 'Love Machine'
  });
});

app.listen(PORT, IP_ADDRESS, function () {
    var address = app.address();
    localHostname = address.address + ':' + address.port
    console.log("listening on " + localHostname +" in " + app.settings.env + " mode.");
});
