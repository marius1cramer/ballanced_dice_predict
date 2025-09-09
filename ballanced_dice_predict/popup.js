/**
 * Popup script for Colonist.io Dice Tracker
 * Handles the extension popup interface
 */


document.addEventListener('DOMContentLoaded', function() {
    setupDarkMode();
});

function setupDarkMode() {
    const toggle = document.getElementById('dark-mode-toggle');

    // Load from localStorage
    if (localStorage.getItem('diceSolverDarkMode') === 'true') {
        toggle.checked = true;
        sendStyleToContent('setDarkMode', true);
    }

    toggle.addEventListener('change', async () => {
        if (toggle.checked) {
            localStorage.setItem('diceSolverDarkMode', 'true');
            await sendStyleToContent('setDarkMode', true);
        } else {
            localStorage.setItem('diceSolverDarkMode', 'false');
            await sendStyleToContent('setDarkMode', false);
        }
    });
    // Also send current state on load
    sendStyleToContent('setDarkMode', toggle.checked);
}

async function sendStyleToContent(action, value) {
    if (!chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs && tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action, value });
        }
    });
}