// Enhanced content script with participant notifications

let isInMeeting = false;
let recordingNotification = null;

// Initialize when page loads
initialize();

function initialize() {
    console.log('Meet Audio Recorder Pro: Content script loaded');
    
    // Check if we're in a meeting
    detectMeetingStatus();
    
    // Monitor for meeting status changes
    observeMeetingChanges();
}

function detectMeetingStatus() {
    // Check various indicators that we're in an active meeting
    const meetingIndicators = [
        '[data-meeting-title]',
        '[data-self-name]',
        '[jsname="BOHaEe"]', // Meet's microphone button
        '[data-tooltip*="microphone"]',
        '[aria-label*="microphone"]',
        '[data-is-muted]',
        '.google-material-icons[aria-label*="microphone"]',
        '[data-tooltip*="Turn off microphone"]',
        '[data-tooltip*="Turn on microphone"]',
        '[data-participant-id]',
        '.uArJ5e.Y5sE8d', // Meet controls container
        '[jsname="s2Vtzd"]', // Another Meet control selector
        '[data-call-started]',
        '.VfPpkd-Bz112c-LgbsSe' // Meet UI elements
    ];
    
    const inMeeting = meetingIndicators.some(selector => 
        document.querySelector(selector) !== null
    );
    
    if (inMeeting !== isInMeeting) {
        isInMeeting = inMeeting;
        console.log('Meeting status changed:', isInMeeting ? 'In meeting' : 'Not in meeting');
        
        if (isInMeeting) {
            onMeetingJoined();
        } else {
            onMeetingLeft();
        }
    }
}

function observeMeetingChanges() {
    // Use MutationObserver to detect changes in the Meet interface
    const observer = new MutationObserver(() => {
        detectMeetingStatus();
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function onMeetingJoined() {
    console.log('Meeting joined - recording features available');
}

function onMeetingLeft() {
    console.log('Meeting left');
    hideRecordingNotification();
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received message:', message.type);
    
    switch (message.type) {
        case 'SHOW_RECORDING_NOTIFICATION':
            showRecordingNotification(message.message);
            sendResponse({ success: true });
            break;
            
        case 'HIDE_RECORDING_NOTIFICATION':
            hideRecordingNotification();
            sendResponse({ success: true });
            break;
            
        case 'PING':
            sendResponse({ success: true, inMeeting: isInMeeting });
            break;
    }
});

function showRecordingNotification(message = 'This meeting is being recorded') {
    // Remove existing notification if present
    hideRecordingNotification();
    
    // Create prominent recording notification
    recordingNotification = document.createElement('div');
    recordingNotification.id = 'meet-recording-notification';
    recordingNotification.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #ff4444, #cc0000);
        color: white;
        padding: 15px 20px;
        text-align: center;
        font-family: 'Google Sans', Arial, sans-serif;
        font-size: 16px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(255, 68, 68, 0.4);
        border-bottom: 3px solid #aa0000;
        animation: slideDown 0.5s ease-out;
    `;
    
    // Add animation keyframes
    if (!document.querySelector('#recording-notification-styles')) {
        const styles = document.createElement('style');
        styles.id = 'recording-notification-styles';
        styles.textContent = `
            @keyframes slideDown {
                from {
                    transform: translateY(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            
            @keyframes pulse {
                0%, 100% {
                    opacity: 1;
                }
                50% {
                    opacity: 0.7;
                }
            }
            
            .recording-indicator {
                animation: pulse 2s infinite;
            }
        `;
        document.head.appendChild(styles);
    }
    
    recordingNotification.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
            <div class="recording-indicator" style="
                width: 12px;
                height: 12px;
                background: white;
                border-radius: 50%;
                display: inline-block;
            "></div>
            <span style="text-shadow: 0 1px 2px rgba(0,0,0,0.3);">
                🔴 ${message}
            </span>
            <div class="recording-indicator" style="
                width: 12px;
                height: 12px;
                background: white;
                border-radius: 50%;
                display: inline-block;
            "></div>
        </div>
        <div style="
            font-size: 12px;
            margin-top: 5px;
            opacity: 0.9;
            font-weight: 400;
        ">
            All participants have been notified. Audio is being captured for transcription.
        </div>
    `;
    
    document.body.appendChild(recordingNotification);
    
    // Also show a temporary banner in the meet interface itself
    showInMeetBanner();
    
    console.log('Recording notification displayed to all participants');
}

function showInMeetBanner() {
    // Try to find a suitable location in the Meet interface for an additional banner
    const meetContainer = document.querySelector('[data-meeting-title]') || 
                         document.querySelector('.uArJ5e.Y5sE8d') ||
                         document.querySelector('[jsname="s2Vtzd"]') ||
                         document.body;
    
    const inMeetBanner = document.createElement('div');
    inMeetBanner.id = 'meet-recording-banner';
    inMeetBanner.style.cssText = `
        background: rgba(255, 68, 68, 0.95);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        font-family: 'Google Sans', Arial, sans-serif;
        font-size: 14px;
        font-weight: 500;
        margin: 8px;
        text-align: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        border: 1px solid rgba(255, 255, 255, 0.2);
        position: relative;
        z-index: 9999;
    `;
    
    inMeetBanner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span style="font-size: 12px;">🔴</span>
            <span>Recording Active</span>
        </div>
    `;
    
    // Insert at the beginning of the container
    if (meetContainer.firstChild) {
        meetContainer.insertBefore(inMeetBanner, meetContainer.firstChild);
    } else {
        meetContainer.appendChild(inMeetBanner);
    }
    
    // Auto-remove after 10 seconds to avoid clutter
    setTimeout(() => {
        if (inMeetBanner && inMeetBanner.parentElement) {
            inMeetBanner.parentElement.removeChild(inMeetBanner);
        }
    }, 10000);
}

function hideRecordingNotification() {
    if (recordingNotification && recordingNotification.parentElement) {
        // Add fade out animation
        recordingNotification.style.animation = 'slideUp 0.3s ease-in forwards';
        
        // Add slideUp animation if not already present
        const styles = document.querySelector('#recording-notification-styles');
        if (styles && !styles.textContent.includes('slideUp')) {
            styles.textContent += `
                @keyframes slideUp {
                    from {
                        transform: translateY(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateY(-100%);
                        opacity: 0;
                    }
                }
            `;
        }
        
        setTimeout(() => {
            if (recordingNotification && recordingNotification.parentElement) {
                recordingNotification.parentElement.removeChild(recordingNotification);
                recordingNotification = null;
            }
        }, 300);
    }
    
    // Also remove any in-meet banners
    const inMeetBanner = document.getElementById('meet-recording-banner');
    if (inMeetBanner && inMeetBanner.parentElement) {
        inMeetBanner.parentElement.removeChild(inMeetBanner);
    }
    
    console.log('Recording notification hidden');
}

// Show a consent dialog when the extension is first used
function showConsentDialog() {
    const consentDialog = document.createElement('div');
    consentDialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 11000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Google Sans', Arial, sans-serif;
    `;
    
    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 500px;
        text-align: center;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    `;
    
    dialogContent.innerHTML = `
        <h2 style="color: #333; margin-bottom: 20px;">Recording Consent Required</h2>
        <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
            This extension will record audio from this Google Meet session. 
            By continuing, you confirm that:
        </p>
        <ul style="text-align: left; color: #666; margin-bottom: 25px; line-height: 1.6;">
            <li>You have permission to record this meeting</li>
            <li>All participants will be notified of the recording</li>
            <li>You comply with local recording laws and regulations</li>
            <li>The recording is for legitimate business or educational purposes</li>
        </ul>
        <div style="display: flex; gap: 15px; justify-content: center;">
            <button id="consentAccept" style="
                background: #4CAF50;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
            ">I Understand & Consent</button>
            <button id="consentDecline" style="
                background: #f44336;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
            ">Cancel</button>
        </div>
    `;
    
    consentDialog.appendChild(dialogContent);
    document.body.appendChild(consentDialog);
    
    return new Promise((resolve) => {
        document.getElementById('consentAccept').addEventListener('click', () => {
            document.body.removeChild(consentDialog);
            resolve(true);
        });
        
        document.getElementById('consentDecline').addEventListener('click', () => {
            document.body.removeChild(consentDialog);
            resolve(false);
        });
    });
}

// Expose consent dialog for use by popup
window.showMeetRecordingConsent = showConsentDialog;