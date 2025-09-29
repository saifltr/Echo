// Popup script for the Meet Audio Recorder extension

document.addEventListener('DOMContentLoaded', initialize);

let isRecording = false;

function initialize() {
    // Get DOM elements
    const recordBtn = document.getElementById('recordBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDiv = document.getElementById('status');
    
    // Add event listeners
    recordBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
    
    // Update initial status
    updateStatus();
    
    // Load recent recordings
    loadRecentRecordings();
    
    // Check if we're on a Meet page
    checkMeetPage();
}

async function checkMeetPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab.url.includes('meet.google.com')) {
            showError('Please navigate to a Google Meet call to use this extension');
            disableControls();
        } else {
            // Check if tab is in a meeting
            try {
                await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
            } catch (error) {
                console.log('Content script not loaded, this is normal on first load');
            }
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
        
        console.log('Starting recording for tab:', tab.id);
        
        // Start recording
        const response = await chrome.runtime.sendMessage({ 
            type: 'START_RECORDING',
            tabId: tab.id
        });
        
        if (response && response.success) {
            console.log('Recording start request sent successfully');
            // Status will be updated by the periodic check
        } else {
            showError('Failed to start recording');
        }
    } catch (error) {
        console.error('Error starting recording:', error);
        showError('Error starting recording: ' + error.message);
    }
}

async function stopRecording() {
    try {
        console.log('Stopping recording...');
        const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        
        if (response && response.success) {
            console.log('Recording stop request sent successfully');
            // Status will be updated by the periodic check
            
            // Refresh recordings list after a delay to allow saving
            setTimeout(loadRecentRecordings, 2000);
        } else {
            showError('Failed to stop recording');
        }
    } catch (error) {
        console.error('Error stopping recording:', error);
        showError('Error stopping recording: ' + error.message);
    }
}

async function updateStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' });
        
        if (response !== undefined) {
            isRecording = response.isRecording;
            
            const statusDiv = document.getElementById('status');
            const recordBtn = document.getElementById('recordBtn');
            const stopBtn = document.getElementById('stopBtn');
            
            if (isRecording) {
                statusDiv.textContent = 'Recording audio in progress...';
                statusDiv.className = 'status recording';
                recordBtn.disabled = true;
                recordBtn.classList.add('disabled');
                stopBtn.disabled = false;
                stopBtn.classList.remove('disabled');
            } else {
                statusDiv.textContent = 'Ready to record audio';
                statusDiv.className = 'status idle';
                recordBtn.disabled = false;
                recordBtn.classList.remove('disabled');
                stopBtn.disabled = true;
                stopBtn.classList.add('disabled');
            }
        }
    } catch (error) {
        console.error('Error updating status:', error);
        // Don't show error to user as this might be called frequently
    }
}

async function loadRecentRecordings() {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        
        const recordingsList = document.getElementById('recordingsList');
        
        if (recordings.length === 0) {
            recordingsList.innerHTML = '<div style="color: #666; font-style: italic;">No recordings yet</div>';
            return;
        }
        
        // Sort by timestamp (newest first)
        recordings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        recordingsList.innerHTML = recordings.slice(0, 5).map(recording => {
            const date = new Date(recording.timestamp);
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString();
            const sizeStr = formatFileSize(recording.size);
            
            // Determine transcription status
            const transcriptionStatus = recording.transcriptionStatus || 'none';
            let transcriptionInfo = '';
            let transcriptionButtons = '';
            
            switch (transcriptionStatus) {
                case 'pending':
                    transcriptionInfo = '<div style="color: #ff9800; font-size: 11px;">Transcription queued...</div>';
                    break;
                case 'transcribing':
                    transcriptionInfo = '<div style="color: #2196F3; font-size: 11px;">Transcribing...</div>';
                    break;
                case 'completed':
                    const transcriptionLength = recording.transcriptionLength || 0;
                    transcriptionInfo = `<div style="color: #4CAF50; font-size: 11px;">Transcription ready (${transcriptionLength} chars)</div>`;
                    transcriptionButtons = `
                        <button class="transcription-btn" data-recording-id="${recording.id}" style="
                            background: #4CAF50;
                            color: white;
                            border: none;
                            padding: 4px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                            margin-right: 4px;
                        ">
                            Download Transcription
                        </button>
                        <button class="view-transcription-btn" data-recording-id="${recording.id}" style="
                            background: #9C27B0;
                            color: white;
                            border: none;
                            padding: 4px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                            margin-right: 4px;
                        ">
                            View Text
                        </button>
                    `;
                    break;
                case 'failed':
                    const errorMsg = recording.transcriptionError || 'Unknown error';
                    transcriptionInfo = `<div style="color: #f44336; font-size: 11px;">Transcription failed: ${errorMsg}</div>`;
                    transcriptionButtons = `
                        <button class="retry-transcription-btn" data-recording-id="${recording.id}" style="
                            background: #ff9800;
                            color: white;
                            border: none;
                            padding: 4px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                            margin-right: 4px;
                        ">
                            Retry Transcription
                        </button>
                    `;
                    break;
                default:
                    transcriptionButtons = `
                        <button class="manual-transcribe-btn" data-recording-id="${recording.id}" style="
                            background: #607D8B;
                            color: white;
                            border: none;
                            padding: 4px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                            margin-right: 4px;
                        ">
                            Transcribe Now
                        </button>
                    `;
                    break;
            }
            
            return `
                <div style="
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    padding: 8px;
                    margin: 4px 0;
                    font-size: 12px;
                    background: #f9f9f9;
                ">
                    <div style="font-weight: bold; margin-bottom: 4px;">
                        ${recording.filename}
                    </div>
                    <div style="color: #666;">
                        ${dateStr} ${timeStr}<br>
                        Size: ${sizeStr}
                    </div>
                    ${transcriptionInfo}
                    <div style="margin-top: 8px;">
                        <button class="download-btn" data-recording-id="${recording.id}" style="
                            background: #2196F3;
                            color: white;
                            border: none;
                            padding: 4px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                            margin-right: 4px;
                        ">
                            Download Audio
                        </button>
                        ${transcriptionButtons}
                        <button class="delete-btn" data-recording-id="${recording.id}" style="
                            background: #f44336;
                            color: white;
                            border: none;
                            padding: 4px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                        ">
                            Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners to all buttons after creating the HTML
        addButtonEventListeners();
        
    } catch (error) {
        console.error('Error loading recordings:', error);
        const recordingsList = document.getElementById('recordingsList');
        recordingsList.innerHTML = '<div style="color: #f44336;">Error loading recordings</div>';
    }
}

function addButtonEventListeners() {
    // Download audio buttons
    document.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordingId = e.target.getAttribute('data-recording-id');
            downloadRecording(recordingId);
        });
    });

    // Delete buttons
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordingId = e.target.getAttribute('data-recording-id');
            deleteRecording(recordingId);
        });
    });

    // Transcription download buttons
    document.querySelectorAll('.transcription-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordingId = e.target.getAttribute('data-recording-id');
            downloadTranscription(recordingId);
        });
    });

    // View transcription buttons
    document.querySelectorAll('.view-transcription-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordingId = e.target.getAttribute('data-recording-id');
            viewTranscription(recordingId);
        });
    });

    // Manual transcribe buttons
    document.querySelectorAll('.manual-transcribe-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordingId = e.target.getAttribute('data-recording-id');
            transcribeRecording(recordingId);
        });
    });

    // Retry transcription buttons
    document.querySelectorAll('.retry-transcription-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordingId = e.target.getAttribute('data-recording-id');
            transcribeRecording(recordingId);
        });
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Download recording function
async function downloadRecording(recordingId) {
    try {
        console.log('Downloading recording:', recordingId);
        
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        
        if (!recording) {
            showError('Recording not found');
            return;
        }
        
        console.log('Found recording:', recording.filename);
        
        if (!recording.chunks || recording.chunks.length === 0) {
            showError('Recording data not available');
            console.error('No chunks found for recording:', recording);
            return;
        }
        
        console.log('Processing', recording.chunks.length, 'chunks for download');
        
        // Validate and convert base64 chunks back to blob
        const binaryData = [];
        let totalProcessed = 0;
        
        for (let i = 0; i < recording.chunks.length; i++) {
            try {
                const chunk = recording.chunks[i];
                if (!chunk || chunk.length === 0) {
                    console.warn('Skipping empty chunk at index', i);
                    continue;
                }
                
                // Decode base64
                const binary = atob(chunk);
                const bytes = new Uint8Array(binary.length);
                for (let j = 0; j < binary.length; j++) {
                    bytes[j] = binary.charCodeAt(j);
                }
                
                binaryData.push(bytes);
                totalProcessed += bytes.length;
                
            } catch (error) {
                console.error('Error processing chunk', i, ':', error);
                // Continue with other chunks
            }
        }
        
        if (binaryData.length === 0) {
            showError('No valid recording data found');
            return;
        }
        
        console.log('Successfully processed', binaryData.length, 'chunks, total size:', totalProcessed, 'bytes');
        
        // Create blob
        const blob = new Blob(binaryData, { type: recording.type || 'audio/webm' });
        
        console.log('Created blob with size:', blob.size, 'bytes');
        
        if (blob.size === 0) {
            showError('Generated audio file is empty');
            return;
        }
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = recording.filename;
        a.style.display = 'none';
        
        // Add to DOM and trigger download
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
        console.log('Download initiated for:', recording.filename);
        showSuccess(`Download started: ${recording.filename}`);
        
    } catch (error) {
        console.error('Error downloading recording:', error);
        showError('Error downloading recording: ' + error.message);
    }
}

// Transcribe recording function
async function transcribeRecording(recordingId) {
    try {
        console.log('Starting transcription for recording:', recordingId);
        
        // Update UI to show transcription is starting
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
        
        // Refresh UI
        loadRecentRecordings();
        
        // Send transcription request to background
        const response = await chrome.runtime.sendMessage({ 
            type: 'TRANSCRIBE_RECORDING',
            recordingId: recordingId
        });
        
        if (response && response.success) {
            showSuccess('Transcription started for: ' + recording.filename);
        } else {
            showError('Failed to start transcription');
        }
        
    } catch (error) {
        console.error('Error starting transcription:', error);
        showError('Error starting transcription: ' + error.message);
    }
}

// Download transcription function
async function downloadTranscription(recordingId) {
    try {
        console.log('Downloading transcription for recording:', recordingId);
        
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        
        if (!recording || !recording.transcriptionText) {
            showError('Transcription not found');
            return;
        }
        
        // Send download request to background
        const response = await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_TRANSCRIPTION',
            transcriptionText: recording.transcriptionText,
            filename: recording.filename
        });
        
        if (response && response.success) {
            showSuccess('Transcription download started');
        } else {
            showError('Failed to download transcription');
        }
        
    } catch (error) {
        console.error('Error downloading transcription:', error);
        showError('Error downloading transcription: ' + error.message);
    }
}

// View transcription function
async function viewTranscription(recordingId) {
    try {
        const result = await chrome.storage.local.get(['recordings']);
        const recordings = result.recordings || [];
        const recording = recordings.find(r => r.id === recordingId);
        
        if (!recording || !recording.transcriptionText) {
            showError('Transcription not found');
            return;
        }
        
        // Create a modal to show the transcription
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 20px;
            max-width: 500px;
            max-height: 400px;
            overflow-y: auto;
            position: relative;
        `;
        
        modalContent.innerHTML = `
            <h3 style="margin-top: 0; margin-bottom: 15px;">Transcription: ${recording.filename}</h3>
            <div style="border: 1px solid #ddd; padding: 15px; border-radius: 4px; background: #f9f9f9; line-height: 1.5; font-size: 14px; max-height: 250px; overflow-y: auto;">
                ${recording.transcriptionText}
            </div>
            <div style="margin-top: 15px; text-align: right;">
                <button id="closeModal" style="
                    background: #2196F3;
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
        
        // Add event listeners
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
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
        
    } catch (error) {
        console.error('Error viewing transcription:', error);
        showError('Error viewing transcription: ' + error.message);
    }
}

// Delete recording function
async function deleteRecording(recordingId) {
    if (!confirm('Are you sure you want to delete this recording and its transcription?')) {
        return;
    }
    
    try {
        console.log('Deleting recording:', recordingId);
        
        const result = await chrome.storage.local.get(['recordings']);
        let recordings = result.recordings || [];
        
        // Remove the recording
        const initialLength = recordings.length;
        recordings = recordings.filter(r => r.id !== recordingId);
        
        if (recordings.length === initialLength) {
            showError('Recording not found');
            return;
        }
        
        await chrome.storage.local.set({ recordings });
        
        console.log('Recording deleted successfully');
        
        // Refresh the list
        loadRecentRecordings();
        
        showSuccess('Recording deleted successfully');
        
    } catch (error) {
        console.error('Error deleting recording:', error);
        showError('Error deleting recording: ' + error.message);
    }
}

function showError(message) {
    console.error('Popup error:', message);
    
    const statusDiv = document.getElementById('status');
    const originalText = statusDiv.textContent;
    const originalClass = statusDiv.className;
    
    statusDiv.textContent = message;
    statusDiv.className = 'status recording';
    
    setTimeout(() => {
        statusDiv.textContent = originalText;
        statusDiv.className = originalClass;
    }, 4000);
}

function showSuccess(message) {
    console.log('Popup success:', message);
    
    const statusDiv = document.getElementById('status');
    const originalText = statusDiv.textContent;
    const originalClass = statusDiv.className;
    
    statusDiv.textContent = message;
    statusDiv.className = 'status idle';
    
    setTimeout(() => {
        statusDiv.textContent = originalText;
        statusDiv.className = originalClass;
    }, 3000);
}

// Update status periodically
setInterval(updateStatus, 2000);

// Listen for storage changes to update recordings list
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.recordings) {
        console.log('Recordings updated, refreshing list');
        loadRecentRecordings();
    }
});