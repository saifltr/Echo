import logging
import time
import sys
import os
import signal
import atexit
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
import undetected_chromedriver as uc

from audio_recorder import AudioRecorder

logger = logging.getLogger(__name__)

class AnonymousGoogleMeetBot:
    def __init__(self, meeting_link, bot_name="Anonymous Bot", enable_recording=True):
        self.meeting_link = meeting_link
        self.bot_name = bot_name
        self.driver = None
        self.wait = None
        self.enable_recording = enable_recording
        self.recorder = AudioRecorder() if enable_recording else None
        self.recording_filename = None
        self.is_in_meeting = False
        self.meeting_start_time = None
        
        # Register cleanup handlers for graceful shutdown
        atexit.register(self.cleanup)
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle system signals for graceful shutdown"""
        logger.info(f"Received signal {signum} - shutting down gracefully...")
        self.cleanup()
        sys.exit(0)
    
    def setup_driver_for_recording(self):
        """Setup Chrome driver with audio capture capabilities"""
        logger.info("Setting up Chrome driver with recording capabilities...")
        
        try:
            options = uc.ChromeOptions()
            
            # Basic browser options
            options.add_argument('--no-sandbox')
            options.add_argument('--disable-dev-shm-usage')
            options.add_argument('--disable-blink-features=AutomationControlled')
            options.add_argument('--disable-extensions')
            options.add_argument('--no-first-run')
            options.add_argument('--disable-default-apps')
            options.add_argument('--disable-infobars')
            options.add_argument('--window-size=1920,1080')
            
            # Audio recording specific options
            options.add_argument('--use-fake-ui-for-media-stream')
            options.add_argument('--disable-web-security')
            options.add_argument('--allow-running-insecure-content')
            options.add_argument('--autoplay-policy=no-user-gesture-required')
            options.add_argument('--use-fake-device-for-media-stream')
            options.add_argument('--allow-file-access-from-files')
            
            # Enhanced media preferences for recording
            prefs = {
                "profile.default_content_setting_values": {
                    "media_stream_mic": 1,
                    "media_stream_camera": 2,
                    "notifications": 1,
                    "popups": 0
                },
                "profile.content_settings.pattern_pairs": {
                    "https://meet.google.com,*": {
                        "media_stream_mic": 1,
                        "media_stream_camera": 2
                    }
                }
            }
            options.add_experimental_option("prefs", prefs)
            
            self.driver = uc.Chrome(options=options, version_main=None)
            
            # Execute anti-detection scripts
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            self.driver.execute_script("Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]})")
            
            self.wait = WebDriverWait(self.driver, 20)
            logger.info("Chrome driver with recording capabilities setup successful")
            return True
            
        except Exception as e:
            logger.error(f"Failed to setup recording driver: {str(e)}")
            return False
    
    def setup_normal_driver(self):
        """Setup Chrome driver with normal window and enhanced media control"""
        if self.enable_recording:
            return self.setup_driver_for_recording()
        
        logger.info("Setting up Chrome driver in normal mode...")
        
        try:
            options = uc.ChromeOptions()
            
            # Basic browser options
            options.add_argument('--no-sandbox')
            options.add_argument('--disable-dev-shm-usage')
            options.add_argument('--disable-blink-features=AutomationControlled')
            options.add_argument('--disable-extensions')
            options.add_argument('--no-first-run')
            options.add_argument('--disable-default-apps')
            options.add_argument('--disable-infobars')
            options.add_argument('--window-size=1920,1080')
            options.add_argument('--use-fake-ui-for-media-stream')
            options.add_argument('--use-fake-device-for-media-stream')
            options.add_argument('--disable-web-security')
            options.add_argument('--allow-running-insecure-content')
            
            # Enhanced media preferences to ensure muted/camera off state
            prefs = {
                "profile.default_content_setting_values": {
                    "media_stream_mic": 2,
                    "media_stream_camera": 2,
                    "notifications": 1,
                    "popups": 0
                }
            }
            options.add_experimental_option("prefs", prefs)
            
            self.driver = uc.Chrome(options=options, version_main=None)
            
            # Execute anti-detection scripts
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            self.driver.execute_script("Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]})")
            
            self.wait = WebDriverWait(self.driver, 20)
            logger.info("Normal Chrome driver setup successful")
            return True
            
        except Exception as e:
            logger.error(f"Failed to setup normal driver: {str(e)}")
            return False
    
    def try_meeting_url_variations(self):
        """Try different URL variations to bypass restrictions"""
        logger.info("Trying different URL approaches...")
        
        meeting_id = self.meeting_link.split('/')[-1].split('?')[0]
        
        url_variations = [
            self.meeting_link,
            f"https://meet.google.com/{meeting_id}",
            f"https://meet.google.com/{meeting_id}?pli=1",
            f"https://meet.google.com/{meeting_id}?hl=en",
            f"https://meet.google.com/{meeting_id}?authuser=0",
            f"https://meet.google.com/{meeting_id}?usp=meet_web",
            f"https://meet.google.com/{meeting_id}?continue=https://meet.google.com",
        ]
        
        for i, url in enumerate(url_variations):
            try:
                logger.info(f"Trying URL variation {i+1}: {url}")
                self.driver.get(url)
                time.sleep(4)
                
                page_source = self.driver.page_source.lower()
                
                restriction_phrases = [
                    "can't create a meeting",
                    "contact your system administrator",
                    "you can't create meetings",
                    "administrator for more information",
                    "your organization doesn't allow"
                ]
                
                has_restriction = any(phrase in page_source for phrase in restriction_phrases)
                
                if not has_restriction:
                    logger.info(f"Success with URL variation {i+1}")
                    return True
                else:
                    logger.info(f"Restriction detected with URL variation {i+1}")
                    
            except Exception as e:
                logger.warning(f"Error with URL variation {i+1}: {str(e)}")
                continue
        
        logger.warning("All URL variations showed restrictions, continuing anyway...")
        return True
    
    def ensure_muted_and_camera_off(self):
        """Aggressively ensure microphone is muted and camera is off"""
        logger.info("Ensuring microphone is muted and camera is off...")
        
        try:
            time.sleep(3)
            
            # Handle microphone
            mic_selectors = [
                "button[aria-label*='Turn off microphone']",
                "button[aria-label*='microphone' i][aria-label*='on' i]",
                "button[aria-label*='Mute' i]",
                "button[jsname*='BOHaEe']",
                "div[role='button'][aria-label*='microphone' i]",
            ]
            
            self._toggle_media_button(mic_selectors, "microphone", "off")
            
            # Handle camera
            cam_selectors = [
                "button[aria-label*='Turn off camera']",
                "button[aria-label*='camera' i][aria-label*='on' i]",
                "button[jsname*='I5Fjmd']",
                "div[role='button'][aria-label*='camera' i]",
            ]
            
            self._toggle_media_button(cam_selectors, "camera", "off")
            
            self.verify_media_state()
            
        except Exception as e:
            logger.warning(f"Error in media configuration: {str(e)}")
    
    def _toggle_media_button(self, selectors, device_name, desired_state):
        """Helper to toggle media buttons"""
        attempts = 0
        toggled = False
        
        while not toggled and attempts < 5:
            attempts += 1
            logger.info(f"{device_name.capitalize()} toggle attempt {attempts}")
            
            for selector in selectors:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    
                    for elem in elements:
                        if elem.is_displayed() and elem.is_enabled():
                            aria_label = (elem.get_attribute("aria-label") or "").lower()
                            
                            needs_toggle = ("turn off" in aria_label and device_name in aria_label) or \
                                         (device_name in aria_label and "off" not in aria_label and desired_state == "off")
                            
                            already_correct = desired_state in aria_label
                            
                            if needs_toggle:
                                try:
                                    elem.click()
                                    time.sleep(1)
                                    logger.info(f"{device_name.capitalize()} turned {desired_state}")
                                    toggled = True
                                    break
                                except:
                                    self.driver.execute_script("arguments[0].click();", elem)
                                    time.sleep(1)
                                    toggled = True
                                    break
                            elif already_correct:
                                logger.info(f"{device_name.capitalize()} already {desired_state}")
                                toggled = True
                                break
                except Exception as e:
                    continue
            
            if toggled:
                break
            time.sleep(2)
    
    def verify_media_state(self):
        """Verify that microphone and camera are actually off"""
        logger.info("Verifying media state...")
        
        try:
            mic_elements = self.driver.find_elements(By.CSS_SELECTOR, "button[aria-label*='microphone' i]")
            for mic in mic_elements:
                if mic.is_displayed():
                    aria_label = (mic.get_attribute("aria-label") or "").lower()
                    if "off" in aria_label or "muted" in aria_label:
                        logger.info("Bot microphone confirmed OFF/MUTED")
                    else:
                        logger.warning(f"Bot microphone state unclear: {aria_label}")
                    break
            
            cam_elements = self.driver.find_elements(By.CSS_SELECTOR, "button[aria-label*='camera' i]")
            for cam in cam_elements:
                if cam.is_displayed():
                    aria_label = (cam.get_attribute("aria-label") or "").lower()
                    if "off" in aria_label:
                        logger.info("Camera confirmed OFF")
                    else:
                        logger.warning(f"Camera state unclear: {aria_label}")
                    break
                    
        except Exception as e:
            logger.warning(f"Could not verify media state: {str(e)}")
    
    def enter_name(self):
        """Enter bot name if required"""
        logger.info("Checking for name input...")
        
        try:
            name_selectors = [
                'input[placeholder="Your name"]',
                'input[placeholder*="name"]',
                'input[aria-label*="name"]',
                'input[type="text"][placeholder]'
            ]
            
            for selector in name_selectors:
                try:
                    name_input = WebDriverWait(self.driver, 3).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                    )
                    
                    if name_input.is_displayed():
                        name_input.clear()
                        name_input.send_keys(self.bot_name)
                        logger.info(f"Name entered: {self.bot_name}")
                        time.sleep(1)
                        return True
                except (TimeoutException, NoSuchElementException):
                    continue
                    
            logger.info("Name input not found or not required")
            return True
            
        except Exception as e:
            logger.warning(f"Error entering name: {str(e)}")
            return True
    
    def find_and_click_join_button(self):
        """Find and click the join/ask to join button"""
        logger.info("Looking for join button...")
        
        join_selectors = [
            ("xpath", "//span[contains(text(), 'Ask to join')]/parent::button"),
            ("xpath", "//span[contains(text(), 'Join now')]/parent::button"),
            ("xpath", "//span[contains(text(), 'Join')]/parent::button"),
            ("css", "button[jsname='Qx7uuf']"),
            ("css", "button[aria-label*='Join']"),
            ("css", "button[aria-label*='Ask to join']"),
        ]
        
        join_button = None
        
        for selector_type, selector in join_selectors:
            try:
                if selector_type == "xpath":
                    element = WebDriverWait(self.driver, 3).until(
                        EC.element_to_be_clickable((By.XPATH, selector))
                    )
                else:
                    element = WebDriverWait(self.driver, 3).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                    )
                
                if element.is_displayed():
                    join_button = element
                    logger.info(f"Found join button with: {selector}")
                    break
            except (TimeoutException, NoSuchElementException):
                continue
        
        if not join_button:
            logger.error("Could not find join button")
            self.take_screenshot("no_join_button")
            return False
        
        try:
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", join_button)
            time.sleep(1)
            join_button.click()
            logger.info("Join button clicked successfully")
            time.sleep(5)
            return True
        except Exception as e:
            try:
                self.driver.execute_script("arguments[0].click();", join_button)
                logger.info("Join button clicked via JavaScript")
                time.sleep(5)
                return True
            except Exception as e2:
                logger.error(f"Both click methods failed: {e2}")
                return False
    
    def check_meeting_status(self):
        """Check if successfully joined or waiting for approval"""
        logger.info("Checking meeting status...")
        
        try:
            meeting_indicators = [
                'button[aria-label*="Leave call"]',
                'div[data-meeting-title]',
                'button[aria-label*="microphone"]',
                'button[aria-label*="camera"]',
            ]
            
            for selector in meeting_indicators:
                try:
                    element = self.driver.find_element(By.CSS_SELECTOR, selector)
                    if element.is_displayed():
                        logger.info("Successfully joined the meeting!")
                        return "joined"
                except NoSuchElementException:
                    continue
            
            page_source = self.driver.page_source.lower()
            
            waiting_phrases = ["waiting for the host", "ask to join", "waiting for someone to let you in"]
            for phrase in waiting_phrases:
                if phrase in page_source:
                    logger.info(f"Waiting for approval: {phrase}")
                    return "waiting"
            
            ended_phrases = ["meeting ended", "you left the meeting", "meeting has ended"]
            for phrase in ended_phrases:
                if phrase in page_source:
                    logger.info(f"Meeting ended detected: {phrase}")
                    return "ended"
            
            return "unknown"
            
        except Exception as e:
            logger.error(f"Error checking status: {str(e)}")
            return "error"
    
    def detect_disconnection(self):
        """Detect if the bot has been disconnected from the meeting"""
        try:
            current_url = self.driver.current_url
            
            if "meet.google.com" not in current_url:
                logger.warning("No longer on Meet URL - disconnected")
                return True
            
            page_source = self.driver.page_source.lower()
            disconnect_phrases = ["you left the meeting", "you were removed", "meeting ended", "meeting has ended"]
            
            for phrase in disconnect_phrases:
                if phrase in page_source:
                    logger.warning(f"Disconnection detected: {phrase}")
                    return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error detecting disconnection: {e}")
            return True
    
    def start_recording(self):
        """Start audio recording if enabled"""
        if not self.enable_recording or not self.recorder:
            return False
        
        logger.info("Attempting to start meeting recording...")
        time.sleep(3)
        
        success = self.recorder.start_recording()
        if success:
            logger.info("Meeting recording started successfully!")
            self.is_in_meeting = True
            self.meeting_start_time = time.time()
        else:
            logger.error("Failed to start meeting recording")
        
        return success
    
    def stop_recording(self, reason="Manual stop"):
        """Stop audio recording if enabled"""
        if not self.enable_recording or not self.recorder:
            return None
        
        logger.info(f"Stopping meeting recording - Reason: {reason}")
        filename = self.recorder.stop_recording(reason)
        
        if filename:
            self.recording_filename = filename
            logger.info(f"Meeting recording saved: {filename}")
            
            if self.meeting_start_time:
                meeting_duration = time.time() - self.meeting_start_time
                minutes, seconds = divmod(int(meeting_duration), 60)
                logger.info(f"Total meeting duration: {minutes:02d}:{seconds:02d}")
        else:
            logger.warning("Failed to save meeting recording")
        
        self.is_in_meeting = False
        return filename
    
    def take_screenshot(self, name):
        """Take screenshot for debugging"""
        try:
            filename = f"screenshot_{name}_{int(time.time())}.png"
            self.driver.save_screenshot(filename)
            logger.info(f"Screenshot saved: {filename}")
        except Exception as e:
            logger.warning(f"Screenshot failed: {str(e)}")
    
    def join_meeting(self):
        """Main method to join the meeting"""
        logger.info(f"Attempting to join meeting: {self.meeting_link}")
        
        try:
            if not self.try_meeting_url_variations():
                logger.error("Could not access meeting with any URL variation")
                return False
            
            self.ensure_muted_and_camera_off()
            self.enter_name()
            
            if not self.find_and_click_join_button():
                logger.error("Failed to click join button")
                return False
            
            status = self.check_meeting_status()
            
            if status in ["joined", "waiting"]:
                logger.info("Successfully joined or waiting for approval!")
                
                if status == "joined" and self.enable_recording:
                    logger.info("Already in meeting - starting recording now")
                    self.start_recording()
                
                return True
            else:
                logger.warning("Meeting status unclear, but join attempt completed")
                return True
                
        except Exception as e:
            logger.error(f"Error joining meeting: {str(e)}")
            self.take_screenshot("join_error")
            return False
    
    def stay_in_meeting(self):
        """Keep the bot in the meeting with enhanced monitoring"""
        logger.info("Bot will stay in meeting. Press Ctrl+C to exit.")
        
        recording_started = False
        
        try:
            check_count = 0
            while True:
                time.sleep(30)
                check_count += 1
                
                logger.info(f"Status check #{check_count}: Bot monitoring meeting...")
                
                if self.detect_disconnection():
                    logger.warning("Bot has been disconnected from the meeting!")
                    if recording_started and self.enable_recording:
                        self.stop_recording("Disconnection detected")
                    break
                
                status = self.check_meeting_status()
                
                if status == "ended":
                    logger.info("Meeting has ended")
                    if recording_started and self.enable_recording:
                        self.stop_recording("Meeting ended")
                    break
                elif status == "joined" and not recording_started and self.enable_recording:
                    logger.info("Confirmed in meeting - starting recording")
                    self.start_recording()
                    recording_started = True
                elif status == "waiting":
                    logger.info("Still waiting for host approval")
                
                if self.enable_recording and self.recorder:
                    recording_status = self.recorder.get_recording_status()
                    if recording_status['is_recording']:
                        duration = int(recording_status['duration'])
                        minutes, seconds = divmod(duration, 60)
                        logger.info(f"Recording active: {minutes:02d}:{seconds:02d} duration, {recording_status['frames_captured']:,} frames")
                
                if check_count % 5 == 0:
                    logger.info("Verifying media settings...")
                    self.ensure_muted_and_camera_off()
                
        except KeyboardInterrupt:
            logger.info("Bot stopped by user (Ctrl+C)")
            if recording_started and self.enable_recording:
                self.stop_recording("User interrupted")
        except Exception as e:
            logger.error(f"Error while staying in meeting: {str(e)}")
            if recording_started and self.enable_recording:
                self.stop_recording("Error occurred")
        finally:
            if self.enable_recording and self.recorder and self.recorder.is_recording:
                logger.info("Final recording cleanup...")
                self.stop_recording("Bot shutdown")
    
    def run(self):
        """Main execution method"""
        logger.info("Starting Anonymous Google Meet Bot with Enhanced Audio Recording...")
        
        if self.enable_recording:
            logger.warning("=" * 60)
            logger.warning("RECORDING IS ENABLED!")
            logger.warning("Please ensure you have consent from all participants")
            logger.warning("Recording without consent may violate laws and policies")
            logger.warning("=" * 60)
        
        try:
            if not self.setup_normal_driver():
                logger.error("Failed to setup driver")
                return False
            
            if not self.join_meeting():
                logger.error("Failed to join meeting")
                return False
            
            self.stay_in_meeting()
            
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
        finally:
            self.cleanup()
    
    def cleanup(self):
        """Clean up resources with enhanced logging"""
        logger.info("Starting cleanup process...")
        
        if self.enable_recording and self.recorder:
            if self.recorder.is_recording:
                logger.info("Recording still active - stopping and saving...")
                self.stop_recording("Bot cleanup")
            self.recorder.cleanup()
        
        if self.driver:
            try:
                self.driver.quit()
                logger.info("Browser driver closed")
            except Exception as e:
                logger.warning(f"Error closing driver: {str(e)}")
        
        if self.recording_filename:
            logger.info("=" * 50)
            logger.info("RECORDING SUMMARY")
            logger.info(f"Recording saved: {self.recording_filename}")
            
            try:
                if os.path.exists(self.recording_filename):
                    file_size = os.path.getsize(self.recording_filename)
                    file_size_mb = file_size / (1024 * 1024)
                    logger.info(f"File size: {file_size_mb:.1f} MB")
                    logger.info(f"Absolute path: {os.path.abspath(self.recording_filename)}")
            except Exception as e:
                logger.warning(f"Could not get file info: {e}")
            
            logger.info("=" * 50)