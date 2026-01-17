// ==UserScript==
// @name         DBD Detailed Match History
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Changes match history rows to display a table with stats for all 5 players.
// @author       Snoggles
// @match        https://stats.deadbydaylight.com/match-history*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    console.log('[DBD Userscript] Script started at:', document.readyState);

    // --- Early CSS Injection (to prevent flash) ---
    const earlyStyle = document.createElement('style');
    earlyStyle.textContent = `
        html.dbd-data-ready .\\@container\\/match-card:not(.dbd-table-mode) {
            opacity: 0 !important;
            pointer-events: none !important;
        }
    `;
    (document.head || document.documentElement).appendChild(earlyStyle);

    const ASSETS_BASE_URL = 'https://assets.live.bhvraccount.com/';
    // Targeting: https://account-backend.bhvr.com/player-stats/match-history/games/dbd/providers/bhvr?lang=en&limit=30
    const MATCH_HISTORY_API_REGEX = /\/player-stats\/match-history\/games\/dbd\/providers\/bhvr/;

    // --- Configuration ---
    const ICON_SIZE = 40;
    const ICON_SIZE_SMALL = ICON_SIZE * 0.8;
    const FONT_STACK = `"Nunito Sans", "Nunito Sans Fallback", "Noto Sans JP", "Noto Sans JP Fallback", "sans-serif", "Noto Sans SC", "Noto Sans SC Fallback", "sans-serif"`;

    // Store for intercepted match data
    const matchDataStore = new Map();

    function storeMatchData(data) {
        if (Array.isArray(data)) {
            data.forEach(match => {
                const matchId = `${match.matchStat.matchStartTime}_${match.matchStat.map.name}`;
                matchDataStore.set(matchId, match);
            });
            console.log(`[DBD Userscript] Stored ${data.length} matches. Total: ${matchDataStore.size}`);
            document.documentElement.classList.add('dbd-data-ready');
            processAllCards();
        }
    }

    // --- Interception & Data Retrieval ---

    const processedUrls = new Set();

    function setupInterception() {
        // --- Fetch Interception ---
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);
            let url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || args[0]?.href || '');

            if (MATCH_HISTORY_API_REGEX.test(url) && !processedUrls.has(url)) {
                processedUrls.add(url);
                console.log('[DBD Userscript] Intercepted fetch:', url);
                const clone = response.clone();
                clone.json().then(data => storeMatchData(data)).catch(err => console.error('[DBD Userscript] Fetch JSON error:', err));
            }
            return response;
        };

        // --- XHR Interception ---
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._url = url;
            return originalOpen.apply(this, arguments);
        };

        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function () {
            const xhr = this;
            const onDone = () => {
                if (MATCH_HISTORY_API_REGEX.test(xhr._url) && !processedUrls.has(xhr._url)) {
                    processedUrls.add(xhr._url);
                    console.log('[DBD Userscript] Intercepted XHR:', xhr._url);
                    try {
                        const data = JSON.parse(xhr.responseText);
                        storeMatchData(data);
                    } catch (err) {
                        console.error('[DBD Userscript] XHR JSON error:', err);
                    }
                }
            };
            this.addEventListener('load', onDone);
            this.addEventListener('readystatechange', () => { if (xhr.readyState === 4) onDone(); });
            return originalSend.apply(this, arguments);
        };
    }

    function extractFromSessionStorage() {
        try {
            const cacheRaw = sessionStorage.getItem('REACT_QUERY_OFFLINE_CACHE');
            if (!cacheRaw) return;

            const cache = JSON.parse(cacheRaw);
            const queries = cache?.clientState?.queries || [];

            const matchQuery = queries.find(q =>
                Array.isArray(q.queryKey) && q.queryKey[0] === 'stats.match-history'
            );

            if (matchQuery?.state?.data) {
                console.log('[DBD Userscript] Found cached match data in sessionStorage.');
                storeMatchData(matchQuery.state.data);
            }
        } catch (err) {
            console.error('[DBD Userscript] Error extracting from sessionStorage:', err);
        }
    }

    setupInterception();
    extractFromSessionStorage();

    // --- UI Rendering ---

    function formatTime(seconds) {
        if (!seconds && seconds !== 0) return '-';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function getImageUrl(path) {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        return ASSETS_BASE_URL + path;
    }

    function renderLoadoutItem(item, bgType, title = '', sizeClass = 'dbd-loadout-large') {
        const bgUrl = `https://assets.live.bhvraccount.com/display/${bgType}_bg.png`;
        const isEmpty = !item || !item.image?.path;
        const size = sizeClass === 'dbd-loadout-small' ? ICON_SIZE_SMALL : ICON_SIZE;

        const innerHtml = isEmpty
            ? ''
            : `<img src="${getImageUrl(item.image.path)}" alt="${item.name || ''}" class="dbd-loadout-icon">`;

        return `
            <div class="dbd-loadout-item ${sizeClass} ${isEmpty ? 'dbd-loadout-empty' : ''}" title="${item?.name || title}">
                <div class="dbd-loadout-bg" style="background-image: url('${bgUrl}')"></div>
                <div class="dbd-loadout-icon-container" style="width: ${size}px; height: ${size}px;">
                    ${innerHtml}
                </div>
            </div>
        `;
    }

    function createPlayerRow(player, isKiller, isUser = false, bpHour = null) {
        const loadout = player.characterLoadout || {};
        const postGame = player.postGameStat || {};

        // Post game stats - find the 4 values
        const statKeys = isKiller
            ? ['Hunter', 'Deviousness', 'Brutality', 'Sacrifice']
            : ['Objectives', 'Altruism', 'Boldness', 'Survival'];

        const statsHtml = statKeys.map(key => {
            const fullKey = isKiller ? `DBD_SlasherScoreCat_${key}` : `DBD_CamperScoreCat_${key}`;
            const score = postGame[fullKey] || 0;
            const isLow = score < 10000;
            return `<td class="dbd-stat-cell ${isLow ? 'dbd-stat-low' : ''}" title="${key}">${score.toLocaleString()}</td>`;
        }).join('');

        // Loadout construction
        const perks = loadout.perks || [];
        const perksHtml = [0, 1, 2, 3].map(i => renderLoadoutItem(perks[i], 'perk', `Perk ${i + 1}`)).join('');
        const offeringHtml = renderLoadoutItem(loadout.offering, 'offering', 'Offering');
        const itemPowerHtml = renderLoadoutItem(loadout.power, 'item', isKiller ? 'Power' : 'Item');
        const addons = loadout.addOns || [];
        const addonsHtml = [0, 1].map(i => renderLoadoutItem(addons[i], 'item', `Add-on ${i + 1}`, 'dbd-loadout-small')).join('');

        const loadoutHtml = `
            <td class="dbd-loadout-cell">
                <div class="dbd-loadout-container">
                    <div class="dbd-loadout-group">${perksHtml}</div>
                    <div class="dbd-loadout-divider"></div>
                    <div class="dbd-loadout-group">${offeringHtml}</div>
                    <div class="dbd-loadout-divider"></div>
                    <div class="dbd-loadout-group">
                        ${itemPowerHtml}
                        <span class="dbd-loadout-plus">+</span>
                        <div class="dbd-loadout-addons">${addonsHtml}</div>
                    </div>
                </div>
            </td>
        `;

        const statusIconHtml = player.playerStatus?.image?.path
            ? `<img src="${getImageUrl(player.playerStatus.image.path)}" class="dbd-status-icon-overlay">`
            : '';

        let bpHourHtml = '<td class="dbd-bph-cell"></td>';
        if (isUser) {
            const bpHourVal = bpHour ? (bpHour / 1000000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M' : '-';
            const bpHourFull = bpHour ? bpHour.toLocaleString() : '-';
            bpHourHtml = `<td class="dbd-bph-cell" title="${bpHourFull} BP/h (since last match)">${bpHourVal}</td>`;
        }

        const charBgUrl = `/_next/image/?url=%2Fstatic%2Fimages%2Fgames%2Fdbd%2Fcharacters%2F${isKiller ? 'killer' : 'survivor'}_bg.png&w=3840&q=75`;

        return `
            <tr class="dbd-player-row ${isKiller ? 'dbd-killer-row' : 'dbd-survivor-row'} ${isUser ? 'dbd-user-row' : 'dbd-opponent-row'}">
                <td class="dbd-char-cell">
                    <div class="dbd-char-container" title="${player.characterName?.name || ''}">
                        <img src="${charBgUrl}" class="dbd-char-bg" role="presentation">
                        <div class="dbd-char-icon-wrapper">
                            <img src="${getImageUrl(player.characterName?.image?.path)}" alt="${player.characterName?.name || ''}" class="dbd-char-icon">
                        </div>
                        ${!isKiller ? statusIconHtml : ''}
                    </div>
                </td>
                ${loadoutHtml}
                ${statsHtml}
                <td class="dbd-bp-cell">${player.bloodpointsEarned?.toLocaleString() || 0}</td>
                <td class="dbd-time-cell">${formatTime(player.playerTimeInMatch)}</td>
                ${bpHourHtml}
            </tr>
        `;
    }

    function createMatchTable(match) {
        // Sort: Survivors (VE_Camper) first, Killer (VE_Slasher) last -- just like in game.
        match.opponentStat.sort((a, b) => {
            if (a.playerRole === b.playerRole) return 0;
            return a.playerRole === 'VE_Slasher' ? 1 : -1;
        });

        // Calculate BP/hour for the current player
        // We need the previous match in chronological order
        const matchesSorted = Array.from(matchDataStore.values()).sort((a, b) => b.matchStat.matchStartTime - a.matchStat.matchStartTime);
        const currentIndex = matchesSorted.findIndex(m => m.matchStat.matchStartTime === match.matchStat.matchStartTime);

        let bpHour = null;
        if (currentIndex < matchesSorted.length - 1) {
            const currentEnd = match.matchStat.matchStartTime + match.matchStat.matchDuration;
            const prevMatch = matchesSorted[currentIndex + 1];
            const prevEnd = prevMatch.matchStat.matchStartTime + prevMatch.matchStat.matchDuration;
            const hourDiff = (currentEnd - prevEnd) / 3600;

            if (hourDiff > 0) {
                bpHour = Math.round(match.playerStat.bloodpointsEarned / hourDiff);
            }
        }

        const allPlayers = [match.playerStat].map(p => createPlayerRow(p, p.playerRole === 'VE_Slasher', true, bpHour));
        const opponentRows = match.opponentStat.map(p => createPlayerRow(p, p.playerRole === 'VE_Slasher', false));

        const rowsHtml = allPlayers.concat(opponentRows).join('');

        return `
            <table class="dbd-match-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Loadout</th>
                        <th title="Objectives / Brutality">Obj / Brut</th>
                        <th title="Survival / Deviousness">Surv / Dev</th>
                        <th title="Altruism / Hunter">Altr / Hunt</th>
                        <th title="Boldness / Sacrifice">Bold / Sacr</th>
                        <th>BP</th>
                        <th>Time</th>
                        <th>BP/h</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
    }

    // --- DOM Mutation Handling ---

    function transformCard(card, index) {
        if (card.dataset.dbdProcessed) return;

        // Try to find match by index first (simplest and usually correct if they align)
        // Match history matches newest first
        const matches = Array.from(matchDataStore.values()).sort((a, b) => b.matchStat.matchStartTime - a.matchStat.matchStartTime);
        let match = matches[index];

        // Fallback: Try to find by map name and duration if index doesn't seem right 
        // (though on this site they usually align perfectly)
        if (!match) {
            const mapNameElement = card.querySelector('.line-clamp-2');
            const durationElement = card.querySelector('.font-display');
            if (mapNameElement && durationElement) {
                const mapName = mapNameElement.textContent.trim();
                const durationText = durationElement.textContent.trim(); // e.g. "10:30"

                match = matches.find(m => {
                    const mName = m.matchStat.map.name;
                    const mDuration = formatTime(m.matchStat.matchDuration);
                    return mName === mapName && mDuration === durationText;
                });
            }
        }

        if (match) {
            // Create a replacement div to strip all original listeners from the button
            const newCard = document.createElement('div');

            // Copy all existing attributes (including classes for container queries)
            for (const attr of card.attributes) {
                newCard.setAttribute(attr.name, attr.value);
            }

            const isKillerMatch = Object.keys(match.playerStat?.postGameStat || {}).some(k => k.includes('Slasher'));
            newCard.classList.add(isKillerMatch ? 'dbd-killer-match' : 'dbd-survivor-match');

            newCard.innerHTML = createMatchTable(match);
            newCard.dataset.dbdProcessed = 'true';
            newCard.dataset.dbdExpanded = index === 0 ? 'true' : 'false';
            newCard.classList.add('dbd-table-mode');

            // Handle expansion toggle
            newCard.addEventListener('click', (e) => {
                // Ignore clicks on icons to avoid interfering with tooltips
                if (e.target.closest('.dbd-loadout-item')) return;

                const isExpanded = newCard.getAttribute('data-dbd-expanded') === 'true';
                newCard.setAttribute('data-dbd-expanded', isExpanded ? 'false' : 'true');
            });

            // Replace the button in the DOM
            card.parentNode.replaceChild(newCard, card);
        }
    }

    function processAllCards() {
        const selector = '.\\@container\\/match-card';
        const cards = document.querySelectorAll(selector);
        cards.forEach((card, index) => transformCard(card, index));
    }

    const observer = new MutationObserver((mutations) => {
        // debounce slightly to avoid spamming transformations
        if (window._dbdTimer) clearTimeout(window._dbdTimer);
        window._dbdTimer = setTimeout(processAllCards, 100);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // --- Initialization ---

    function init() {
        if (!document.head || !document.body) {
            setTimeout(init, 10);
            return;
        }

        console.log('[DBD Userscript] Initializing DOM components...');

        // CSS Injection
        const style = document.createElement('style');
        style.textContent = `
            .dbd-table-mode {
                display: block !important;
                padding: 8px !important;
                height: auto !important;
                min-height: unset !important;
                cursor: pointer !important;
                border: 1px solid rgba(206, 206, 206, 0.1) !important;
                margin-bottom: 8px !important;
                border-radius: 8px !important;
                overflow: hidden !important;
                width: 100% !important;
                transition: background 0.2s ease;
            }
            .dbd-survivor-match.dbd-table-mode {
                background: linear-gradient(157deg, oklab(0.372685 -0.0166675 -0.0297666 / 0.9) 0px, oklab(0.256055 -0.00657756 -0.0136725 / 0.5) 80%) !important;
            }
            .dbd-killer-match.dbd-table-mode {
                background: linear-gradient(157deg, oklab(0.300393 0.107573 0.060206 / 0.6) 0px, oklab(0.202126 0.0788645 0.0174824 / 0.36) 80%) !important;
            }
            .dbd-survivor-match.dbd-table-mode:hover {
                background: linear-gradient(157deg, oklab(0.372685 -0.0166675 -0.0297666 / 1) 0px, oklab(0.300393 -0.0105345 -0.0232491 / 0.6) 80%) !important;
            }
            .dbd-killer-match.dbd-table-mode:hover {
                background: linear-gradient(157deg, oklab(0.300393 0.107573 0.060206 / 0.8) 0px, oklab(0.202126 0.0788645 0.0174824 / 0.48) 80%) !important;
            }
            .dbd-table-mode[data-dbd-expanded="false"] .dbd-opponent-row {
                display: none;
            }
            .dbd-match-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 16px;
                color: #ccc;
                table-layout: fixed;
                font-family: ${FONT_STACK};
            }
            .dbd-match-table th {
                text-align: center;
                padding: 4px;
                border-bottom: 1px solid #333;
                color: #777;
                font-weight: 600;
                text-transform: uppercase;
                font-size: 9px;
                letter-spacing: 0.5px;
            }
            .dbd-player-row td {
                padding: 4px;
                border-bottom: 1px solid #222;
                vertical-align: middle;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .dbd-player-row:last-child td {
                border-bottom: none;
            }
            .dbd-killer-row {
                background: rgba(255, 68, 68, 0.08);
            }
            .dbd-killer-row td {
                border-bottom-color: rgba(255, 68, 68, 0.2);
            }
            .dbd-char-container {
                position: relative;
                width: ${ICON_SIZE}px;
                height: ${ICON_SIZE}px;
                overflow: hidden;
                border-radius: 2px;
            }
            .dbd-char-bg {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
                z-index: 1;
            }
            .dbd-char-icon-wrapper {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2;
                /* Matches the masking style from original site */
                clip-path: polygon(0 0, 100% 0, 100% 90%, 90% 100%, 0 100%);
            }
            .dbd-char-icon {
                width: 120%;
                max-width: none;
                height: auto;
                object-fit: contain;
            }
            .dbd-status-icon-overlay {
                position: absolute;
                bottom: -2px;
                right: -2px;
                width: 16px;
                height: 16px;
                background: #000;
                border-radius: 50%;
                border: 1px solid #444;
                padding: 1px;
                z-index: 3;
            }
            
            /* Loadout Styles */
            .dbd-loadout-cell {
                padding: 0 4px !important;
            }
            .dbd-loadout-container {
                display: flex;
                align-items: center;
                gap: 2px;
                height: ${ICON_SIZE}px;
            }
            .dbd-loadout-group {
                display: flex;
                align-items: center;
                gap: 1px;
            }
            .dbd-loadout-item {
                position: relative;
                display: inline-block;
                margin: 0px 2px;
            }
            .dbd-loadout-large {
                width: ${ICON_SIZE}px;
                height: ${ICON_SIZE}px;
            }
            .dbd-loadout-small {
                width: ${ICON_SIZE_SMALL}px;
                height: ${ICON_SIZE_SMALL}px;
            }
            .dbd-loadout-bg {
                position: absolute;
                inset: 0;
                background-position: center;
                background-size: contain;
                background-repeat: no-repeat;
                filter: brightness(0);
            }
            .dbd-loadout-empty .dbd-loadout-bg {
                opacity: 0.2;
            }
            .dbd-loadout-icon-container {
                position: relative;
                z-index: 1;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .dbd-loadout-icon {
                width: 100%;
                object-fit: contain;
            }
            .dbd-loadout-divider {
                width: 1px;
                align-self: stretch;
                background: #6f6f6f;
                margin: 0px 4px;
            }
            .dbd-loadout-plus {
                font-size: 14px;
                font-weight: bold;
                margin: 0 1px;
            }
            .dbd-loadout-addons {
                display: flex;
                flex-direction: row;
                gap: 1px;
            }

            .dbd-stat-cell {
                text-align: right;
                color: #aaa;
            }
            .dbd-stat-low {
                color: #d4af37;
            }
            .dbd-user-row {
                background: rgba(255, 255, 255, 0.05);
            }
            .dbd-bp-cell {
                text-align: right;
                color: #d4af37;
                font-weight: bold;
            }
            .dbd-bph-cell {
                text-align: right;
                color: #55acee;
                font-weight: bold;
            }
            .dbd-time-cell {
                text-align: center;
            }

            /* Column Widths (9 columns total) */
            .dbd-match-table th:nth-child(1), .dbd-match-table td:nth-child(1) { width: 45px; } /* Player */
            .dbd-match-table th:nth-child(2), .dbd-match-table td:nth-child(2) { width: 420px; } /* Loadout */
            .dbd-match-table th:nth-child(3), .dbd-match-table td:nth-child(3) { width: 50px; } /* Stat 1 */
            .dbd-match-table th:nth-child(4), .dbd-match-table td:nth-child(4) { width: 50px; } /* Stat 2 */
            .dbd-match-table th:nth-child(5), .dbd-match-table td:nth-child(5) { width: 50px; } /* Stat 3 */
            .dbd-match-table th:nth-child(6), .dbd-match-table td:nth-child(6) { width: 50px; } /* Stat 4 */
            .dbd-match-table th:nth-child(7), .dbd-match-table td:nth-child(7) { width: 70px; } /* BP */
            .dbd-match-table th:nth-child(8), .dbd-match-table td:nth-child(8) { width: 50px; } /* Time */
            .dbd-match-table th:nth-child(9), .dbd-match-table td:nth-child(9) { width: 65px; } /* BP/h */
        `;
        document.head.appendChild(style);

        // Observer
        const observer = new MutationObserver(() => {
            if (matchDataStore.size > 0) {
                if (window._dbdTimer) clearTimeout(window._dbdTimer);
                window._dbdTimer = setTimeout(processAllCards, 0);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Initial scan
        processAllCards();
    }

    // Start initialization when DOM begins loading
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
