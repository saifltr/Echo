// Enhanced popup script with chrome.tabCapture for complete meeting audio recording

document.addEventListener('DOMContentLoaded', initialize);

let mediaRecorder = null;
let recordedChunks = [];
let tabStream = null;
let micStream = null;
let mixedStream = null;
let isRecording = false;
let recordingStartTime = null;

// Configuration
const BACKEND_URL = 'http://localhost:8000';

// Extension context validation
function checkExtensionContext() {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        throw new Error('Extension context invalidated. Please refresh the page and reload the extension.');
    }
    
    if (!chrome.storage || !chrome.storage.local) {
        throw new Error('Chrome storage API not available. Extension may need to be reloaded.');
    }
    
    if (!chrome.tabCapture) {
        throw new Error('Chrome tabCapture API not available. Check extension permissions.');
    }
}

function initialize() {
    try {
        // Check extension context first
        checkExtensionContext();
        
        // Get DOM elements
        const recordBtn = document.getElementById('recordBtn');
        const stopBtn = document.getElementById('stopBtn');
        const testConnectionBtn = document.getElementById('testConnectionBtn');
        
        if (!recordBtn || !stopBtn || !testConnectionBtn) {
            throw new Error('Required DOM elements not found');
        }
        
        // Add event listeners
        recordBtn.addEventListener('click', startRecording);
        stopBtn.addEventListener('click', stopRecording);
        testConnectionBtn.addEventListener('click', testBackendConnection);
        
        // Update initial status
        updateStatus();
        
        // Load recent recordings
        loadRecentRecordings();
        
        // Check if we're on a Meet page
        checkMeetPage();
        
        // Periodic status updates
        setInterval(updateRecordingTime, 1000);
        
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Extension initialization failed: ' + error.message);
    }
}

async function checkMeetPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab.url.includes('meet.google.com')) {
            showError('Please navigate to a Google Meet call to use this extension');
            disableControls();
        } else {
            updateStatus('Ready to record meeting audio');
        }
    } catch (error) {
        console.error('Error checking current page:', error);
    }
}

function disableControls() {
    const recordBtn = document.getElementById('recordBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    recordBtn.disabled = true;
    recordBtn.classList.add('disabled');
    stopBtn.disabled = true;
    stopBtn.classList.add('disabled');
}

async function startRecording() {
    try {
        // Get current active tab to ensure we're on Meet
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab.url.includes('meet.google.com')) {
            showError('Please navigate to a Google Meet call first');
            return;
        }
        
        const notifyParticipants = document.getElementById('notifyParticipants').checked;
        const mixMicrophone = document.getElementById('mixMicrophone').checked;
        
        // Show consent confirmation
        if (notifyParticipants) {
            const consent = confirm(
                'This will notify all meeting participants that recording is starting. ' +
                'Do you have permission to record this meeting?'
            );
            if (!consent) {
                return;
            }
        }
        
        updateStatus('Starting recording...', 'processing');
        
        // Notify participants in the meeting if enabled
        if (notifyParticipants) {
            await chrome.tabs.sendMessage(tab.id, { 
                type: 'SHOW_RECORDING_NOTIFICATION',
                message: 'Recording started by meeting participant'
            }).catch(() => {
                console.log('Could not send notification to meeting (content script may not be loaded)');
            });
        }
        
        // Start tab capture using chrome.tabCapture API
        await startTabCapture(mixMicrophone);
        
    } catch (error) {
        console.error('Error starting recording:', error);
        showError('Error starting recording: ' + error.message);
        updateStatus('Ready to record meeting audio', 'idle');
    }
}

async function startTabCapture(includeMicrophone) {
    return new Promise((resolve, reject) => {
        // Use chrome.tabCapture to get tab audio (this captures ALL meeting audio)
        chrome.tabCapture.capture({ 
            audio: true, 
            video: false 
        }, async (stream) => {
            if (!stream) {
                const error = chrome.runtime.lastError?.message || 'Failed to capture tab audio';
                console.error('tabCapture failed:', error);
                reject(new Error(error));
                return;
            }
            
            try {
                tabStream = stream;
                console.log('Tab audio captured successfully');
                updateStatus('Tab audio captured', 'processing');
                
                // Optionally mix with microphone
                if (includeMicrophone) {
                    try {
                        updateStatus('Requesting microphone access...', 'processing');
                        micStream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true
                            }
                        });
                        console.log('Microphone captured successfully');
                        updateStatus('Microphone captured', 'processing');
                    } catch (micError) {
                        console.warn('Microphone access denied:', micError);
                        updateStatus('Microphone denied - recording tab audio only', 'processing');
                    }
                }
                
                // Mix streams if both are available
                if (micStream && tabStream) {
                    mixedStream = await mixAudioStreams(tabStream, micStream);
                    console.log('Audio streams mixed successfully');
                } else {
                    mixedStream = tabStream;
                }
                
                // Start recording
                await startMediaRecorder(mixedStream);
                resolve();
                
            } catch (error) {
                console.error('Error processing streams:', error);
                reject(error);
            }
        });
    });
}

async function mixAudioStreams(tabStream, micStream) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const destination = audioContext.createMediaStreamDestination();
        
        // Connect tab audio
        const tabSource = audioContext.createMediaStreamSource(tabStream);
        const tabGain = audioContext.createGain();
        tabGain.gain.value = 1.0; // Full volume for tab audio
        tabSource.connect(tabGain);
        tabGain.connect(destination);
        
        // Connect microphone with lower volume to prevent echo
        const micSource = audioContext.createMediaStreamSource(micStream);
        const micGain = audioContext.createGain();
        micGain.gain.value = 0.7; // Slightly lower volume for mic
        micSource.connect(micGain);
        micGain.connect(destination);
        
        return destination.stream;
    } catch (error) {
        console.error('Error mixing audio streams:', error);
        // Fallback to tab audio only
        return tabStream;
    }
}

async function startMediaRecorder(stream) {
    try {
        recordedChunks = [];
        
        // Choose the best available audio format
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/mp4';
        }
        
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            audioBitsPerSecond: 128000 // High quality audio
        });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
                console.log('Audio chunk recorded:', event.data.size, 'bytes');
            }
        };
        
        mediaRecorder.onstop = handleRecordingComplete;
        
        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            showError('Recording error: ' + event.error.message);
        };
        
        // Start recording with chunks every 1 second for better data handling
        mediaRecorder.start(1000);
        
        isRecording = true;
        recordingStartTime = Date.now();
        
        // Update UI
        const recordBtn = document.getElementById('recordBtn');
        const stopBtn = document.getElementById('stopBtn');
        
        recordBtn.disabled = true;
        recordBtn.classList.add('disabled');
        stopBtn.disabled = false;
        stopBtn.classList.remove('disabled');
        
        updateStatus('🔴 Recording in progress...', 'recording');
        
        console.log('MediaRecorder started with format:', mimeType);
        
    } catch (error) {
        console.error('Error starting MediaRecorder:', error);
        throw error;
    }
}

async function stopRecording() {
    try {
        updateStatus('Stopping recording...', 'processing');
        
        // Stop media recorder
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        
        // Stop all tracks
        if (tabStream) {
            tabStream.getTracks().forEach(track => {
                track.stop();
                console.log('Stopped tab track:', track.kind);
            });
            tabStream = null;
        }
        
        if (micStream) {
            micStream.getTracks().forEach(track => {
                track.stop();
                console.log('Stopped mic track:', track.kind);
            });
            micStream = null;
        }
        
        isRecording = false;
        recordingStartTime = null;
        
        // Update UI
        const recordBtn = document.getElementById('recordBtn');
        const stopBtn = document.getElementById('stopBtn');
        
        recordBtn.disabled = false;
        recordBtn.classList.remove('disabled');
        stopBtn.disabled = true;
        stopBtn.classList.add('disabled');
        
        // Notify participants that recording stopped
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url.includes('meet.google.com')) {
            await chrome.tabs.sendMessage(tab.id, { 
                type: 'HIDE_RECORDING_NOTIFICATION'
            }).catch(() => {
                console.log('Could not send stop notification to meeting');
            });
        }
        
    } catch (error) {
        console.error('Error stopping recording:', error);
        showError('Error stopping recording: ' + error.message);
    }
}

async function handleRecordingComplete() {
    try {
        if (recordedChunks.length === 0) {
            showError('No audio data was recorded');
            updateStatus('Ready to record meeting audio', 'idle');
            return;
        }
        
        updateStatus('Processing recording...', 'processing');
        
        console.log('Recording complete:', recordedChunks.length, 'chunks');
        
        // Calculate total size
        const totalSize = recordedChunks.reduce((size, chunk) => size + chunk.size, 0);
        console.log('Total recording size:', totalSize, 'bytes');
        
        // Create blob from chunks
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        
        // Generate filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `meet-recording-${timestamp}.webm`;
        
        // Save to storage
        await saveRecordingToStorage(blob, filename, totalSize);
        
        updateStatus('Recording saved successfully!', 'idle');
        
        // Auto-transcribe if enabled
        const autoTranscribe = document.getElementById('autoTranscribe').checked;
        if (autoTranscribe) {
            setTimeout(() => {
                transcribeLatestRecording();
            }, 1000);
        }
        
        // Refresh recordings list
        setTimeout(loadRecentRecordings, 500);
        
    } catch (error) {
        console.error('Error handling recording completion:', error);
        showError('Error processing recording: ' + error.message);
        updateStatus('Ready to record meeting audio', 'idle');
    }
}

async function saveRecordingToStorage(blob, filename, size) {
    try {
        // Convert blob to base64 for storage
        const base64Data = await blobToBase64(blob);
        
        // Get existing recordings
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        
        const recordingData = {
            id: Date.now().toString(),
            filename,
            timestamp: new Date().toISOString(),
            size,
            type: blob.type,
            data: base64Data,
            transcriptionStatus: 'pending'
        };
        
        recordings.unshift(recordingData); // Add to beginning
        
        // Keep only last 5 recordings to manage storage
        if (recordings.length > 5) {
            recordings.splice(5);
        }
        
        await chrome.storage.local.set({ recordings });
        console.log('Recording saved to storage:', filename);
        
    } catch (error) {
        console.error('Error saving recording to storage:', error);
        throw error;
    }
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function transcribeLatestRecording() {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        
        if (recordings.length === 0) {
            return;
        }
        
        const latestRecording = recordings[0];
        await transcribeRecording(latestRecording.id);
        
    } catch (error) {
        console.error('Error starting auto-transcription:', error);
    }
}

async function transcribeRecording(recordingId) {
    try {
        updateStatus('Starting transcription...', 'processing');
        
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        
        if (!recording) {
            showError('Recording not found');
            return;
        }
        
        // Update transcription status
        recording.transcriptionStatus = 'transcribing';
        await chrome.storage.local.set({ recordings });
        loadRecentRecordings();
        
        // Convert base64 back to blob
        const binaryString = atob(recording.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: recording.type });
        
        // Send to backend
        const formData = new FormData();
        formData.append('audio_file', blob, recording.filename);
        
        const response = await fetch(`${BACKEND_URL}/transcribe`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Transcription failed: ${response.status}`);
        }
        
        const transcriptionResult = await response.json();
        
        // Update recording with transcription
        recording.transcriptionStatus = 'completed';
        recording.transcriptionText = transcriptionResult.text;
        recording.transcriptionLength = transcriptionResult.length;
        
        await chrome.storage.local.set({ recordings });
        
        updateStatus('Transcription completed!', 'idle');
        loadRecentRecordings();
        
    } catch (error) {
        console.error('Error transcribing recording:', error);
        
        // Update status to failed
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        if (recording) {
            recording.transcriptionStatus = 'failed';
            recording.transcriptionError = error.message;
            await chrome.storage.local.set({ recordings });
            loadRecentRecordings();
        }
        
        showError('Transcription failed: ' + error.message);
        updateStatus('Ready to record meeting audio', 'idle');
    }
}

async function testBackendConnection() {
    try {
        updateStatus('Testing backend connection...', 'processing');
        
        const response = await fetch(`${BACKEND_URL}/health`, {
            method: 'GET'
        });
        
        if (response.ok) {
            const data = await response.json();
            updateStatus('Backend connection successful!', 'idle');
            console.log('Backend health check:', data);
        } else {
            throw new Error(`Backend returned ${response.status}`);
        }
        
    } catch (error) {
        console.error('Backend connection test failed:', error);
        showError('Backend connection failed. Make sure the server is running on ' + BACKEND_URL);
        updateStatus('Ready to record meeting audio', 'idle');
    }
}

async function loadRecentRecordings() {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        
        const recordingsList = document.getElementById('recordingsList');
        
        if (recordings.length === 0) {
            recordingsList.innerHTML = '<div style="color: rgba(255,255,255,0.7); font-style: italic;">No recordings yet</div>';
            return;
        }
        
        recordingsList.innerHTML = recordings.map(recording => {
            const date = new Date(recording.timestamp);
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString();
            const sizeStr = formatFileSize(recording.size);
            
            let transcriptionInfo = '';
            let transcriptionActions = '';
            
            switch (recording.transcriptionStatus) {
                case 'pending':
                    transcriptionInfo = '<div style="color: #FFC107;">Transcription pending</div>';
                    transcriptionActions = `<button class="mini-btn transcribe-btn" onclick="transcribeRecording('${recording.id}')">Transcribe</button>`;
                    break;
                case 'transcribing':
                    transcriptionInfo = '<div style="color: #2196F3;">Transcribing...</div>';
                    break;
                case 'completed':
                    transcriptionInfo = `<div style="color: #4CAF50;">Transcription ready (${recording.transcriptionLength} chars)</div>`;
                    transcriptionActions = `
                        <button class="mini-btn download-btn" onclick="downloadTranscription('${recording.id}')">Download Text</button>
                        <button class="mini-btn transcribe-btn" onclick="viewTranscription('${recording.id}')">View</button>
                    `;
                    break;
                case 'failed':
                    transcriptionInfo = '<div style="color: #f44336;">Transcription failed</div>';
                    transcriptionActions = `<button class="mini-btn transcribe-btn" onclick="transcribeRecording('${recording.id}')">Retry</button>`;
                    break;
            }
            
            return `
                <div class="recording-item">
                    <div class="filename">${recording.filename}</div>
                    <div class="details">${dateStr} ${timeStr} • ${sizeStr}</div>
                    ${transcriptionInfo}
                    <div class="recording-actions">
                        <button class="mini-btn download-btn" onclick="downloadRecording('${recording.id}')">Download Audio</button>
                        ${transcriptionActions}
                        <button class="mini-btn delete-btn" onclick="deleteRecording('${recording.id}')">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading recordings:', error);
        document.getElementById('recordingsList').innerHTML = '<div style="color: #f44336;">Error loading recordings</div>';
    }
}

// Global functions for button clicks
window.downloadRecording = async function(recordingId) {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        
        if (!recording) {
            showError('Recording not found');
            return;
        }
        
        // Convert base64 back to blob
        const binaryString = atob(recording.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: recording.type });
        
        // Create download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = recording.filename;
        a.click();
        URL.revokeObjectURL(url);
        
        showSuccess('Download started: ' + recording.filename);
        
    } catch (error) {
        console.error('Error downloading recording:', error);
        showError('Error downloading recording: ' + error.message);
    }
};

window.transcribeRecording = transcribeRecording;

window.downloadTranscription = async function(recordingId) {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        
        if (!recording || !recording.transcriptionText) {
            showError('Transcription not found');
            return;
        }
        
        // Create text file
        const blob = new Blob([recording.transcriptionText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const baseName = recording.filename.replace(/\.[^/.]+$/, "");
        a.href = url;
        a.download = `${baseName}-transcription.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        showSuccess('Transcription downloaded');
        
    } catch (error) {
        console.error('Error downloading transcription:', error);
        showError('Error downloading transcription: ' + error.message);
    }
};

window.viewTranscription = async function(recordingId) {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        
        if (!recording || !recording.transcriptionText) {
            showError('Transcription not found');
            return;
        }
        
        // Create modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: #1a1a2e;
            color: white;
            border-radius: 8px;
            padding: 20px;
            max-width: 500px;
            max-height: 400px;
            overflow-y: auto;
            position: relative;
        `;
        
        modalContent.innerHTML = `
            <h3 style="margin-top: 0; margin-bottom: 15px; color: #667eea;">Transcription: ${recording.filename}</h3>
            <div style="border: 1px solid #333; padding: 15px; border-radius: 4px; background: #16213e; line-height: 1.5; font-size: 14px; max-height: 250px; overflow-y: auto;">
                ${recording.transcriptionText}
            </div>
            <div style="margin-top: 15px; text-align: right;">
                <button id="closeModal" style="
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-right: 10px;
                ">Close</button>
                <button id="copyTranscription" style="
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                ">Copy Text</button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // Event listeners
        document.getElementById('closeModal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        document.getElementById('copyTranscription').addEventListener('click', () => {
            navigator.clipboard.writeText(recording.transcriptionText).then(() => {
                showSuccess('Transcription copied to clipboard');
            }).catch(() => {
                showError('Failed to copy transcription');
            });
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
        
    } catch (error) {
        console.error('Error viewing transcription:', error);
        showError('Error viewing transcription: ' + error.message);
    }
};

window.deleteRecording = async function(recordingId) {
    if (!confirm('Are you sure you want to delete this recording and its transcription?')) {
        return;
    }
    
    try {
        const result = await chrome.storage.local.get(['recordings']);
        let recordings = result.recordings || [];
        
        recordings = recordings.filter(r => r.id !== recordingId);
        await chrome.storage.local.set({ recordings });
        
        loadRecentRecordings();
        showSuccess('Recording deleted successfully');
        
    } catch (error) {
        console.error('Error deleting recording:', error);
        showError('Error deleting recording: ' + error.message);
    }
};

function updateStatus(message, type = 'idle') {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

function updateRecordingTime() {
    if (isRecording && recordingStartTime) {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        updateStatus(`🔴 Recording... ${timeStr}`, 'recording');
    }
}

function showError(message) {
    console.error('Popup error:', message);
    updateStatus(message, 'idle');
    
    // Create temporary error notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #f44336;
        color: white;
        padding: 10px;
        border-radius: 4px;
        z-index: 11000;
        max-width: 250px;
        font-size: 12px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.parentElement.removeChild(notification);
        }
    }, 4000);
}

function showSuccess(message) {
    console.log('Popup success:', message);
    
    // Create temporary success notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #4CAF50;
        color: white;
        padding: 10px;
        border-radius: 4px;
        z-index: 11000;
        max-width: 250px;
        font-size: 12px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.parentElement.removeChild(notification);
        }
    }, 3000);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.recordings) {
        loadRecentRecordings();
    }
});

// Add extension reload detection
document.addEventListener('DOMContentLoaded', () => {
    // Check if extension was recently reloaded
    const lastReloadCheck = sessionStorage.getItem('extensionReloadCheck');
    const now = Date.now();
    
    if (!lastReloadCheck || (now - parseInt(lastReloadCheck)) > 60000) {
        sessionStorage.setItem('extensionReloadCheck', now.toString());
        
        // Quick validation of chrome APIs
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
            showExtensionReloadError();
            return;
        }
    }
    
    initialize();
});

function showExtensionReloadError() {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        statusDiv.innerHTML = `
            <div style="color: #f44336; text-align: center; padding: 10px;">
                <strong>Extension Error</strong><br>
                Please refresh this page and try again.<br>
                <small>If the problem persists, reload the extension from chrome://extensions/</small>
            </div>
        `;
    }
    
    // Disable all buttons
    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('disabled');
    });
}