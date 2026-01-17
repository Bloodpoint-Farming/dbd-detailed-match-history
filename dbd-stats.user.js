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

    const ASSETS_BASE_URL = 'https://assets.live.bhvraccount.com/';
    // Targeting: https://account-backend.bhvr.com/player-stats/match-history/games/dbd/providers/bhvr?lang=en&limit=30
    const MATCH_HISTORY_API_REGEX = /\/player-stats\/match-history\/games\/dbd\/providers\/bhvr/;

    // Store for intercepted match data
    const matchDataStore = new Map();

    function storeMatchData(data) {
        if (Array.isArray(data)) {
            data.forEach(match => {
                const matchId = `${match.matchStat.matchStartTime}_${match.matchStat.map.name}`;
                matchDataStore.set(matchId, match);
            });
            console.log(`[DBD Userscript] Stored ${data.length} matches. Total: ${matchDataStore.size}`);
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

        // Proactive Fallback: If we haven't caught anything in 2 seconds, try to fetch it ourselves
        setTimeout(attemptManualFetch, 2000);
    }

    async function attemptManualFetch() {
        if (matchDataStore.size > 0) return;

        console.log('[DBD Userscript] Interception missed or no data yet. Attempting manual fallback fetch...');
        try {
            const authStore = JSON.parse(localStorage.getItem('auth-store') || '{}');
            const token = authStore?.state?.authToken?.token;

            if (!token) {
                console.warn('[DBD Userscript] No auth token found in localStorage. Cannot perform fallback.');
                return;
            }

            const url = 'https://account-backend.bhvr.com/player-stats/match-history/games/dbd/providers/bhvr?lang=en&limit=30';
            const response = await fetch(url, { // Use global fetch here, not originalFetch
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('[DBD Userscript] Fallback fetch successful.');
                storeMatchData(data);
            } else {
                console.error('[DBD Userscript] Fallback fetch failed with status:', response.status);
            }
        } catch (e) {
            console.error('[DBD Userscript] Error during fallback fetch:', e);
        }
    }

    setupInterception();

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

    function createPlayerRow(player, isKiller) {
        const loadout = player.characterLoadout;
        const postGame = player.postGameStat || {};

        // Post game stats - find the 4 values
        // Survivors: Objectives, Altruism, Boldness, Survival
        // Killer: Hunter, Deviousness, Brutality, Sacrifice
        const statKeys = isKiller
            ? ['Hunter', 'Deviousness', 'Brutality', 'Sacrifice']
            : ['Objectives', 'Altruism', 'Boldness', 'Survival'];

        const statsHtml = statKeys.map(key => {
            const fullKey = isKiller ? `DBD_SlasherScoreCat_${key}` : `DBD_CamperScoreCat_${key}`;
            return `<td class="dbd-stat-cell" title="${key}">${postGame[fullKey] || 0}</td>`;
        }).join('');

        const perksHtml = (loadout.perks || []).map(perk =>
            `<img src="${getImageUrl(perk.image?.path)}" title="${perk.name}" class="dbd-perk-icon">`
        ).join('');

        const addonsHtml = (loadout.addOns || []).map(addon =>
            `<img src="${getImageUrl(addon.image?.path)}" title="${addon.name}" class="dbd-addon-icon">`
        ).join('');

        const powerOrItemHtml = `<img src="${getImageUrl(loadout.power?.image?.path)}" title="${loadout.power?.name}" class="dbd-power-icon">`;

        const statusIconHtml = player.playerStatus?.image?.path
            ? `<img src="${getImageUrl(player.playerStatus.image.path)}" class="dbd-status-icon-overlay">`
            : '';

        return `
            <tr class="dbd-player-row ${isKiller ? 'dbd-killer-row' : 'dbd-survivor-row'}">
                <td class="dbd-char-cell">
                    <div class="dbd-char-container">
                        <img src="${getImageUrl(player.characterName?.image?.path)}" title="${player.characterName?.name}" class="dbd-char-icon">
                        ${!isKiller ? statusIconHtml : ''}
                    </div>
                </td>
                <td class="dbd-perks-cell">${perksHtml}</td>
                <td class="dbd-offering-cell">
                    <img src="${getImageUrl(loadout.offering?.image?.path)}" title="${loadout.offering?.name}" class="dbd-offering-icon">
                </td>
                <td class="dbd-item-cell">
                    <div class="dbd-loadout-item-group">
                        ${powerOrItemHtml}
                        <div class="dbd-addons-container">${addonsHtml}</div>
                    </div>
                </td>
                <td class="dbd-bp-cell">${player.bloodpointsEarned?.toLocaleString() || 0}</td>
                ${statsHtml}
                <td class="dbd-time-cell">${formatTime(player.playerTimeInMatch)}</td>
            </tr>
        `;
    }

    function createMatchTable(match) {
        // Sort: Survivors (VE_Camper) first, Killer (VE_Slasher) last -- just like in game.
        match.opponentStat.sort((a, b) => {
            if (a.playerRole === b.playerRole) return 0;
            return a.playerRole === 'VE_Slasher' ? 1 : -1;
        });

        const allPlayers = [match.playerStat, ...match.opponentStat];

        const rowsHtml = allPlayers.map(p => createPlayerRow(p, p.playerRole === 'VE_Slasher')).join('');

        return `
            <table class="dbd-match-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Perks</th>
                        <th>Off.</th>
                        <th>Item/Addons</th>
                        <th>BP</th>
                        <th colspan="4">Score Categories</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
    }

    // --- DOM Mutation Handling ---

    function getMatchKey(m) {
        return `${m.matchStat.map.name}_${Math.floor(m.matchStat.matchDuration)}`;
    }

    function transformCard(card, index) {
        if (card.dataset.dbdProcessed) return;

        // console.log(`[DBD Userscript] transformCard()`, matchDataStore);

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
            console.log(`[DBD Userscript] Transforming card ${index} for match:`, match);
            card.innerHTML = createMatchTable(match);
            card.dataset.dbdProcessed = 'true';
            card.classList.add('dbd-table-mode');
        }
    }

    function processAllCards() {
        const selector = '.\\@container\\/match-card';
        const cards = document.querySelectorAll(selector);
        console.log(`[DBD Userscript] cards.length == ${cards.length}.`);
        cards.forEach((card, index) => transformCard(card, index));
    }

    const observer = new MutationObserver((mutations) => {
        console.log(`[DBD Userscript] Mutation observed.`);
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
            .@container/match-card.dbd-table-mode {
                display: block !important;
                padding: 8px !important;
                height: auto !important;
                min-height: unset !important;
                cursor: default !important;
                background: #111 !important;
                border: 1px solid #333 !important;
                margin-bottom: 8px !important;
                border-radius: 8px !important;
                overflow: hidden !important;
                width: 100% !important;
            }
            .dbd-match-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
                color: #ccc;
                table-layout: fixed;
            }
            .dbd-match-table th {
                text-align: left;
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
                width: 40px;
                height: 40px;
            }
            .dbd-char-icon {
                width: 40px;
                height: 40px;
                border-radius: 4px;
                object-fit: cover;
                border: 1px solid #444;
            }
            .dbd-status-icon-overlay {
                position: absolute;
                bottom: -2px;
                right: -2px;
                width: 18px;
                height: 18px;
                background: #000;
                border-radius: 50%;
                border: 1px solid #444;
                padding: 1px;
            }
            .dbd-perk-icon {
                width: 28px;
                height: 28px;
                margin-right: 1px;
                vertical-align: middle;
                background: rgba(0,0,0,0.3);
                border-radius: 2px;
            }
            .dbd-offering-icon {
                width: 28px;
                height: 28px;
                vertical-align: middle;
                background: rgba(0,0,0,0.3);
                border-radius: 2px;
            }
            .dbd-power-icon {
                width: 32px;
                height: 32px;
                vertical-align: middle;
                background: rgba(0,0,0,0.3);
                border-radius: 2px;
            }
            .dbd-addon-icon {
                width: 20px;
                height: 20px;
                margin-left: 1px;
                vertical-align: middle;
                background: rgba(0,0,0,0.3);
                border-radius: 2px;
            }
            .dbd-loadout-item-group {
                display: flex;
                align-items: center;
            }
            .dbd-addons-container {
                display: flex;
                flex-direction: column;
                margin-left: 2px;
                gap: 1px;
            }
            .dbd-stat-cell {
                text-align: right;
                color: #aaa;
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
            }
            .dbd-bp-cell {
                text-align: right;
                color: #d4af37;
                font-weight: bold;
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
            }
            .dbd-time-cell {
                text-align: center;
                color: #666;
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
            }

            /* Column Widths */
            .dbd-match-table th:nth-child(1), .dbd-match-table td:nth-child(1) { width: 50px; } /* Player */
            .dbd-match-table th:nth-child(2), .dbd-match-table td:nth-child(2) { width: 120px; } /* Perks */
            .dbd-match-table th:nth-child(3), .dbd-match-table td:nth-child(3) { width: 40px; } /* Offering */
            .dbd-match-table th:nth-child(4), .dbd-match-table td:nth-child(4) { width: 60px; } /* Item/Addons */
            .dbd-match-table th:nth-child(5), .dbd-match-table td:nth-child(5) { width: 70px; } /* BP */
            .dbd-stat-cell { width: 45px; } 
            .dbd-match-table th:nth-child(7), .dbd-match-table td:nth-child(10) { width: 50px; } /* Time */
        `;
        document.head.appendChild(style);

        // Observer
        const observer = new MutationObserver(() => {
            if (window._dbdTimer) clearTimeout(window._dbdTimer);
            window._dbdTimer = setTimeout(processAllCards, 100);
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
