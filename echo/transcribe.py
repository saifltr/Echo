# transcribe.py
import os
import torch
import numpy as np
import tempfile
import subprocess
import shutil
from transformers import WhisperProcessor, WhisperForConditionalGeneration
import librosa
import traceback

def setup_whisper_model():
    """
    Download and setup Whisper model if not present
    Call this once to setup the model
    """
    try:
        from transformers import WhisperProcessor, WhisperForConditionalGeneration
        
        model_path = "models/whisper-base"
        
        if os.path.exists(model_path):
            print(f"Whisper model already exists at {model_path}")
            return True
        
        print("Downloading Whisper base model...")
        os.makedirs("models", exist_ok=True)
        
        # Download and save model
        processor = WhisperProcessor.from_pretrained("openai/whisper-base")
        model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-base")
        
        processor.save_pretrained(model_path)
        model.save_pretrained(model_path)
        
        print(f"Whisper model downloaded and saved to {model_path}")
        return True
        
    except Exception as e:
        print(f"Error setting up Whisper model: {str(e)}")
        return False

def find_ffmpeg():
    """Find FFmpeg executable, try simple approach first"""
    # Try system PATH first
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        return ffmpeg_path
    
    # Try with .exe on Windows
    if os.name == 'nt':
        ffmpeg_path = shutil.which('ffmpeg.exe')
        if ffmpeg_path:
            return ffmpeg_path
    
    # Try current directory
    current_dir_ffmpeg = os.path.join('.', 'ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
    if os.path.isfile(current_dir_ffmpeg):
        return current_dir_ffmpeg
    
    return None

def test_ffmpeg():
    """Test if FFmpeg is available and working"""
    try:
        ffmpeg_path = find_ffmpeg()
        if not ffmpeg_path:
            print("FFmpeg not found in system PATH")
            return False
        
        # Test FFmpeg by running version command
        result = subprocess.run([ffmpeg_path, '-version'], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            print(f"FFmpeg found and working: {ffmpeg_path}")
            return True
        else:
            print(f"FFmpeg found but not working properly: {ffmpeg_path}")
            return False
            
    except subprocess.TimeoutExpired:
        print("FFmpeg test timed out")
        return False
    except Exception as e:
        print(f"Error testing FFmpeg: {e}")
        return False

def convert_webm_to_wav(input_file, output_file=None):
    """Convert WebM to WAV using FFmpeg"""
    try:
        ffmpeg_path = find_ffmpeg()
        if not ffmpeg_path:
            # Try to install ffmpeg-python as fallback
            try:
                import ffmpeg
                if output_file is None:
                    output_file = input_file.replace('.webm', '.wav')
                
                (
                    ffmpeg
                    .input(input_file)
                    .output(output_file, ar=16000, ac=1, format='wav')
                    .overwrite_output()
                    .run(quiet=True)
                )
                return output_file
            except ImportError:
                raise Exception("FFmpeg not found and ffmpeg-python not installed. Please install FFmpeg or run: pip install ffmpeg-python")
        
        if output_file is None:
            output_file = input_file.replace('.webm', '.wav')
        
        cmd = [
            ffmpeg_path, '-i', input_file,
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',      # Mono
            '-y',            # Overwrite
            '-loglevel', 'error',
            output_file
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg failed: {result.stderr}")
        
        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            raise Exception("Converted file not created or empty")
        
        return output_file
        
    except Exception as e:
        print(f"Conversion failed: {e}")
        return None

def transcribe_audio_direct(audio_file, chunk_seconds=30, debug=True):
    """
    Transcribe audio with WebM support via conversion
    """
    converted_file = None
    try:
        if not os.path.exists(audio_file):
            raise FileNotFoundError(f"Audio file not found: {audio_file}")

        print(f"[transcribe] Audio file: {audio_file}")
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        print(f"[transcribe] Using device: {device}")

        # Local model path
        local_model_path = "models/whisper-base"
        if not os.path.exists(local_model_path):
            raise FileNotFoundError(f"Local model path not found: {local_model_path}. Run setup_whisper_model() first.")

        print("[transcribe] Loading Whisper processor and model...")
        processor = WhisperProcessor.from_pretrained(local_model_path)
        model = WhisperForConditionalGeneration.from_pretrained(local_model_path).to(device)
        print("[transcribe] Model loaded.")

        # Prepare forced decoder ids for English transcription
        forced_decoder_ids = processor.get_decoder_prompt_ids(language="en", task="transcribe")
        if debug:
            print(f"[transcribe] forced_decoder_ids length: {len(forced_decoder_ids)}")

        # Handle WebM files by converting first
        file_to_process = audio_file
        if audio_file.lower().endswith('.webm'):
            print("[transcribe] WebM file detected, converting to WAV...")
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_wav:
                converted_file = tmp_wav.name
            
            converted_file = convert_webm_to_wav(audio_file, converted_file)
            if not converted_file:
                raise Exception("Failed to convert WebM file")
            
            file_to_process = converted_file
            print(f"[transcribe] Converted to: {converted_file}")

        # Load audio with librosa
        print("[transcribe] Loading audio with librosa (sr=16000)...")
        try:
            audio_data, sampling_rate = librosa.load(file_to_process, sr=16000, mono=True)
        except Exception as e:
            print(f"Error loading audio with librosa: {e}")
            raise Exception(f"Could not load audio file: {file_to_process}")

        duration = len(audio_data) / sampling_rate
        print(f"[transcribe] Audio duration: {duration:.2f} seconds (sampling_rate={sampling_rate})")

        if len(audio_data) == 0:
            raise RuntimeError("Loaded audio is empty (length 0).")

        chunk_size = int(chunk_seconds * sampling_rate)
        transcription_parts = []

        total_chunks = (len(audio_data) + chunk_size - 1) // chunk_size
        print(f"[transcribe] Processing {total_chunks} chunks...")

        for i in range(0, len(audio_data), chunk_size):
            chunk = audio_data[i:min(i + chunk_size, len(audio_data))]

            # Skip extremely short tail chunks
            if len(chunk) < 0.5 * sampling_rate:
                if debug:
                    print(f"[transcribe] Skipping very small chunk at index {i} (len {len(chunk)} samples)")
                continue

            chunk_index = i // chunk_size + 1
            print(f"[transcribe] Processing chunk {chunk_index}/{total_chunks}: {(len(chunk) / sampling_rate):.2f}s")

            try:
                # Process chunk with Whisper
                inputs = processor(chunk, sampling_rate=sampling_rate, return_tensors="pt", padding=True)
                input_features = inputs.input_features.to(device)

                # Handle attention mask if available
                attention_mask = None
                if hasattr(inputs, "attention_mask"):
                    attention_mask = inputs.attention_mask.to(device)

                # Generate with forced decoder ids
                gen_kwargs = {"forced_decoder_ids": forced_decoder_ids, "max_length": 448}

                if attention_mask is not None:
                    predicted_ids = model.generate(input_features, attention_mask=attention_mask, **gen_kwargs)
                else:
                    predicted_ids = model.generate(input_features, **gen_kwargs)

                chunk_transcription = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
                
                if chunk_transcription.strip():  # Only add non-empty transcriptions
                    transcription_parts.append(chunk_transcription.strip())
                    if debug:
                        print(f"[transcribe] Chunk {chunk_index} transcription: {chunk_transcription[:100]}...")
                else:
                    if debug:
                        print(f"[transcribe] Chunk {chunk_index}: No speech detected")

            except Exception as e:
                print(f"Error processing chunk {chunk_index}: {e}")
                continue

        full_transcription = " ".join(transcription_parts).strip()

        if not full_transcription:
            return "No speech detected in the audio file."

        print(f"[transcribe] Transcription completed: {len(full_transcription)} characters")
        return full_transcription

    except Exception as e:
        print(f"Error transcribing {audio_file}: {e}")
        traceback.print_exc()
        return None
    finally:
        # Clean up converted file
        if converted_file and os.path.exists(converted_file):
            try:
                os.remove(converted_file)
                print(f"[transcribe] Cleaned up converted file: {converted_file}")
            except:
                pass

def process_audio_to_text(audio_file):
    """
    Complete pipeline: audio file -> transcription text
    No FFmpeg dependency - uses librosa directly
    """
    try:
        print(f"Starting transcription pipeline for: {audio_file}")
        
        # Check if input file exists
        if not os.path.exists(audio_file):
            raise Exception(f"Audio file not found: {audio_file}")
        
        file_size = os.path.getsize(audio_file)
        print(f"File size: {file_size} bytes")
        
        if file_size == 0:
            raise Exception("Input audio file is empty")
        
        # Check file extension
        file_extension = os.path.splitext(audio_file)[1].lower()
        print(f"Input file format: {file_extension}")
        
        # Transcribe directly - librosa can handle most formats including webm
        transcription = transcribe_audio_direct(audio_file)
        
        if not transcription or not transcription.strip():
            return "No speech detected in the audio file."
        
        return transcription.strip()
        
    except Exception as e:
        print(f"Error in transcription pipeline: {str(e)}")
        traceback.print_exc()
        return None

def test_transcription():
    """Test function to verify the transcription setup"""
    try:
        # Check if model exists
        model_path = "models/whisper-base"
        if not os.path.exists(model_path):
            print("Whisper model not found. Setting up...")
            if not setup_whisper_model():
                return False
        
        print("Whisper model found.")
        
        # Test librosa import
        import librosa
        print("Librosa import successful.")
        
        # Test torch
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        print(f"PyTorch device: {device}")
        
        # Test FFmpeg
        ffmpeg_working = test_ffmpeg()
        print(f"FFmpeg working: {ffmpeg_working}")
        
        return True
        
    except Exception as e:
        print(f"Test failed: {e}")
        return False

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <audio_file>")
        print("Or: python transcribe.py setup  # to download Whisper model")
        print("Or: python transcribe.py test   # to test setup")
        sys.exit(1)
    
    if sys.argv[1] == "setup":
        setup_whisper_model()
    elif sys.argv[1] == "test":
        test_transcription()
    else:
        audio_file = sys.argv[1]
        result = process_audio_to_text(audio_file)
        if result:
            print(f"\nFinal transcription:\n{result}")
        else:
            print("Transcription failed")