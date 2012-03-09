function setSessions(val) {
  if (navigator.id) {
    navigator.id.sessions = val ? val : [ ];
  }
};

function loadPageVar (sVar) {  
  return unescape(window.location.search.replace(new RegExp("^(?:.*[&\\?]" + escape(sVar).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"), "$1"));  
}  

function loveit(count, you, url) {
  if (loggedInAs) {
    $.post('/api/loveit/'+url, function (res) {
      updateCount(count+1, 1, url)
    })
  } else {
    navigator.id.getVerifiedEmail(
      function(assertion) {
        if (assertion !== null) {
          $.ajax({
            type: 'POST',
            url: '/api/login',
            data: { assertion: assertion },
            success: function(res, status, xhr) {
              if (res !== null) {
                $.post('/api/loveit/'+url, function (res) {
                  updateCount(count+1, 1, url)
                  debugger;
                })
              }
            },
            error: function(res, status, xhr) {
              alert("login failure" + res);
            }
          });
        }
      });
  }
}

function gotVerifiedEmail(assertion) {
  // got an assertion, now send it up to the server for verification
  if (assertion !== null) {
    $.ajax({
      type: 'POST',
      url: '/api/login',
      data: { assertion: assertion },
      success: function(res, status, xhr) {
        if (res === null) loggedOut();
        else loggedIn(res);
      },
      error: function(res, status, xhr) {
        alert("login failure" + res);
      }
    });
  }
  else {
    loggedOut();
  }
}

function person(count) {
  if (count == 1) return "person";
  else return "people";
}

function updateCount(count, you, url) {
  if (you) {
    if (count == 1) {
      $("#loves").html(
        "<span class='by loved'>You're the first to <img class='love' src='/images/filledpurpleheart.png'/> this!</span>" );
    } else {
      $("#loves").html("<span class='by loved'><img class='love' src='/images/filledpurpleheart.png'/> by " + count + " " + person(count) + " including you!</span>" );
    }
  } else {
    if (count) {
      $("#loves").html("<span class='by unloved'><img class='love' src='/images/filledpurpleheart.png'/> by " + count + " " + person(count) + ". <a onclick=loveit("+count+","+you+",'"+url+"')>you?</a></span>" );
    } else {
      $("#loves").html("<span class='by unloved'>do you <a onclick=loveit("+count+","+you+",'"+url+"')><img class='love' src='/images/heart.png'/> it?</span></a>");
    }
  }
}

var loggedInAs = '';
function browserIdCheck() {
  var url = loadPageVar('url');
  $.get('/api/wholoves/'+url, function (res) {
    loggedInAs = res.email;
    updateCount(res.loves, res.you, url);
    // if (res.email === null) loggedOut(res);
    // else loggedIn(res, true);
  }, 'json');
};

function mkHearts(count, which) {
  var hearts = [];
  for (var i = 0; i < count; i++) {
    hearts.push("<img src='" + which + "'/>");
  }
  return hearts.join('');
}

function loggedOut(res) {
  if (res.count)
  $("#loves").html(mkHearts(1, '/images/heart.png') + " by you and " + (res.loves-1) +" others" );
};

function loggedIn(res, immediate) {
  setSessions([ { email: res } ]);
  $("#loves").html(mkHearts(1, '/images/filledpurpleheart.png') + "<span class='by'>by you and " + (res.loves-1) +" others</span>" );
}

// at startup let's check to see whether we're authenticated
//(have existing cookie), and update the UI accordingly
$(function() {
  try {
    browserIdCheck();
  } catch (e) {
    console.log(e);
  }
});
