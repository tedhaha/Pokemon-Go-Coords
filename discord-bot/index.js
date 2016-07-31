var Discord = require("discord.js");
var mysql = require("mysql");
var settings = require("./settings.json");
var io = require('socket.io')(settings.port || 49001);
var pokemon = require("./pokemon.json");
var filtered_pokes = require("./filtered.json");

// Vars
var debug = settings.debug;
var invite_keys = settings.invite_keys; // Autojoin servers for which we have an invite key
var pokelog = [];

// Allowed Discord channels
var allowed_channels = settings.allowed_channels;

// Discord
var bot = new Discord.Client({
    autoReconnect: true,
    disableEveryone: true
});

// Start MySQL
var conn = mysql.createConnection({
    host: settings.db_host,
    user: settings.db_user,
    password: settings.db_pass,
    database: settings.db_name
});

if(debug) {
    console.log("Connecting to MySQL...");
}

conn.connect(function(err) {
    // Stop on error. We need you, MySQL :( SOMEONE THINK OF THE SQL!
    if(err) {
        console.log('DB Error: ' + err.code);
        process.exit();
    }

    // Let's go
    if(debug) {
        console.log("Connecting to Discord...");
    }

    bot.login(settings.discord_user, settings.discord_pass, function(err, token) {
        if(err) {
            console.log("Discord error: " + err);
            process.exit();
        }

        if(debug) {
            console.log("Connected to Discord. Token: " + token + ".");
        }
    });
});

// Register MySQL events
bot.on("message", function(message) {
    if(message.content === "ping") {
        bot.reply(message, "pong");
    }

    if(allowed_channels.indexOf(message.channel.name) > -1) {
        // Clean up the "clean" content
        message.cleanContent = message.cleanContent.replace('\r', '').replace('\n', '');

        // Parse
        var coord = parseCoordMessage(message.cleanContent);

        // Valid coord message? And not yet in our log?
        if(coord[0] ===  true && !isFilteredPoke(coord[1].name) &&
            !containsPoke(coord[1].name, coord[1].lat, coord[1].long)) {
            var poke = coord[1];
            var log = '  [+] Spotted: ' + poke.name;

            // Optional IV
            if (poke.IV !== null) {
                log += '(' + poke.IV + '%)';
            }

            log += ' at ' + poke.lat + ', ' + poke.long;

            // Save to db
            var data = {
                name: poke.name,
                lat: poke.lat,
                lon: poke.long, // "long" is a MySQL reserved keyword :(
                IV: poke.IV
            };

            // Emit to clients
            io.emit('poke', data);

            // Add to history (newest at front)
            pokelog.unshift(data);

            // Add remaining data (keep it hidden from sockets)
            data.channel = message.channel.name;
            data.userId = message.author.id;
            data.server = message.server.name;

            if(pokelog.length > settings.max_poke_history) {
                pokelog.pop();
            }

            // Save to DB
            conn.query("INSERT INTO spawns SET ?", data, function(err, result) {
                // Stop on error.
                if(err) {
                    console.log('DB Error: ' + err.code);
                    process.exit();
                }
            });

            // Log to console
            console.log('From ' + message.channel.name + ':');
            console.log(log);
        }
    }
});

bot.on("error", function(err) {
    console.log(err);
});

bot.on("debug", function(e) {
    if(debug) {
        console.log(e);
    }
});

bot.on("serverCreated", function(server) {
    console.log('[#] Joined: ' + server.name);
});

bot.on("ready", function() {
    bot.userAgent = {
        url: '',
        version: '',
        full: ''
    };

    if(debug) {
        console.log('Are we a bot? ' + bot.user.bot);
        console.log('User-Agent: ' + JSON.stringify(bot.userAgent));
        console.log('# of servers: ' + bot.servers.length);
    }

    for(let i = 0; i < invite_keys; i++) {
        var key = invite_keys.pop();
        bot.joinServer(key, function() {});
    }
});

// Register socket.io events
io.on('connection', function(socket) {
    console.log('+++ Socket connected.');

    // Say hi
    socket.emit('helo', pokelog);
});


/* Helpers */

// Is this one of filtered pokes?
function isFilteredPoke(name) {
    for(let i = 0; i < filtered_pokes.length; i++) {
        if(filtered_pokes[i] === name) {
            return true;
        }
    }

    return false;
}

// Does our pokelog contain this pokémon with exact same name, lat, lon?
function containsPoke(name, lat, lon) {
    for(let i = 0; i < pokelog.length; i++) {
        var p = pokelog[i];

        if(p.name === name && p.lat === lat && p.lon === lon) {
            return true;
        }
    }

    return false;
}

// Is this message one containing: a pokémon's name, a valid lat + a valid long (+ an optional IV)?
// Returns [ true/false, pokeObject/null ]
function parseCoordMessage(text) {
    // Don't waste time on these people
    if(isUserComplaining(text)) {
        return [ false, null ];
    }

    // Remove tabs
    text = text.replace(/\t/g, '').trim();

    // Split on spaces to parse each part individually
    var pieces = text.split(' ');

    // Requirements
    var containsPokeName = false;
    var containsValidLat = false;
    var containsValidLong = false;

    // Pokémon object we'll return
    var poke = {
        name: '',
        IV: null, // optional
        lat: '',
        long: ''
    };

    // dotheloop.jpeg
    for(let i = 0; i < pieces.length; i++) {
        var p = pieces[i].trim();
        var _p = p.replace(',', ''); // Replace commas at the end/front of lat/long, careful for combined

        if(_p.slice(0, 1) === '.') { _p = _p.slice(1); } // Remove dots at the front of _p
        if(_p.slice(-1) === '.') { _p = _p.slice(0, -1); } // Remove dots at the end of _p

        if(!containsPokeName && isPokeName(p)) {
            containsPokeName = true;
            poke.name = p.trim();
            // Capitalize
            poke.name = poke.name.charAt(0).toUpperCase() + poke.name.slice(1).toLowerCase();
        } else if(!containsValidLat && isValidLatLong(_p)) {
            containsValidLat = true;
            poke.lat = _p;
        } else if(containsValidLat && !containsValidLong && isValidLatLong(_p)) {
            containsValidLong = true;
            poke.long = _p;
        } else if(!containsValidLat && !containsValidLong && isCombinedCoord(p)) { // p, not _p
            var coords = p.split(',');

            containsValidLat = true;
            containsValidLong = true;
            poke.lat = coords[0];
            poke.long = coords[1];
        } else {
            // Only missing thing is the poke's IV
            poke.IV = parsePokeIV(text);

            // If IV > 100, malformed message.
            if(poke.IV !== null && parseInt(poke.IV) > 100) {
                return [ false, null ];
            }
        }
    }

    return [ containsPokeName && containsValidLat && containsValidLong, poke ];
}

// Is this another guy confirming or complaining about the previous messages?
// Everyone complaining, posting bot logs, or timestamped copy/pasted are removed.
function isUserComplaining(str) {
    str = str.toLowerCase();
    return str.indexOf('fake') > -1 || str.indexOf('confirm') > -1 || str.indexOf('got it') > -1 ||
        str.indexOf('there is no') > -1 || str.indexOf('[') > -1 || str.indexOf(']') > -1;
}

// Turn a string w/ numbers into only the numbers
function removeNonNumbers(str) {
    return str.match(/\d+/g).join('');
}

// Does this string contain the pokémon's IV?
function parsePokeIV(str) {
    // Turn it into a better format
    str = str.toLowerCase();

    // 1% to 100%
    var percentage = str.match(/[\d]{1,3}[%]/ig);
    // 0 IV to 100 IV (required whitespace in front [avoid 0.999 IV 20], optional space between)
    var xiv = str.match(/[ ][\d]{1,3}[ ]?iv/ig);
    // IV 0 to IV 100 (optional space)
    var ivx = str.match(/iv[ ]?[\d]{1,3}/ig);
    // 1% IV to 100% IV (CoordBot uses this, optional space)
    var percentageCombo = str.match(/[\d]{1,3}[%][ ]?iv/ig);

    if (percentage) {
        return removeNonNumbers(percentage[0])
    } else if (xiv){
        return removeNonNumbers(xiv[0]);
    } else if (ivx) {
        return removeNonNumbers(ivx[0]);
    } else if (percentageCombo) {
        return removeNonNumbers(percentageCombo[0]);
    }

    return null;
}

// Check if a string is a combination of coords without space in-between.
function isCombinedCoord(str) {
    return str.match(/^[-]?[\d]+[.][\d]+[,][-]?[\d]+[.][\d]+$/mg) != null
}

// Is this a valid lat or long (format 29.335001809974 w/ any precision)
function isValidLatLong(str) {
    return str.match(/^[-]?[\d]+[.][\d]+$/m) != null
}

// Is this piece of text a Pokémon's valid name?
function isPokeName(str) {
    for(let i = 0; i < pokemon.length; i++) {
        if(str.toLowerCase().trim() === pokemon[i].toLowerCase().trim()) {
            return true;
        }
    }

    return false;
}