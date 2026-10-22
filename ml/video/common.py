"""Video helpers: bounded probing and frame extraction via ffmpeg (untrusted input: no stdin, hard timeouts, frame/size caps)."""
import io, json, os, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "audio"))
from audio_common import MediaError, find_tool  # noqa: E402  (shared ffmpeg discovery + error type)

MAX_SIDE = 640  # frames are downscaled so their longest side is at most this; the model processor resizes further


def probe_video(path: str, timeout=20) -> dict:
    """-> {duration, width, height}. Raises MediaError if there is no decodable video stream."""
    try:
        out = subprocess.run([find_tool("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration:format=duration",
                              "-of", "json", path], capture_output=True, text=True, timeout=timeout)
        j = json.loads(out.stdout or "{}")
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        raise MediaError("Could not read the video (it may be corrupt).")
    streams = j.get("streams") or []
    if not streams: raise MediaError("No video track was found in this file.")
    s = streams[0]
    try:
        dur = float(s.get("duration") or j.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        raise MediaError("Could not determine the video length (the file may be corrupt).")
    if not (dur > 0): raise MediaError("The video is empty.")
    w, h = int(s.get("width") or 0), int(s.get("height") or 0)
    if min(w, h) < 32: raise MediaError("The video resolution is too small to analyse.")
    return {"duration": dur, "width": w, "height": h}


def extract_frames(path: str, duration: float, n_frames: int, per_frame_timeout=30):
    """Evenly spaced still frames (centres of n equal segments) as PIL RGB images."""
    from PIL import Image
    frames = []
    for i in range(n_frames):
        t = duration * (i + 0.5) / n_frames
        cmd = [find_tool("ffmpeg"), "-nostdin", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1",
               "-vf", f"scale='if(gt(iw,ih),min(iw,{MAX_SIDE}),-2)':'if(gt(iw,ih),-2,min(ih,{MAX_SIDE}))'", "-f", "image2pipe", "-vcodec", "png", "-"]
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=per_frame_timeout)
        except subprocess.TimeoutExpired:
            raise MediaError("Decoding the video took too long (it may be corrupt).")
        if out.returncode == 0 and out.stdout:
            frames.append(Image.open(io.BytesIO(out.stdout)).convert("RGB"))
    if len(frames) < max(2, n_frames // 2): raise MediaError("Too few frames could be decoded; the video may be corrupt or use an unsupported codec.")
    return frames
