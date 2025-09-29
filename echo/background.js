// Enhanced background service worker for Meet Audio Recorder Pro

// Configuration
const BACKEND_URL = 'http://localhost:8000';

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('Meet Audio Recorder Pro extension installed');
    
    // Initialize storage if needed
    chrome.storage.local.get(['recordings']).then(result => {
        if (!result.recordings) {
            chrome.storage.local.set({ recordings: [] });
        }
    });
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message.type);
    
    switch (message.type) {
        case 'NOTIFY_RECORDING_START':
            notifyAllMeetTabs(message.notificationMessage);
            sendResponse({ success: true });
            break;
            
        case 'NOTIFY_RECORDING_STOP':
            hideNotificationAllMeetTabs();
            sendResponse({ success: true });
            break;
            
        case 'TRANSCRIBE_AUDIO':
            transcribeAudioInBackground(message.audioData, message.filename)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response
            
        case 'CHECK_BACKEND_STATUS':
            checkBackendHealth()
                .then(status => sendResponse({ success: true, status }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response
    }
});

// Notify all Google Meet tabs about recording status
async function notifyAllMeetTabs(message = 'This meeting is being recorded') {
    try {
        const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
        
        const notifications = tabs.map(tab => 
            chrome.tabs.sendMessage(tab.id, { 
                type: 'SHOW_RECORDING_NOTIFICATION',
                message: message
            }).catch(error => {
                console.log(`Could not notify tab ${tab.id}:`, error.message);
                return null;
            })
        );
        
        await Promise.allSettled(notifications);
        console.log(`Recording notification sent to ${tabs.length} Meet tab(s)`);
        
    } catch (error) {
        console.error('Error notifying Meet tabs:', error);
    }
}

// Hide recording notifications from all Meet tabs
async function hideNotificationAllMeetTabs() {
    try {
        const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
        
        const hideNotifications = tabs.map(tab => 
            chrome.tabs.sendMessage(tab.id, { 
                type: 'HIDE_RECORDING_NOTIFICATION'
            }).catch(error => {
                console.log(`Could not hide notification on tab ${tab.id}:`, error.message);
                return null;
            })
        );
        
        await Promise.allSettled(hideNotifications);
        console.log(`Recording notification hidden from ${tabs.length} Meet tab(s)`);
        
    } catch (error) {
        console.error('Error hiding notifications from Meet tabs:', error);
    }
}

// Transcribe audio using the backend service
async function transcribeAudioInBackground(audioData, filename) {
    try {
        console.log('Starting background transcription for:', filename);
        
        // Convert base64 to blob
        const binaryString = atob(audioData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/webm' });
        
        // Create FormData
        const formData = new FormData();
        formData.append('audio_file', blob, filename);
        
        // Send to backend
        const response = await fetch(`${BACKEND_URL}/transcribe`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Background transcription completed successfully');
        
        return {
            transcriptionId: result.transcription_id,
            text: result.text,
            length: result.length,
            createdAt: result.created_at
        };
        
    } catch (error) {
        console.error('Background transcription error:', error);
        throw error;
    }
}

// Check backend health status
async function checkBackendHealth() {
    try {
        const response = await fetch(`${BACKEND_URL}/health`, {
            method: 'GET',
            timeout: 5000
        });
        
        if (!response.ok) {
            throw new Error(`Backend health check failed: ${response.status}`);
        }
        
        const healthData = await response.json();
        return {
            status: healthData.status,
            whisperAvailable: healthData.whisper_available,
            storedTranscriptions: healthData.stored_transcriptions,
            timestamp: healthData.timestamp
        };
        
    } catch (error) {
        console.error('Backend health check failed:', error);
        throw error;
    }
}

// Handle tab updates to detect when users navigate away from Meet
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // If user navigates away from Meet, stop any ongoing recordings
    if (changeInfo.url && !changeInfo.url.includes('meet.google.com')) {
        chrome.tabs.sendMessage(tabId, { 
            type: 'NAVIGATION_AWAY_FROM_MEET'
        }).catch(() => {
            // Ignore errors - tab might not have our content script
        });
    }
});

// Handle extension context menu (if needed in the future)
chrome.runtime.onStartup.addListener(() => {
    console.log('Meet Audio Recorder Pro extension started');
});

// Handle extension suspend/resume
chrome.runtime.onSuspend.addListener(() => {
    console.log('Meet Audio Recorder Pro extension suspending');
    // Clean up any ongoing operations
});

// Periodic cleanup of old recordings (runs every hour)
chrome.alarms.create('cleanupRecordings', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cleanupRecordings') {
        cleanupOldRecordings();
    }
});

// Clean up recordings older than 7 days
async function cleanupOldRecordings() {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const filteredRecordings = recordings.filter(recording => {
            const recordingDate = new Date(recording.timestamp);
            return recordingDate > sevenDaysAgo;
        });
        
        if (filteredRecordings.length < recordings.length) {
            await chrome.storage.local.set({ recordings: filteredRecordings });
            console.log(`Cleaned up ${recordings.length - filteredRecordings.length} old recording(s)`);
        }
        
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Handle storage quota exceeded
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        // Monitor storage usage
        chrome.storage.local.getBytesInUse().then(bytesInUse => {
            const quota = chrome.storage.local.QUOTA_BYTES;
            const usagePercent = (bytesInUse / quota) * 100;
            
            if (usagePercent > 80) {
                console.warn(`Storage usage high: ${usagePercent.toFixed(1)}%`);
                // Trigger aggressive cleanup
                cleanupOldRecordings();
            }
        });
    }
});

// Debug function for troubleshooting
async function debugExtensionState() {
    try {
        console.log('=== EXTENSION DEBUG INFO ===');
        
        // Check storage
        const storageResult = await chrome.storage.local.get(['recordings']);
        const recordings = storageResult.recordings || [];
        console.log(`Stored recordings: ${recordings.length}`);
        
        // Check active Meet tabs
        const meetTabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
        console.log(`Active Meet tabs: ${meetTabs.length}`);
        
        // Check backend status
        try {
            const healthStatus = await checkBackendHealth();
            console.log('Backend status:', healthStatus);
        } catch (error) {
            console.log('Backend not available:', error.message);
        }
        
        // Check storage usage
        const bytesInUse = await chrome.storage.local.getBytesInUse();
        const quota = chrome.storage.local.QUOTA_BYTES;
        console.log(`Storage usage: ${(bytesInUse / quota * 100).toFixed(1)}% (${bytesInUse}/${quota} bytes)`);
        
        console.log('=== END DEBUG INFO ===');
        
    } catch (error) {
        console.error('Error during debug:', error);
    }
}

// Make debug function available globally for testing
globalThis.debugExtensionState = debugExtensionState;