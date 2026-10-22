import whisper
import json

audio_path = r"C:\Users\KOTB\.gemini\antigravity\brain\24544496-ce86-4841-8fcf-092d64789551\.user_uploaded\uploaded_media_1792550787235.wav"

print("Loading whisper model...")
model = whisper.load_model("base")
print("Transcribing audio...")
result = model.transcribe(audio_path, language="ar")

with open("scripts/voice_segments.json", "w", encoding="utf-8") as f:
    json.dump(result["segments"], f, ensure_ascii=False, indent=2)

for seg in result["segments"]:
    print(f"{seg['start']:6.2f} -> {seg['end']:6.2f}: {seg['text']}")
