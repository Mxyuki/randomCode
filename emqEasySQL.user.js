// ==UserScript==
// @name         EMQ Easy SQL
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Easy artist ID search, song queries, and VN search
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
    let isSearchingVN = false;

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

            <div>
                <h4>Find VN ID</h4>
                <div>
                    <input type="text"
                           id="emq-vn-name"
                           placeholder="Enter VN name...">
                    <button id="emq-vn-search-btn">Search VN</button>
                </div>
                <div id="emq-vn-results"></div>
            </div>

            <div>
                <h4>Get VN Songs</h4>
                <div>
                    <input type="number"
                           id="emq-vn-id"
                           placeholder="Enter VN ID...">
                    <button id="emq-vn-songs-btn">Load VN</button>
                </div>
            </div>
        `;

        form.parentNode.insertBefore(container, form);

        // Existing event listeners
        document.getElementById('emq-search-btn').addEventListener('click', searchArtist);
        document.getElementById('emq-songs-btn').addEventListener('click', loadSongs);

        document.getElementById('emq-artist-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchArtist();
        });

        document.getElementById('emq-artist-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadSongs();
        });

        // New VN event listeners
        document.getElementById('emq-vn-search-btn').addEventListener('click', searchVN);
        document.getElementById('emq-vn-songs-btn').addEventListener('click', loadVNSongs);

        document.getElementById('emq-vn-name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchVN();
        });

        document.getElementById('emq-vn-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadVNSongs();
        });
    }

    function searchArtist() {
        const artistName = document.getElementById('emq-artist-name').value.trim();
        if (!artistName) {
            showStatus('Please enter an artist name.', 'emq-artist-results');
            return;
        }

        showStatus('Searching...', 'emq-artist-results');
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

    function searchVN() {
        const vnName = document.getElementById('emq-vn-name').value.trim();
        if (!vnName) {
            showStatus('Please enter a VN name.', 'emq-vn-results');
            return;
        }

        showStatus('Searching VNs...', 'emq-vn-results');
        isSearchingVN = true;

        const escapedName = vnName.replace(/'/g, "''");
        const searchTerms = vnName.split(/\s+/).filter(term => term.length > 0);
        const searchConditions = searchTerms.map(term => {
            const escaped = term.replace(/'/g, "''");
            return `(LOWER(mst.latin_title) ILIKE LOWER('%${escaped}%') OR LOWER(mst.non_latin_title) ILIKE LOWER('%${escaped}%'))`;
        }).join(' AND ');

        const query = `
SELECT
    ms.id,
    mst.latin_title as vn_name,
    mst.non_latin_title,
    CASE WHEN mst.is_main_title THEN 'Main' ELSE 'Alt' END as title_type,
    ms.type,
    ms.air_date_start,
    CASE
        WHEN LOWER(mst.latin_title) = LOWER('${escapedName}') THEN 100
        WHEN LOWER(mst.latin_title) ILIKE LOWER('${escapedName}') THEN 95
        WHEN LOWER(mst.latin_title) ILIKE LOWER('%${escapedName}%') THEN 85
        ${searchTerms.length > 1 ? `WHEN ${searchConditions} THEN 80` : ''}
        ELSE 50
    END as similarity_score
FROM music_source ms
JOIN music_source_title mst ON ms.id = mst.music_source_id
WHERE ${searchConditions}
ORDER BY similarity_score DESC, mst.is_main_title DESC, mst.latin_title
LIMIT ${CONFIG.SEARCH_LIMIT};`.trim();

        executeQuery(query);
    }

    function loadSongs() {
        const artistId = document.getElementById('emq-artist-id').value.trim();
        if (!artistId || isNaN(artistId)) {
            showStatus('Please enter a valid artist ID.', 'emq-artist-results');
            return;
        }

        showStatus(`Loading songs for Artist ID: ${artistId}...`, 'emq-artist-results');
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

    function loadVNSongs() {
        const vnId = document.getElementById('emq-vn-id').value.trim();
        if (!vnId || isNaN(vnId)) {
            showStatus('Please enter a valid VN ID.', 'emq-vn-results');
            return;
        }

        showStatus(`Loading songs for VN ID: ${vnId}...`, 'emq-vn-results');
        isSearchingVN = false;

        const query = `
WITH vn_songs AS (
    SELECT DISTINCT
        msm.music_id,
        mt.latin_title AS song_name,
        mt.non_latin_title,
        COALESCE(mt.latin_title, mt.non_latin_title) as display_name,
        COALESCE(mst.latin_title, mst.non_latin_title) as source_title,
        aa.latin_alias AS artist_name,
        CASE
            WHEN mel.duration = '00:00:00' THEN NULL
            WHEN mel.url LIKE 'https://emqselfhost/selfhoststorage/%' THEN
                REPLACE(mel.url, 'https://emqselfhost/selfhoststorage/', 'https://erogemusicquiz.com/selfhoststorage/')
            ELSE mel.url
        END AS song_url,
        mel.duration,
        msm.type as music_type,
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
    FROM music_source_music msm
    JOIN music_title mt ON msm.music_id = mt.music_id AND mt.is_main_title = true
    LEFT JOIN music_source ms ON msm.music_source_id = ms.id
    LEFT JOIN music_source_title mst ON ms.id = mst.music_source_id AND mst.is_main_title = true
    LEFT JOIN music_external_link mel ON msm.music_id = mel.music_id
    LEFT JOIN artist_music am ON msm.music_id = am.music_id AND am.role = 1
    LEFT JOIN artist_alias aa ON am.artist_alias_id = aa.id
    WHERE msm.music_source_id = ${vnId}
)
SELECT
    source_title as "VN Title",
    display_name as "Song Title",
    COALESCE(artist_name, 'Unknown Artist') as "Artist",
    CASE
        WHEN music_type = 1 THEN 'OP'
        WHEN music_type = 2 THEN 'ED'
        WHEN music_type = 3 THEN 'BGM'
        ELSE 'Other'
    END as "Type",
    song_url as "URL",
    COALESCE(duration::text, 'Unknown') as "Duration"
FROM vn_songs
WHERE rn = 1
ORDER BY music_type, display_name;`.trim();

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
            if (!isSearchingArtist && !isSearchingVN) return;

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.querySelector) {
                        const table = node.querySelector('table.results');
                        if (table) {
                            setTimeout(() => {
                                if (isSearchingArtist) {
                                    processSearchResults(table, 'artist');
                                } else if (isSearchingVN) {
                                    processSearchResults(table, 'vn');
                                }
                            }, 100);
                        }
                    }
                });
            });
        });

        observer.observe(main, { childList: true, subtree: true });
    }

    function processSearchResults(table, type) {
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        if (rows.length === 0) {
            const message = type === 'artist' ? 'No artists found.' : 'No VNs found.';
            const resultsId = type === 'artist' ? 'emq-artist-results' : 'emq-vn-results';
            showStatus(message, resultsId);
            return;
        }

        const data = rows.map(row => {
            const cells = row.querySelectorAll('td');
            if (type === 'artist') {
                return cells.length >= 4 ? {
                    id: cells[0].textContent.trim(),
                    name: cells[1].textContent.trim(),
                    non_latin: cells[2].textContent.trim() || null,
                    type: cells[3].textContent.trim()
                } : null;
            } else {
                return cells.length >= 6 ? {
                    id: cells[0].textContent.trim(),
                    name: cells[1].textContent.trim(),
                    non_latin: cells[2].textContent.trim() || null,
                    title_type: cells[3].textContent.trim(),
                    source_type: cells[4].textContent.trim(),
                    air_date: cells[5].textContent.trim() || null
                } : null;
            }
        }).filter(Boolean);

        if (data.length > 0) {
            displayResults(data, type);
            if (type === 'artist') {
                isSearchingArtist = false;
            } else {
                isSearchingVN = false;
            }
        }
    }

    function displayResults(data, type) {
        let html = '<table border="1">';

        if (type === 'artist') {
            html += '<thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Action</th></tr></thead>';
            html += '<tbody>';

            data.forEach(row => {
                html += `<tr>
                    <td>${row.id}</td>
                    <td>
                        <strong>${row.name}</strong>
                        ${row.non_latin ? `<br><small>${row.non_latin}</small>` : ''}
                    </td>
                    <td>${row.type}</td>
                    <td>
                        <button onclick="document.getElementById('emq-artist-id').value='${row.id}'; document.getElementById('emq-artist-results').innerHTML='<div>Artist ID ${row.id} selected!</div>'">
                            Use
                        </button>
                    </td>
                </tr>`;
            });
        } else {
            html += '<thead><tr><th>ID</th><th>VN Name</th><th>Type</th><th>Air Date</th><th>Action</th></tr></thead>';
            html += '<tbody>';

            data.forEach(row => {
                html += `<tr>
                    <td>${row.id}</td>
                    <td>
                        <strong>${row.name}</strong>
                        ${row.non_latin ? `<br><small>${row.non_latin}</small>` : ''}
                    </td>
                    <td>${row.title_type} (Type: ${row.source_type})</td>
                    <td>${row.air_date || 'Unknown'}</td>
                    <td>
                        <button onclick="document.getElementById('emq-vn-id').value='${row.id}'; document.getElementById('emq-vn-results').innerHTML='<div>VN ID ${row.id} selected!</div>'">
                            Use
                        </button>
                    </td>
                </tr>`;
            });
        }

        html += '</tbody></table>';

        const resultsId = type === 'artist' ? 'emq-artist-results' : 'emq-vn-results';
        document.getElementById(resultsId).innerHTML = html;
    }

    function showStatus(message, resultsId) {
        const resultsDiv = document.getElementById(resultsId);
        if (resultsDiv) {
            resultsDiv.innerHTML = `<div>${message}</div>`;
        }
    }

})();
