import logging
import time
import os
import threading
import datetime
import pyaudio
import wave
import struct

logger = logging.getLogger(__name__)

class AudioRecorder:
    """Handles audio recording functionality with enhanced monitoring"""
    
    def __init__(self, recordings_folder="recordings"):
        self.recordings_folder = recordings_folder
        self.is_recording = False
        self.audio_thread = None
        self.audio_stream = None
        self.audio_format = pyaudio.paInt16
        self.channels = 2  # Stereo
        self.rate = 44100  # Sample rate
        self.chunk = 1024
        self.audio = pyaudio.PyAudio()
        self.frames = []
        self.recording_start_time = None
        self.recording_filename = None
        self.total_frames_recorded = 0
        self.last_audio_level_log = 0
        self.recording_duration = 0
        
        # Create recordings folder if it doesn't exist
        if not os.path.exists(self.recordings_folder):
            os.makedirs(self.recordings_folder)
            logger.info(f"Created recordings folder: {self.recordings_folder}")
        
        # List available audio devices
        self._list_audio_devices()
    
    def _list_audio_devices(self):
        """List available audio input devices for debugging"""
        try:
            logger.info("Available audio input devices:")
            for i in range(self.audio.get_device_count()):
                device_info = self.audio.get_device_info_by_index(i)
                if device_info.get('maxInputChannels', 0) > 0:
                    logger.info(f"  Device {i}: {device_info['name']} - Channels: {device_info['maxInputChannels']}")
        except Exception as e:
            logger.warning(f"Could not list audio devices: {e}")
    
    def get_recording_filename(self):
        """Generate filename with timestamp"""
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = os.path.join(self.recordings_folder, f"meeting_recording_{timestamp}.wav")
        return filename
    
    def start_recording(self):
        """Start audio recording with enhanced monitoring"""
        if self.is_recording:
            logger.warning("Recording already in progress")
            return False
        
        try:
            logger.info("=" * 50)
            logger.info("STARTING AUDIO RECORDING")
            logger.info("=" * 50)
            
            # Get default audio input device
            default_device = self.audio.get_default_input_device_info()
            logger.info(f"Using audio device: {default_device['name']}")
            logger.info(f"Device index: {default_device['index']}")
            logger.info(f"Max input channels: {default_device['maxInputChannels']}")
            logger.info(f"Default sample rate: {default_device['defaultSampleRate']}")
            
            # Prepare recording filename
            self.recording_filename = self.get_recording_filename()
            logger.info(f"Recording will be saved to: {self.recording_filename}")
            
            # Open audio stream
            self.audio_stream = self.audio.open(
                format=self.audio_format,
                channels=min(self.channels, int(default_device['maxInputChannels'])),
                rate=int(min(self.rate, default_device['defaultSampleRate'])),
                input=True,
                frames_per_buffer=self.chunk,
                input_device_index=default_device['index']
            )
            
            self.is_recording = True
            self.frames = []
            self.recording_start_time = time.time()
            self.total_frames_recorded = 0
            self.last_audio_level_log = time.time()
            
            # Start recording thread
            self.audio_thread = threading.Thread(target=self._record_audio)
            self.audio_thread.daemon = True
            self.audio_thread.start()
            
            logger.info("AUDIO RECORDING STARTED SUCCESSFULLY!")
            logger.info(f"Recording format: {self.channels} channels, {self.rate} Hz")
            logger.info("Audio levels will be monitored every 30 seconds")
            
            return True
            
        except Exception as e:
            logger.error(f"FAILED TO START RECORDING: {str(e)}")
            logger.error("This might be due to:")
            logger.error("1. No microphone/audio input device available")
            logger.error("2. Audio device is being used by another application")
            logger.error("3. Permission issues with audio device access")
            return False
    
    def _record_audio(self):
        """Internal method to record audio in separate thread with monitoring"""
        logger.info("Audio recording thread started - actively capturing audio...")
        
        try:
            while self.is_recording:
                try:
                    data = self.audio_stream.read(self.chunk, exception_on_overflow=False)
                    self.frames.append(data)
                    self.total_frames_recorded += 1
                    
                    # Log audio levels and stats every 30 seconds
                    current_time = time.time()
                    if current_time - self.last_audio_level_log >= 30:
                        self._log_recording_stats(current_time)
                        self.last_audio_level_log = current_time
                        
                except Exception as read_error:
                    logger.error(f"Error reading audio data: {read_error}")
                    time.sleep(0.1)
                    
        except Exception as e:
            logger.error(f"Critical error in recording thread: {str(e)}")
        finally:
            logger.info("Audio recording thread finished")
    
    def _log_recording_stats(self, current_time):
        """Log recording statistics and audio level information"""
        if self.recording_start_time:
            duration = int(current_time - self.recording_start_time)
            minutes, seconds = divmod(duration, 60)
            
            # Calculate approximate data size
            bytes_per_frame = 2 * self.channels
            frames_per_second = self.rate / self.chunk
            expected_frames = duration * frames_per_second
            data_mb = (self.total_frames_recorded * self.chunk * bytes_per_frame) / (1024 * 1024)
            
            logger.info("=" * 40)
            logger.info("RECORDING STATUS UPDATE")
            logger.info(f"Duration: {minutes:02d}:{seconds:02d}")
            logger.info(f"Frames captured: {self.total_frames_recorded:,}")
            logger.info(f"Expected frames: {int(expected_frames):,}")
            logger.info(f"Data size: {data_mb:.1f} MB")
            logger.info(f"Recording file: {os.path.basename(self.recording_filename)}")
            
            if self.total_frames_recorded > 0:
                logger.info("Audio data is being captured")
                
                # Try to analyze last frame for audio level
                if self.frames:
                    try:
                        last_frame = self.frames[-1]
                        samples = struct.unpack(f'<{len(last_frame)//2}h', last_frame)
                        max_amplitude = max(abs(s) for s in samples) if samples else 0
                        amplitude_percent = (max_amplitude / 32768) * 100
                        logger.info(f"Current audio level: {amplitude_percent:.1f}% of max")
                        
                        if amplitude_percent < 1:
                            logger.warning("Audio levels very low - check if meeting audio is being captured")
                    except Exception as level_error:
                        logger.debug(f"Could not analyze audio level: {level_error}")
            else:
                logger.warning("NO audio data captured - recording may not be working!")
            
            logger.info("=" * 40)
    
    def stop_recording(self, reason="Manual stop"):
        """Stop audio recording and save file with enhanced logging"""
        if not self.is_recording:
            logger.warning("No recording in progress")
            return None
        
        try:
            logger.info("=" * 50)
            logger.info(f"STOPPING AUDIO RECORDING - Reason: {reason}")
            logger.info("=" * 50)
            
            self.is_recording = False
            
            # Calculate final duration
            if self.recording_start_time:
                final_duration = time.time() - self.recording_start_time
                minutes, seconds = divmod(int(final_duration), 60)
                logger.info(f"Total recording duration: {minutes:02d}:{seconds:02d}")
                self.recording_duration = final_duration
            
            # Wait for recording thread to finish
            if self.audio_thread:
                logger.info("Waiting for recording thread to finish...")
                self.audio_thread.join(timeout=10)
                if self.audio_thread.is_alive():
                    logger.warning("Recording thread did not finish cleanly")
            
            # Close audio stream
            if self.audio_stream:
                try:
                    self.audio_stream.stop_stream()
                    self.audio_stream.close()
                    logger.info("Audio stream closed")
                except Exception as stream_error:
                    logger.warning(f"Error closing audio stream: {stream_error}")
                finally:
                    self.audio_stream = None
            
            # Save recording to file
            if self.frames and len(self.frames) > 0:
                logger.info(f"Saving {len(self.frames):,} audio frames to file...")
                
                try:
                    with wave.open(self.recording_filename, 'wb') as wf:
                        wf.setnchannels(self.channels)
                        wf.setsampwidth(self.audio.get_sample_size(self.audio_format))
                        wf.setframerate(self.rate)
                        wf.writeframes(b''.join(self.frames))
                    
                    if os.path.exists(self.recording_filename):
                        file_size = os.path.getsize(self.recording_filename)
                        file_size_mb = file_size / (1024 * 1024)
                        
                        logger.info("RECORDING SAVED SUCCESSFULLY!")
                        logger.info(f"File: {self.recording_filename}")
                        logger.info(f"Size: {file_size_mb:.1f} MB ({file_size:,} bytes)")
                        logger.info(f"Frames: {len(self.frames):,}")
                        
                        if file_size < 1000:
                            logger.warning("Recording file is very small - may not contain audio data")
                        
                        return self.recording_filename
                    else:
                        logger.error("Recording file was not created!")
                        return None
                        
                except Exception as save_error:
                    logger.error(f"Error saving recording: {save_error}")
                    return None
            else:
                logger.warning("No audio data to save - recording was empty")
                return None
                
        except Exception as e:
            logger.error(f"Error stopping recording: {str(e)}")
            return None
        finally:
            self.frames = []
            self.total_frames_recorded = 0
            self.recording_start_time = None
    
    def get_recording_status(self):
        """Get current recording status information"""
        if not self.is_recording:
            return {
                'is_recording': False,
                'duration': 0,
                'frames_captured': 0,
                'filename': None
            }
        
        duration = time.time() - self.recording_start_time if self.recording_start_time else 0
        
        return {
            'is_recording': True,
            'duration': duration,
            'frames_captured': self.total_frames_recorded,
            'filename': self.recording_filename
        }
    
    def cleanup(self):
        """Clean up audio resources"""
        if self.is_recording:
            self.stop_recording("Cleanup called")
        
        if self.audio:
            try:
                self.audio.terminate()
                logger.info("Audio system cleaned up")
            except Exception as e:
                logger.warning(f"Error cleaning up audio: {e}")
