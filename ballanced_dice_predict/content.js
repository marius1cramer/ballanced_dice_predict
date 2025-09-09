/**
 * Colonist.io Dice Roll Tracker
 * Content Script for Browser Extension
 * * Detects dice rolls and displays them in a draggable overlay
 */

class ColonistDiceTracker {
    constructor() {
        this.rolls = [];
        this.maxRolls = 10; // Maximum number of rolls to display
        this.overlay = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.observer = null;
        // Track processed messages and processed roll ids separately
        this.processedMessageIndexes = new Set(); // numeric data-index values
        this.processedRollIds = new Set(); // composite roll ids
        this.highestDataIndex = -1; // Track the highest data-index processed
        // Prediction state
        this.diceTotals = Array(11).fill(0); // For totals 2-12
        this.playerSevens = {};
        this.playerStreaks = {};
        this.players = [];
    // Persistent canonical display order for players to avoid UI swapping
    this.playerOrder = [];
        // Mirror TS state: total sevens per player and current seven streak record
        this.totalSevensRolledByPlayer = new Map(); // Map<player, count>
        this.sevenStreakCount = { playerColor: null, streakCount: 0 };
    // Internal guard set to avoid processing the same roll twice
    this._addedRollKeys = new Set();
    // Recent consumption map to debounce nearly-simultaneous duplicate events
    this._recentConsumptions = new Map(); // key -> timestamp
        // Deck simulation state (36 combinations total)
        this.cardsLeftInDeck = 36;
    // track last up to 5 sums for recent-roll smoothing (matches recentRolls in TS)
    this.recentRolls = [];
    this.deckCounts = [1,2,3,4,5,6,5,4,3,2,1]; // counts per total 2..12
        this.init();
    }

    init() {
        // Wait for page to be fully loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.start());
        } else {
            this.start();
        }
    }

    start() {
        this.createOverlay();
        this.startObserving();
        console.log('Colonist.io Dice Tracker initialized');
    }

    createOverlay() {
        // Create overlay container
        this.overlay = document.createElement('div');
        this.overlay.id = 'dice-tracker-overlay';
        this.overlay.style.resize = 'both';
        this.overlay.style.overflow = 'auto';
        this.overlay.style.minWidth = '80px';
        this.overlay.style.minHeight = '40px';
        this.overlay.innerHTML = `
            <div class="dice-tracker-header">
                <span class="dice-tracker-title">🎲 Dice Rolls & Prediction</span>
                <span class="dice-tracker-drag-handle">⋮⋮</span>
            </div>
            <div class="dice-tracker-content">
                <div class="dice-tracker-empty">No rolls yet...</div>
                <div id="dice-prediction-table"></div>
                <div id="player-7s-table"></div>
            </div>
        `;

        // Add CSS styles
        this.addStyles();

        // Add event listeners for dragging
        this.addDragListeners();

        // Add to page
        document.body.appendChild(this.overlay);

        // Position overlay (top-right corner by default)
        this.positionOverlay(window.innerWidth - 220, 20);
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #dice-tracker-overlay {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 200px;
                min-height: 100px;
                background: rgba(0, 0, 0, 0.85);
                color: white;
                border-radius: 8px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 9999;
                user-select: none;
                backdrop-filter: blur(4px);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .dice-tracker-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 8px 8px 0 0;
                cursor: move;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }

            .dice-tracker-title {
                font-weight: bold;
                font-size: 13px;
            }

            .dice-tracker-drag-handle {
                opacity: 0.6;
                font-size: 14px;
                line-height: 1;
            }

            .dice-tracker-content {
                padding: 8px 12px;
                min-height: 40px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                /* No overflow-y, let parent scroll */
            }

            .dice-tracker-empty {
                text-align: center;
                opacity: 0.6;
                font-style: italic;
                padding: 20px 0;
            }

            .dice-roll-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }

            .dice-roll-item:last-child {
                border-bottom: none;
            }

            .dice-roll-dice {
                display: flex;
                gap: 4px;
                align-items: center;
            }

            .dice-roll-die {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                padding: 2px 6px;
                font-weight: bold;
                font-size: 14px;
                min-width: 20px;
                text-align: center;
            }

            .dice-roll-sum {
                font-weight: bold;
                color: #4CAF50;
                font-size: 14px;
            }

            .dice-roll-player {
                font-size: 10px;
                opacity: 0.8;
                margin-top: 2px;
                font-weight: bold;
            }

            /* Scrollbar styling */
            .dice-tracker-content::-webkit-scrollbar {
                width: 4px;
            }

            .dice-tracker-content::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
            }

            .dice-tracker-content::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 2px;
            }

            .dice-tracker-content::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.5);
            }

            /* Tables */
            table {
                width: 100%;
                margin-top: 10px;
                border-collapse: collapse;
                font-size: 12px;
            }

            th {
                background: rgba(255, 255, 255, 0.1);
                padding: 8px;
                text-align: left;
            }

            td {
                padding: 8px;
                text-align: right;
            }

            tr:hover {
                background: rgba(255, 255, 255, 0.05);
            }

            /* Dark mode styles */
            #dice-tracker-overlay.dark-mode {
                background: rgba(255, 255, 255, 0.1);
                color: #000;
                border: 1px solid rgba(0, 0, 0, 0.1);
            }

            #dice-tracker-overlay.dark-mode .dice-tracker-header {
                background: rgba(0, 0, 0, 0.1);
                border-bottom: 1px solid rgba(0, 0, 0, 0.2);
            }

            #dice-tracker-overlay.dark-mode .dice-roll-die {
                background: rgba(0, 0, 0, 0.2);
                color: #fff;
            }

            #dice-tracker-overlay.dark-mode table {
                background: rgba(255, 255, 255, 0.05);
            }

            #dice-tracker-overlay.dark-mode th {
                background: rgba(255, 255, 255, 0.1);
                color: #000;
            }

            #dice-tracker-overlay.dark-mode td {
                background: rgba(255, 255, 255, 0.1);
                color: #000;
            }
        `;
        document.head.appendChild(style);
    }

    addDragListeners() {
        const header = this.overlay.querySelector('.dice-tracker-header');
        
        header.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            const rect = this.overlay.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            
            document.addEventListener('mousemove', this.handleDrag);
            document.addEventListener('mouseup', this.handleDragEnd);
            
            e.preventDefault();
        });
    }

    handleDrag = (e) => {
        if (!this.isDragging) return;
        
        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;
        
        this.positionOverlay(x, y);
    };

    handleDragEnd = () => {
        this.isDragging = false;
        document.removeEventListener('mousemove', this.handleDrag);
        document.removeEventListener('mouseup', this.handleDragEnd);
    };

    positionOverlay(x, y) {
        const rect = this.overlay.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;
        
        // Constrain to viewport
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));
        
        this.overlay.style.left = x + 'px';
        this.overlay.style.top = y + 'px';
        this.overlay.style.right = 'auto';
    }

    startObserving() {
        const firstMessage = document.querySelector('[data-index]');
        const chatContainer = firstMessage ? firstMessage.parentElement : null;

        if (!chatContainer) {
            console.warn('Chat container not found, retrying in 1 second...');
            setTimeout(() => this.startObserving(), 1000);
            return;
        }

        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    this.processMessages(chatContainer);
                }
            });
        });

        this.observer.observe(chatContainer, {
            childList: true,
            subtree: false
        });

        // Clear processed tracking to ensure new rolls are detected after a refresh
        this.processedMessageIndexes.clear();
        this.processedRollIds.clear();

        // Immediately scan existing messages once
        this.processMessages(chatContainer);
    }

    processMessages(container) {
        const allMessages = Array.from(container.querySelectorAll('[data-index]'));

        // Include all messages with a valid data-index
        const validMessages = allMessages.filter(message => {
            const index = parseInt(message.getAttribute('data-index'), 10);
            return !isNaN(index);
        });

        // Sort messages by data-index
        validMessages.sort((a, b) => {
            const indexA = parseInt(a.getAttribute('data-index'), 10);
            const indexB = parseInt(b.getAttribute('data-index'), 10);
            return indexA - indexB;
        });

        // Process sorted messages (ascending order) and only once per message index
        validMessages.forEach(message => {
            const msgIndex = parseInt(message.getAttribute('data-index'), 10);
            if (this.processedMessageIndexes.has(msgIndex)) return; // already processed and had no new dice

            // If this message currently contains dice images, process it now.
            const diceImages = message.querySelectorAll('img[src*="dice_"]');
            if (diceImages.length === 2) {
                // mark message index as processed so we don't re-scan a message that already yielded a roll
                this.processedMessageIndexes.add(msgIndex);
                this.highestDataIndex = Math.max(this.highestDataIndex, msgIndex);
                this.checkForDiceRoll(message, msgIndex);
            } else {
                // leave unmarked so future mutations (e.g., images loaded when scrolling) can be re-scanned
                // but update highestDataIndex for visibility
                this.highestDataIndex = Math.max(this.highestDataIndex, msgIndex);
            }
        });

        // Deduplicate rolls by their index+player+dice and ensure ascending order
        const unique = [];
        const seen = new Set();
        for (const r of this.rolls) {
            const key = `${r.index}-${r.player}-${r.dice[0]}-${r.dice[1]}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }
        this.rolls = unique.sort((a, b) => a.index - b.index);

        // Rebuild prediction state from rolls
        this.rebuildPredictionStateFromRolls();
    }

    checkExistingMessages(container) {
        // Use the `data-index` attribute to identify all message elements.
        const messages = Array.from(container.querySelectorAll('[data-index]'));

        // Sort messages by their data-index attribute (ascending order)
        messages.sort((a, b) => {
            const indexA = parseInt(a.getAttribute('data-index'), 10);
            const indexB = parseInt(b.getAttribute('data-index'), 10);
            return indexA - indexB;
        });

        // Process each message
        messages.forEach(message => this.checkForDiceRoll(message));
    }

    checkForDiceRoll(messageElement, msgIndexOverride) {
        // Look for exactly two dice images in the message element.
        const diceImages = messageElement.querySelectorAll('img[src*="dice_"]');

        if (diceImages.length === 2) {
            const dice = Array.from(diceImages).map(img => {
                const src = img.getAttribute('src');
                const match = src.match(/dice_(\d+)/);
                return match ? parseInt(match[1]) : null;
            }).filter(die => die !== null);

            if (dice.length === 2) {
                // Find the player span by looking for a span with an inline color style.
                const playerSpan = messageElement.querySelector('span[style*="color"]');

                if (!playerSpan) {
                    console.error("Colonist.io Dice Tracker: A dice roll was detected, but the player's name could not be found.", messageElement);
                    return;
                }

                const playerName = playerSpan.textContent.trim();
                const playerColor = playerSpan.style.color || '#FFFFFF'; // Default to white

                // Normalize dice order so 3+4 and 4+3 are treated the same
                const sortedDice = dice.slice().sort((a,b) => a - b);

                // Use messageElement's dataset index (prefer override) and roll details for a unique id
                const msgIndex = (typeof msgIndexOverride !== 'undefined') ? msgIndexOverride : parseInt(messageElement.getAttribute('data-index'), 10) || 0;
                const rollId = `${msgIndex}-${playerName}-${sortedDice[0]}-${sortedDice[1]}`;

                if (!this.processedRollIds.has(rollId)) {
                    this.processedRollIds.add(rollId);
                    console.debug('DiceTracker: detected roll', { msgIndex, rollId, dice: sortedDice, playerName });
                    // Pass the DOM message index into addRoll so ordering is stable across reloads
                    this.addRoll(sortedDice[0], sortedDice[1], playerName, playerColor, msgIndex);
                }
             }
         }
     }

    // index parameter is the numeric data-index from the DOM message
    addRoll(die1, die2, playerName, playerColor, index) {
        // Defensive: canonicalize the roll key and ignore if we've already processed it
        const a = Math.min(die1, die2);
        const b = Math.max(die1, die2);
        const canonicalKey = `${index}-${playerName}-${a}-${b}`;
        // Debounce near-duplicate events with the same player+dice (1.5s window)
        const now = Date.now();
        const consumptionSig = `${playerName}-${a}-${b}`;
        const last = this._recentConsumptions.get(consumptionSig) || 0;
        if (now - last < 1500) {
            // If we've already processed a roll with the same player+dice very recently, ignore to avoid double-decrement
            console.debug('DiceTracker:addRoll debounced near-duplicate', { canonicalKey, consumptionSig, deltaMs: now - last });
            return;
        }
        this._recentConsumptions.set(consumptionSig, now);
        // Also skip if exact canonical key already processed
        if (this._addedRollKeys.has(canonicalKey)) {
            console.debug('DiceTracker:addRoll ignored duplicate', canonicalKey);
            return;
        }
        this._addedRollKeys.add(canonicalKey);

        const roll = {
            dice: [die1, die2],
            sum: die1 + die2,
            player: playerName,
            color: playerColor,
            timestamp: new Date(),
            index: Number.isFinite(index) ? parseInt(index, 10) : Date.now()
        };

        // Append and maintain ordering by message index (ascending)
        this.rolls.push(roll);

        // Deduplicate by index/player/dice immediately
        const key = `${roll.index}-${roll.player}-${roll.dice[0]}-${roll.dice[1]}`;

        // Keep only the last N rolls after sorting
        this.rolls = this.rolls
            .sort((a, b) => a.index - b.index)
            .filter((r, i, arr) => {
                // keep first occurrence for a given index+player+dice
                const k = `${r.index}-${r.player}-${r.dice[0]}-${r.dice[1]}`;
                return arr.findIndex(x => `${x.index}-${x.player}-${x.dice[0]}-${x.dice[1]}` === k) === i;
            });

        if (this.rolls.length > this.maxRolls) {
            this.rolls = this.rolls.slice(-this.maxRolls);
        }

        // Deck consumption: update deckCounts and recentRolls and derive cardsLeftInDeck from deckCounts
        if (typeof this.cardsLeftInDeck !== 'number') this.cardsLeftInDeck = 36;
        if (!Array.isArray(this.deckCounts)) this.deckCounts = [1,2,3,4,5,6,5,4,3,2,1];
        // Update deckCounts for this rolled total (clamp to 0)
        const idx = roll.sum - 2;
        if (this.deckCounts[idx] > 0) {
            this.deckCounts[idx] = Math.max(0, this.deckCounts[idx] - 1);
        }
        // Recompute cards left from deckCounts (single source of truth)
        this.cardsLeftInDeck = this.deckCounts.reduce((a, b) => a + b, 0);
        // Track recent rolls
        this.recentRolls.push(roll.sum);
        if (this.recentRolls.length > 5) this.recentRolls.shift();

        // Debug a concise deck update for troubleshooting
        console.debug('DiceTracker:addRoll deck update', { sum: roll.sum, deckCountAfter: this.deckCounts[idx], cardsLeftInDeck: this.cardsLeftInDeck });

        // Reshuffle when cards left <= 13 to match DiceControllerBalanced logic
        if (this.cardsLeftInDeck <= 13) {
            this.reshuffleDeck();
        }

        // Update cumulative seven-state if this was a 7 (mirror DiceControllerBalanced.updateSevenRolls)
        if (roll.sum === 7) {
            // init map entry if missing
            if (!this.totalSevensRolledByPlayer.has(roll.player)) {
                this.totalSevensRolledByPlayer.set(roll.player, 0);
            }
            this.totalSevensRolledByPlayer.set(roll.player, this.totalSevensRolledByPlayer.get(roll.player) + 1);

            // update streak record
            if (this.sevenStreakCount.playerColor === roll.player) {
                this.sevenStreakCount.streakCount += 1;
            } else {
                this.sevenStreakCount.playerColor = roll.player;
                this.sevenStreakCount.streakCount = 1;
            }
        }

        // Rebuild prediction state from full rolls list for display (but keep cumulative seven-map/streak intact)
        this.rebuildPredictionStateFromRolls();
        this.updateDisplay();
    }

    reshuffleDeck() {
    // Reset deck to full set of 36 combinations and clear recent deck history
    this.cardsLeftInDeck = 36;
    this.deckCounts = [1,2,3,4,5,6,5,4,3,2,1];
    this.recentRolls = [];
    // Reset display accumulators (do NOT clear persistent seven-state or player order)
    this.diceTotals = Array(11).fill(0);
    this.playerSevens = {};
    this.playerStreaks = {};
    this.players = [];
        // Keep the recent UI rolls if you want, but predictions reset when deck reshuffles
        console.debug('DiceTracker: deck reshuffled, prediction state cleared, cardsLeftInDeck reset to 36');
        // Refresh the UI immediately so the table reflects cleared stats
        this.updateDisplay();
    }

    rebuildPredictionStateFromRolls() {
    // Reset accumulators used for display (do NOT clear persistent cumulative state)
    this.diceTotals = Array(11).fill(0);
    this.playerSevens = {};
    this.playerStreaks = {};
    this.players = [];
    // Keep this.totalSevensRolledByPlayer and this.sevenStreakCount intact

        // Build players list and counts in order of appearance
        for (const r of this.rolls) {
            if (!this.players.includes(r.player)) {
                this.players.push(r.player);
            }
            // maintain a persistent display order when first seen
            if (!this.playerOrder.includes(r.player)) this.playerOrder.push(r.player);
        }

        // Initialize per-player display values from persistent cumulative state (do NOT alter the Map)
        for (const p of this.players) {
            this.playerSevens[p] = this.totalSevensRolledByPlayer.get(p) || 0;
            this.playerStreaks[p] = (this.sevenStreakCount.playerColor === p) ? this.sevenStreakCount.streakCount || 0 : 0;
        }

        // Walk through rolls to compute diceTotals only (do not touch cumulative seven Map or streak record)
        for (let i = 0; i < this.rolls.length; i++) {
            const r = this.rolls[i];
            this.diceTotals[r.sum - 2]++;
        }
        // Debug: expose reconstructed seven-state for troubleshooting
        console.debug('DiceTracker: rebuildPredictionStateFromRolls', {
            sevenStreakCount: this.sevenStreakCount,
            totalSevensRolledByPlayer: Array.from(this.totalSevensRolledByPlayer.entries()),
            playerSevens: this.playerSevens,
            players: this.players,
            recentRolls: this.rolls.slice(-10)
        });
    }

    updatePredictionState(roll) {
        // Update diceTotals
        this.diceTotals[roll.sum - 2]++;
        // Track players
        if (!this.players.includes(roll.player)) {
            this.players.push(roll.player);
            this.playerSevens[roll.player] = 0;
            this.playerStreaks[roll.player] = 0;
        }
        // Track 7s
        if (roll.sum === 7) {
            this.playerSevens[roll.player] = (this.playerSevens[roll.player] || 0) + 1;
            // Streak logic: check previous roll (the one before the current latest)
            const prevRoll = (this.rolls.length >= 2) ? this.rolls[this.rolls.length - 2] : null;
            if (prevRoll && prevRoll.player === roll.player && prevRoll.sum === 7) {
                this.playerStreaks[roll.player] = (this.playerStreaks[roll.player] || 0) + 1;
            } else {
                this.playerStreaks[roll.player] = 1; // Start a new streak
            }
        } else {
            // Do not reset streaks on non-7 rolls.
            // Streaks persist until another 7 occurs (handled in rebuildPredictionStateFromRolls and addRoll).
            // Intentionally left blank to preserve seven-streak state across intervening non-7 rolls.
        }
    }

    // --- Weighted Dice Prediction Logic (from balanced_dice.txt) ---
    getWeightedProbabilities() {
    // Compute probabilities from current deckCounts (counts per total 2..12) / 36
    const totalCombinations = 36;
    let probabilities = this.deckCounts.map(c => (c / totalCombinations));

        // --- Parameters matching DiceControllerBalanced ---
        const probabilityReductionForRecentlyRolled = 0.34; // same as TS
        const probabilityReductionForSevenStreaks = 0.4; // same as TS

        // Apply recent roll reduction using this.recentRolls (last up to 5 rolls)
        const recentTotals = this.recentRolls.slice(-5);
        for (let i = 0; i < probabilities.length; i++) {
            const total = i + 2;
            const recentCount = recentTotals.filter(t => t === total).length;
            const multiplier = 1 - (probabilityReductionForRecentlyRolled * recentCount);
            probabilities[i] = Math.max(0, probabilities[i] * multiplier);
        }

    // No global 7 adjustment here; per-player 7 probability is handled separately when predicting per-player chances.

        // Normalize probabilities so they sum to 1
        const totalProb = probabilities.reduce((a,b)=>a+b,0);
        if (totalProb > 0) probabilities = probabilities.map(p => p/totalProb);
        return probabilities;
    }

    predictNextRollWeighted() {
        const probs = this.getWeightedProbabilities();
        let maxIdx = 0;
        for (let i = 1; i < probs.length; i++) {
            if (probs[i] > probs[maxIdx]) maxIdx = i;
        }
        return {
            total: maxIdx + 2,
            percent: (probs[maxIdx] * 100)
        };
    }

    updateDisplay() {
        const contentDiv = this.overlay.querySelector('.dice-tracker-content');
        // Deck counter display
        const cardsLeftHtml = `<div style="margin:6px 0;font-size:12px;color:#fff;">Cards left in deck: <b>${this.cardsLeftInDeck}</b></div>`;
        // Probability table at the top
        const probs = this.getWeightedProbabilities();
        let tableHtml = '<h4 style="margin:8px 0 4px 0;">Roll %</h4>';
        tableHtml += '<table style="width:100%;margin-top:4px;border-collapse:collapse;font-size:12px;">';
        tableHtml += '<tr><th>Total</th><th>%</th></tr>';
        for (let i = 0; i < probs.length; i++) {
            const percent = (probs[i] * 100).toFixed(1);
            const color = this.getColorForPercent(percent);
            tableHtml += `<tr><td>${i+2}</td><td style="background:${color};color:#fff;text-align:center;">${percent}%</td></tr>`;
        }
        tableHtml += '</table>';

    // Compact two-player 7s counter removed; keep placeholder empty
    let player7sScoreHtml = '';

        // 7s by player predicted probability table (using streak and imbalance logic)
        let player7sHtml = '';
        if (this.players.length > 0) {
            player7sHtml = '<h4 style="margin:12px 0 4px 0;">Predicted 7s by Player</h4>';
            player7sHtml += '<table style="width:100%;margin-top:4px;border-collapse:collapse;font-size:12px;">';
            player7sHtml += '<tr><th>Player</th><th>Predicted 7s %</th></tr>';
            // Calculate predicted 7s probability for each player using authoritative cumulative state
            const nPlayers = this.players.length;
            // total sevens across all players from the persistent map
            const totalSevens = Array.from(this.totalSevensRolledByPlayer.values()).reduce((a,b)=>a+b,0);
            let predictedArr = [];
            const displayPlayers2 = (this.playerOrder && this.playerOrder.length > 0) ? this.playerOrder : this.players;
            for (const player of displayPlayers2) {
                // --- Streak adjustment ---
                const streakCount = (this.sevenStreakCount.playerColor === player) ? (this.sevenStreakCount.streakCount || 0) : 0;
                const isStreakForOrAgainstPlayer = (this.sevenStreakCount.playerColor === player) ? -1 : 1;
                const probabilityReductionForSevenStreaks = 0.4; // same as TS
                const streakAdjustment = probabilityReductionForSevenStreaks * streakCount * isStreakForOrAgainstPlayer;

                // --- 7s imbalance adjustment (apply when any 7s have occurred) ---
                let imbalanceAdjustment = 1;
                if (totalSevens > 0) {
                    const sevensPerPlayer = this.totalSevensRolledByPlayer.get(player) || 0;
                    const percentageOfTotalSevens = sevensPerPlayer / totalSevens;
                    const idealPercent = 1 / nPlayers;
                    imbalanceAdjustment = 1 + ((idealPercent - percentageOfTotalSevens) / idealPercent);
                }

                // --- Final predicted multiplier (clamped) ---
                let predicted = imbalanceAdjustment + streakAdjustment;
                if (predicted < 0) predicted = 0;
                if (predicted > 2) predicted = 2;

                // Apply recent-roll smoothing for 7: count occurrences of 7 in last up to 5 rolls
                const recentSevenCount = this.rolls.slice(-5).map(r=>r.sum).filter(s=>s===7).length;
                const recentReduction = 0.34 * recentSevenCount;
                const recentMultiplier = Math.max(0, 1 - recentReduction);

                // Final multiplier includes recent smoothing
                predictedArr.push(predicted * recentMultiplier);
            }
            // Normalize
            const sumPredicted = predictedArr.reduce((a,b)=>a+b,0);
            // Store in instance for next update
            this._player7sPredicted = predictedArr;
                // Debug: show predicted array and seven-state
                console.debug('DiceTracker: predicted7s', {
                    players: this.players,
                    predictedArr,
                    sumPredicted,
                    sevenStreakCount: this.sevenStreakCount,
                    totalSevensRolledByPlayer: Array.from(this.totalSevensRolledByPlayer.entries()),
                    playerSevens: this.playerSevens
                });
            for (let i = 0; i < displayPlayers2.length; i++) {
                const player = displayPlayers2[i];
                const percent = sumPredicted ? ((predictedArr[i]/sumPredicted)*100).toFixed(1) : '0.0';
                const color = this.getColorForPercent(percent);
                // Find the player's color from the last roll with that player
                const playerColor = (this.rolls.find(r => r.player === player) || {}).color || '#fff';
                player7sHtml += `<tr>
                    <td style="color:${playerColor};font-weight:bold;">${player}</td>
                    <td style="background:${color};color:#fff;text-align:center;">${percent}%</td>
                </tr>`;
            }
            player7sHtml += '</table>';
        }

        // Short roll history at the bottom, now showing 5 rolls, no player
        let rollsHtml = '';
        if (this.rolls.length === 0) {
            rollsHtml = '<div class="dice-tracker-empty">No rolls yet...</div>';
        } else {
            rollsHtml = '<h4 style="margin:12px 0 4px 0;">Latest</h4>';
            rollsHtml += '<div style="display:flex;flex-wrap:wrap;gap:4px 8px;">';
            const latestRolls = this.rolls.slice(-5).reverse(); // Get the last 5 rolls, newest first (left-to-right)
            for (const roll of latestRolls) {
                if (roll && roll.dice && roll.dice.length === 2) { // Validate roll structure
                    const total = roll.dice[0] + roll.dice[1];
                    rollsHtml += `<span style="background:#222;color:#fff;padding:2px 8px;border-radius:4px;font-size:13px;">${total}</span>`;
                }
            }
            rollsHtml += '</div>';
        }
        contentDiv.innerHTML = cardsLeftHtml + tableHtml + player7sScoreHtml + player7sHtml + rollsHtml;
    }

    // Render dice prediction table
    renderPredictionTable() {
        const tableDiv = this.overlay.querySelector('#dice-prediction-table');
        if (!tableDiv) return;
        const totalRolls = this.diceTotals.reduce((a, b) => a + b, 0);
        if (totalRolls === 0) {
            tableDiv.innerHTML = '<div style="opacity:0.7;text-align:center;">No prediction data yet</div>';
            return;
        }
        let html = '<table style="width:100%;margin-top:10px;border-collapse:collapse;font-size:12px;">';
        html += '<tr><th>Total</th><th>%</th></tr>';
        for (let i = 0; i < 11; i++) {
            const percent = ((this.diceTotals[i] / totalRolls) * 100).toFixed(1);
            const color = this.getColorForPercent(percent);
            html += `<tr><td>${i+2}</td><td style="background:${color};color:#fff;text-align:center;">${percent}%</td></tr>`;
        }
        html += '</table>';
        tableDiv.innerHTML = html;
    }

    // Render player 7s table
    renderPlayer7sTable() {
        const tableDiv = this.overlay.querySelector('#player-7s-table');
        if (!tableDiv) return;
        if (this.players.length === 0) {
            tableDiv.innerHTML = '<div style="opacity:0.7;text-align:center;">No player 7s data yet</div>';
            return;
        }
        let html = '<table style="width:100%;margin-top:10px;border-collapse:collapse;font-size:12px;">';
        html += '<tr><th>Player</th><th>7s %</th><th>Streak %</th></tr>';
        const totalSevens = Object.values(this.playerSevens).reduce((a,b)=>a+b,0);
        for (const player of this.players) {
            const sevenPercent = totalSevens ? ((this.playerSevens[player]/totalSevens)*100).toFixed(1) : '0.0';
            const streakPercent = this.playerStreaks[player] ? ((this.playerStreaks[player]/(this.playerSevens[player]||1))*100).toFixed(1) : '0.0';
            const color7 = this.getColorForPercent(sevenPercent);
            const colorStreak = this.getColorForPercent(streakPercent);
            html += `<tr><td>${player}</td><td style="background:${color7};color:#fff;text-align:center;">${sevenPercent}%</td><td style="background:${colorStreak};color:#fff;text-align:center;">${streakPercent}%</td></tr>`;
        }
        html += '</table>';
        tableDiv.innerHTML = html;
    }

    // Color scale: red (low) -> yellow -> green -> blue (high)
    getColorForPercent(percent) {
        percent = parseFloat(percent);
        if (percent <= 5) return '#d32f2f'; // red
        if (percent <= 10) return '#fbc02d'; // yellow
        if (percent <= 16.6) return '#388e3c'; // green
        return '#1976d2'; // blue
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        if (this.overlay) {
            this.overlay.remove();
        }
        document.removeEventListener('mousemove', this.handleDrag);
        document.removeEventListener('mouseup', this.handleDragEnd);
    }
}

// Initialize the tracker when the script loads
const diceTracker = new ColonistDiceTracker();

/**
 * Listen for style-related messages from popup.js and apply changes to the overlay.
 */
chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action) {
        const overlay = document.getElementById('dice-tracker-overlay');
        if (!overlay) return;

        switch (message.action) {
            case 'setDarkMode':
                if (message.value) {
                    overlay.classList.add('dark-mode');
                } else {
                    overlay.classList.remove('dark-mode');
                }
                break;

            case 'setOverlayBorder':
                if (message.value) {
                    overlay.style.border = '2px solid #f5f5f5';
                } else {
                    overlay.style.border = 'none';
                }
                break;

            default:
                console.warn('Unknown action:', message.action);
        }
    }
});

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
    diceTracker.destroy();
});