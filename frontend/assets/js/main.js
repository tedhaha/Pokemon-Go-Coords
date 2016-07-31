window._pokes = window._pokes || [];
window._filter = window._filter || 'all';

// Settings
var max_entries = 50;
var domain = "spawns.sebastienvercammen.be";
var port = 49002;

/* Helpers */

// Is this pokémon one of the original series?
function isRealPokemon(name, pokemon) {
    for(var i = 0; i < pokemon.length; i++) {
        if(pokemon[i].toLowerCase() === name.toLowerCase()) {
            return true;
        }
    }

    return false;
}

// Hide pokémon, triggered by "Hide" button
function hidePoke(e) {
    var poke = e.parentNode.parentNode;
    var list = poke.parentNode;

    list.removeChild(poke);
}

// Does our window._pokes contain this pokémon with exact same name, lat, lon?
function containsPoke(name, lat, lon) {
    for(var i = 0; i < window._pokes.length; i++) {
        var p = window._pokes[i];

        if(p.name === name && p.lat === lat && p.lon === lon) {
            return true;
        }
    }

    return false;
}

// Is this poké filtered due to the active filter?
function isFiltered(filter, hasIV, IV) {
    if(filter === 'all') {
        return false;
    } else if(filter === '0') {
        return !hasIV;
    } else if(filter === '90') {
        return !(hasIV && IV >= 90);
    }
}

// Add a pokémon to the DOM list
function addPokeToList(skel, list, data) {
    var e = skel.cloneNode(true);
    var top = list.firstChild;

    // Change properties
    e.removeAttribute('id');
    e.style.display = '';
    e.dataset.time = new Date();

    // Set pokémon values
    var name = data.name;

    if(data.IV !== null) {
        name += ' (' + data.IV + '%)';
    }

    e.querySelector('img').src = 'images/' + data.name.replace(/[^\w]/g, '').toLowerCase() + '.png';
    e.querySelector('p.title').innerText = name;
    e.querySelector('p.coords').innerText = data.lat + ', ' + data.lon;

    // Goddamn libraries
    Tipped.create(e.querySelector('p.coords'), "Copied!", {
        position: 'topleft',
        showOn: 'click',
        showDelay: 0
    });

    // Filtered or not?
    var hasIV = (data.IV !== null);
    var IV = (hasIV) ? parseInt(data.IV) : 0;

    e.dataset.iv_type = (hasIV) ? (IV >= 90) ? 90 : 1 : 0;

    if(isFiltered(window._filter, hasIV, IV)) {
        e.style.display = 'none';
    }

    // Insert
    list.insertBefore(e, top);
    window._pokes.unshift(data); // Front contains newest

    // Delayed
    setTimeout(function() { e.style.opacity = 1; }, 100);
}

// Keep max x entries in the DOM list
function removeOldEntries(domlist, maxEntries) {
    if(window._pokes.length > maxEntries) {
        for (var i = domlist.childNodes.length - 1; i > maxEntries; i--) {
            var el = domlist.childNodes[i];
            domlist.removeChild(el);
            window._pokes.pop();
        }
    }
}

// Change the display filter
// 0 = IV required
// 90 = IV 90 or higher required
// all = no filter
function changeFilter(filter) {
    window._filter = filter;

    var els = document.getElementsByClassName('poke');

    for(var i = 0; i < els.length; i++) {
        var el = $(els[i]);
        var hasIV = el.find('p.title')[0].innerText.indexOf('%') > -1;
        var IV = (hasIV) ? parseInt(el.find('p.title')[0].innerText.match(/\(([^)%]+)%\)/)[1]) : 0;

        // Filtered or not?
        if(isFiltered(window._filter, hasIV, IV)) {
            el.css('display', 'none');
        } else {
            el.css('display', 'table-row');
        }
    }
}

// Start
(function() {
    // Clipboard
    new Clipboard('.coords', {
        text: function(trigger) {
            return trigger.innerText;
        }
    });

    // Check if the socket.io server is running (if not: .js isn't server, so io() won't exist)
    if(typeof io === "undefined") {
        window.alert("Error: the data server is down. Please try again later.");
        return;
    }

    //
    var socket = io("http://" + domain + ":" + port);
    var skel = document.getElementById('skeleton');
    var list = document.getElementsByClassName('list')[0];

    // Bind filter
    $('#filter').on('change', function() {
        changeFilter($(this).val());
    });

    // Bind socket.io
    socket.on('helo', function(data) {
        data.reverse().forEach(function(p) {
            // Add it to the list if we don't have it already
            if (isRealPokemon(p.name, pokemon) && !containsPoke(p.name, p.lat, p.lon)) {
                addPokeToList(skel, list, p);
            }
        });
    });

    socket.on('poke', function(data) {
        // Add it to the list if we don't have it already
        if (isRealPokemon(data.name, pokemon) && !containsPoke(data.name, data.lat, data.lon)) {
            addPokeToList(skel, list, data);
        }

        // Cleanup
        removeOldEntries(list, max_entries);
    });
})();