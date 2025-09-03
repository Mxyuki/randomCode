// ==UserScript==
// @name         EMQ Easy SQL
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Easy artist ID search and song queries
// @author       Myuki
// @match        https://kuery.erogemusicquiz.com/*
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        SEARCH_LIMIT: 15,
        AUTO_EXECUTE_DELAY: 300
    };

    let isSearchingArtist = false;

    function init() {
        if (typeof setHighlight !== 'undefined' && document.querySelector('#sqledit')) {
            createInterface();
            setupObserver();
        } else {
            setTimeout(init, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function createInterface() {
        const main = document.querySelector('main.query');
        const form = main?.querySelector('form');
        if (!main || !form) return;

        const container = document.createElement('div');
        container.innerHTML = `
            <div>
                <h4>Find Artist ID</h4>
                <div>
                    <input type="text"
                           id="emq-artist-name"
                           placeholder="Enter artist name...">
                    <button id="emq-search-btn">Search</button>
                </div>
                <div id="emq-artist-results"></div>
            </div>

            <div>
                <h4>Get Artist Songs</h4>
                <div>
                    <input type="number"
                           id="emq-artist-id"
                           placeholder="Enter artist ID...">
                    <button id="emq-songs-btn">Load Songs</button>
                </div>
            </div>
        `;

        form.parentNode.insertBefore(container, form);

        document.getElementById('emq-search-btn').addEventListener('click', searchArtist);
        document.getElementById('emq-songs-btn').addEventListener('click', loadSongs);

        document.getElementById('emq-artist-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchArtist();
        });

        document.getElementById('emq-artist-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadSongs();
        });
    }

    function searchArtist() {
        const artistName = document.getElementById('emq-artist-name').value.trim();
        if (!artistName) {
            showStatus('Please enter an artist name.');
            return;
        }

        showStatus('Searching...');
        isSearchingArtist = true;

        const escapedName = artistName.replace(/'/g, "''");
        const searchTerms = artistName.split(/\s+/).filter(term => term.length > 0);
        const searchConditions = searchTerms.map(term => {
            const escaped = term.replace(/'/g, "''");
            return `(LOWER(aa.latin_alias) ILIKE LOWER('%${escaped}%') OR LOWER(aa.non_latin_alias) ILIKE LOWER('%${escaped}%'))`;
        }).join(' AND ');

        const query = `
SELECT
    a.id,
    aa.latin_alias as artist_name,
    aa.non_latin_alias,
    CASE WHEN aa.is_main_name THEN 'Main' ELSE 'Alias' END as name_type,
    CASE
        WHEN LOWER(aa.latin_alias) = LOWER('${escapedName}') THEN 100
        WHEN LOWER(aa.latin_alias) ILIKE LOWER('${escapedName}') THEN 95
        WHEN LOWER(aa.latin_alias) ILIKE LOWER('%${escapedName}%') THEN 85
        ${searchTerms.length > 1 ? `WHEN ${searchConditions} THEN 80` : ''}
        ELSE 50
    END as similarity_score
FROM artist a
JOIN artist_alias aa ON a.id = aa.artist_id
WHERE ${searchConditions}
ORDER BY similarity_score DESC, aa.is_main_name DESC, aa.latin_alias
LIMIT ${CONFIG.SEARCH_LIMIT};`.trim();

        executeQuery(query);
    }

function loadSongs() {
    const artistId = document.getElementById('emq-artist-id').value.trim();
    if (!artistId || isNaN(artistId)) {
        showStatus('Please enter a valid artist ID.');
        return;
    }

    showStatus(`Loading songs for Artist ID: ${artistId}...`);
    isSearchingArtist = false;

    const query = `
WITH artist_songs AS (
    SELECT DISTINCT
        am.music_id,
        mt.latin_title AS song_name,
        mt.non_latin_title,
        aa.latin_alias AS artist_name,
        CASE
            WHEN mel.duration = '00:00:00' THEN NULL
            WHEN mel.url LIKE 'https://emqselfhost/selfhoststorage/%' THEN
                REPLACE(mel.url, 'https://emqselfhost/selfhoststorage/', 'https://erogemusicquiz.com/selfhoststorage/')
            ELSE mel.url
        END AS song_url,
        mel.duration,
        COALESCE(mt.latin_title, mt.non_latin_title) as display_name,
        COALESCE(mst.latin_title, mst.non_latin_title) as source_title,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(mt.latin_title, mt.non_latin_title)
            ORDER BY
                -- prioritize file extensions
                CASE
                    WHEN mel.url LIKE '%.webp' THEN 1
                    WHEN mel.url LIKE '%.weba' THEN 2
                    WHEN mel.url LIKE '%.mp3' THEN 3
                    WHEN mel.url LIKE '%.ogg' THEN 4
                    ELSE 5
                END,
                -- then prioritize hosts
                CASE
                    WHEN mel.url LIKE 'https://files.catbox.moe/%' THEN 1
                    WHEN mel.url LIKE 'https://erogemusicquiz.com/selfhoststorage/%' THEN 2
                    ELSE 3
                END,
                mel.duration DESC NULLS LAST
        ) as rn
    FROM artist_music am
    JOIN music_title mt ON am.music_id = mt.music_id AND mt.is_main_title = true
    LEFT JOIN artist_alias aa ON am.artist_alias_id = aa.id
    LEFT JOIN music_external_link mel ON am.music_id = mel.music_id
    LEFT JOIN music_source_music msm ON am.music_id = msm.music_id
    LEFT JOIN music_source ms ON msm.music_source_id = ms.id
    LEFT JOIN music_source_title mst ON ms.id = mst.music_source_id AND mst.is_main_title = true
    WHERE am.artist_id = ${artistId}
      AND am.role = 1
)
SELECT
    COALESCE(source_title, 'Unknown Source') as "Source",
    display_name as "Song Title",
    COALESCE(artist_name, 'Unknown Artist') as "Artist",
    song_url as "URL",
    COALESCE(duration::text, 'Unknown') as "Duration"
FROM artist_songs
WHERE rn = 1
ORDER BY display_name;`.trim();

    executeQuery(query);
}

    function executeQuery(query) {
        const textarea = document.querySelector('#sqledit textarea[name="sql"]');
        const codeElement = document.querySelector('#sqledit .edit-c');

        if (!textarea) return;

        textarea.value = query;
        textarea.classList.remove('empty');

        if (textarea.oninput) {
            textarea.oninput();
        } else if (codeElement) {
            codeElement.innerHTML = query.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            if (typeof Prism !== 'undefined') {
                Prism.highlightElement(codeElement);
            }
        }

        setTimeout(() => {
            const runButton = document.querySelector('button[name="tab"][value="t"]');
            if (runButton) runButton.click();
        }, CONFIG.AUTO_EXECUTE_DELAY);
    }

    function setupObserver() {
        const main = document.querySelector('main.query');
        if (!main) return;

        const observer = new MutationObserver((mutations) => {
            if (!isSearchingArtist) return;

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.querySelector) {
                        const table = node.querySelector('table.results');
                        if (table) {
                            setTimeout(() => processSearchResults(table), 100);
                        }
                    }
                });
            });
        });

        observer.observe(main, { childList: true, subtree: true });
    }

    function processSearchResults(table) {
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        if (rows.length === 0) {
            showStatus('No artists found.');
            return;
        }

        const data = rows.map(row => {
            const cells = row.querySelectorAll('td');
            return cells.length >= 4 ? {
                id: cells[0].textContent.trim(),
                artist_name: cells[1].textContent.trim(),
                non_latin_alias: cells[2].textContent.trim() || null,
                name_type: cells[3].textContent.trim()
            } : null;
        }).filter(Boolean);

        if (data.length > 0) {
            displayResults(data);
            isSearchingArtist = false;
        }
    }

    function displayResults(data) {
        let html = '<table border="1">';
        html += '<thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Action</th></tr></thead>';
        html += '<tbody>';

        data.forEach(row => {
            html += `<tr>
                <td>${row.id}</td>
                <td>
                    <strong>${row.artist_name}</strong>
                    ${row.non_latin_alias ? `<br><small>${row.non_latin_alias}</small>` : ''}
                </td>
                <td>${row.name_type}</td>
                <td>
                    <button onclick="document.getElementById('emq-artist-id').value='${row.id}'; document.getElementById('emq-artist-results').innerHTML='<div>Artist ID ${row.id} selected!</div>'">
                        Use
                    </button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        document.getElementById('emq-artist-results').innerHTML = html;
    }

    function showStatus(message) {
        const resultsDiv = document.getElementById('emq-artist-results');
        if (resultsDiv) {
            resultsDiv.innerHTML = `<div>${message}</div>`;
        }
    }

})();
