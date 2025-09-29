import logging
import sys

from meet_bot import AnonymousGoogleMeetBot

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('google_meet_bot.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

def main():
    """Main entry point for the Google Meet Bot"""
    
    # Configuration
    meeting_link = "https://meet.google.com/gvm-kfxf-aym" 
    bot_name = "Echo" 
    enable_recording = True  
    
    print("=" * 60)
    print("Anonymous Google Meet Bot with Enhanced Audio Recording")
    print("=" * 60)
    print(f"Meeting: {meeting_link}")
    print(f"Bot name: {bot_name}")
    print(f"Recording: {'ENABLED' if enable_recording else 'DISABLED'}")
    print()
    
    if enable_recording:
        print("Recording is enabled with enhanced monitoring. Features:")
        
        # Check if PyAudio is available
        try:
            import pyaudio
            print("✓ PyAudio is available")
        except ImportError:
            logger.error("❌ PyAudio not installed. Install with: pip install pyaudio")
            return
    
    print()
    print("Starting bot...")
    print("=" * 60)
    print()
    
    # Create and run bot
    bot = AnonymousGoogleMeetBot(meeting_link, bot_name, enable_recording)
    bot.run()

if __name__ == "__main__":
    main()