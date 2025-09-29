# main.py
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import tempfile
import uuid
from datetime import datetime
import json

from transcribe import process_audio_to_text

app = FastAPI(title="Meet Audio Transcriber", version="1.0.0")

# Add CORS middleware to allow extension requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to your extension's origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory storage for transcriptions
transcriptions_storage = {}

@app.get("/")
async def home():
    """Simple health check endpoint"""
    return {
        "status": "running",
        "service": "Meet Audio Transcriber",
        "endpoints": {
            "transcribe": "/transcribe",
            "get_transcription": "/transcription/{transcription_id}",
            "list_transcriptions": "/transcriptions"
        }
    }

@app.get("/test-ffmpeg")
async def test_ffmpeg_endpoint():
    """Test FFmpeg installation"""
    try:
        from transcribe import test_ffmpeg
        is_working = test_ffmpeg()
        return {
            "ffmpeg_working": is_working,
            "message": "FFmpeg is working properly" if is_working else "FFmpeg test failed"
        }
    except Exception as e:
        return {
            "ffmpeg_working": False,
            "error": str(e),
            "message": "FFmpeg test failed with error"
        }

@app.post("/transcribe")
async def transcribe_audio(audio_file: UploadFile = File(...)):
    """
    Transcribe uploaded audio file
    Expected file formats: webm, mp3, wav, mp4
    """
    temp_filename = None
    
    try:
        # Validate file type
        allowed_extensions = ['.webm', '.mp3', '.wav', '.mp4', '.m4a']
        file_extension = os.path.splitext(audio_file.filename)[1].lower()
        
        if file_extension not in allowed_extensions:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported file format. Allowed: {', '.join(allowed_extensions)}"
            )
        
        # Read file content
        content = await audio_file.read()
        
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        
        print(f"Processing audio file: {audio_file.filename} ({len(content)} bytes)")
        
        # Create temporary file with proper extension
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as temp_file:
            temp_filename = temp_file.name
            temp_file.write(content)
        
        print(f"Temporary file created: {temp_filename}")
        
        # Verify temp file was created
        if not os.path.exists(temp_filename):
            raise HTTPException(status_code=500, detail="Failed to create temporary file")
        
        temp_size = os.path.getsize(temp_filename)
        if temp_size == 0:
            raise HTTPException(status_code=500, detail="Temporary file is empty")
        
        print(f"Temporary file verified: {temp_size} bytes")
        
        # Process transcription
        transcription_text = process_audio_to_text(temp_filename)
        
        if not transcription_text:
            raise HTTPException(status_code=500, detail="Transcription failed - no text generated")
        
        if transcription_text.strip() == "":
            transcription_text = "No speech detected in the audio file."
        
        # Store transcription with unique ID
        transcription_id = str(uuid.uuid4())
        transcription_data = {
            "id": transcription_id,
            "filename": audio_file.filename,
            "text": transcription_text,
            "created_at": datetime.now().isoformat(),
            "length": len(transcription_text),
            "file_size": len(content)
        }
        
        transcriptions_storage[transcription_id] = transcription_data
        
        print(f"Transcription completed: {len(transcription_text)} characters")
        
        return JSONResponse({
            "success": True,
            "transcription_id": transcription_id,
            "text": transcription_text,
            "length": len(transcription_text),
            "filename": audio_file.filename,
            "created_at": transcription_data["created_at"]
        })
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Transcription error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    
    finally:
        # Clean up temp file
        if temp_filename and os.path.exists(temp_filename):
            try:
                os.remove(temp_filename)
                print(f"Cleaned up temporary file: {temp_filename}")
            except Exception as e:
                print(f"Warning: Could not clean up temporary file {temp_filename}: {e}")

@app.get("/transcription/{transcription_id}")
async def get_transcription(transcription_id: str):
    """Get a specific transcription by ID"""
    if transcription_id not in transcriptions_storage:
        raise HTTPException(status_code=404, detail="Transcription not found")
    
    return JSONResponse(transcriptions_storage[transcription_id])

@app.get("/transcriptions")
async def list_transcriptions():
    """List all stored transcriptions"""
    transcriptions = list(transcriptions_storage.values())
    # Sort by creation date, newest first
    transcriptions.sort(key=lambda x: x["created_at"], reverse=True)
    
    return JSONResponse({
        "transcriptions": transcriptions,
        "count": len(transcriptions)
    })

@app.delete("/transcription/{transcription_id}")
async def delete_transcription(transcription_id: str):
    """Delete a specific transcription"""
    if transcription_id not in transcriptions_storage:
        raise HTTPException(status_code=404, detail="Transcription not found")
    
    deleted_transcription = transcriptions_storage.pop(transcription_id)
    
    return JSONResponse({
        "success": True,
        "message": f"Transcription {transcription_id} deleted",
        "deleted_transcription": deleted_transcription
    })

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check if whisper model is available
        whisper_available = os.path.exists("models/whisper-base")
        
        return {
            "status": "healthy",
            "whisper_available": whisper_available,
            "stored_transcriptions": len(transcriptions_storage),
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

if __name__ == "__main__":
    import uvicorn
    print("Starting Meet Audio Transcriber backend...")
    print("Make sure you have the Whisper model in models/whisper-base/")
    uvicorn.run(app, host="0.0.0.0", port=8000)