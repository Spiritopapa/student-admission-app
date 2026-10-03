import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { validateImageFile, optimizeImageFile } from '../lib/storage';
import { Alert } from './ui-extras';

const DEFAULT_MAX_MB = 0.5; // recommended output size for uploaded photos
const DEFAULT_RAW_MAX_MB = 10; // raw input accepted before automatic compression

export function PhotoUpload({ value, onChange, maxMb = DEFAULT_MAX_MB, circle = false, optimize = true, camera = true }) {
  const inputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);

  const previewOf = (file) => {
    const url = URL.createObjectURL(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(url);
  };

  const handleFile = async (file) => {
    setError('');
    setNote('');
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    const rawBytes = DEFAULT_RAW_MAX_MB * 1024 * 1024;
    if (file.size > rawBytes) {
      setError(
        `Photo is too large (${(file.size / 1048576).toFixed(1)} MB). Please use a photo under ${DEFAULT_RAW_MAX_MB} MB — it is compressed automatically before upload.`
      );
      return;
    }
    let finalFile = file;
    if (optimize) {
      try {
        const result = await optimizeImageFile(file, { maxMb });
        finalFile = result.file || file;
        if (result.optimized) {
          setNote(`Photo compressed ${(file.size / 1024).toFixed(0)} KB -> ${(finalFile.size / 1024).toFixed(0)} KB`);
        }
      } catch (err) {
        finalFile = file;
      }
    }
    const validation = validateImageFile(finalFile, maxMb);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    previewOf(finalFile);
    onChange(finalFile);
  };

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setNote('');
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  /* ----------------------------- camera ----------------------------- */
  const stopCamera = () => {
    try {
      const stream = streamRef.current;
      if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (err) {
            // ignore
          }
        });
      }
    } catch (err) {
      // ignore
    }
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      try {
        video.srcObject = null;
      } catch (err) {
        // ignore
      }
    }
    setCameraOpen(false);
  };

  const startCamera = async (facing = 'environment') => {
    if (!camera) return;
    setCameraError('');
    setCameraBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera capture not supported here.');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: facing === 'user' ? { facingMode: 'user' } : true,
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      setCameraOpen(true);
    } catch (err) {
      // Not supported / permission denied -> hand over to the device camera app.
      setCameraError('In-app camera preview unavailable — your device camera was opened instead.');
      if (cameraInputRef.current) cameraInputRef.current.click();
    } finally {
      setCameraBusy(false);
    }
  };
const capture = () => {
    const video = videoRef.current;
    if (!video || cameraBusy) return;
    const vw = Number(video.videoWidth || 0) || Number(video.width || 0) || 0;
    const vh = Number(video.videoHeight || 0) || Number(video.height || 0) || 0;
    if (!vw || !vh) {
      setCameraError('The camera preview is not ready yet — please try again.');
      return;
    }
    setCameraBusy(true);
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    const emit = () => {
      canvas.toBlob((blob) => {
        if (!blob) {
          setCameraError('Could not capture the photo on this device.');
          setCameraBusy(false);
          return;
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopCamera();
        setCameraBusy(false);
        handleFile(file);
      }, 'image/jpeg', 0.85);
    };
    try {
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(video).then(
          (bmp) => {
            ctx.drawImage(bmp, 0, 0, vw, vh);
            emit();
          },
          () => {
            ctx.drawImage(video, 0, 0, vw, vh);
            emit();
          }
        );
      } else {
        ctx.drawImage(video, 0, 0, vw, vh);
        emit();
      }
    } catch (err) {
      try {
        ctx.drawImage(video, 0, 0, vw, vh);
        emit();
      } catch (err2) {
        setCameraError('Could not capture the photo on this device.');
        setCameraBusy(false);
      }
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`group relative flex items-center justify-center overflow-hidden border-2 border-dashed border-slate-300 bg-slate-100 text-slate-400 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-500 ${
            circle ? 'h-28 w-28 rounded-full' : 'h-32 w-28 rounded-xl'
          }`}
          aria-label="Upload photo"
        >
          {preview ? (
            <img
              src={preview}
              alt="Photo preview"
              className={`h-full w-full object-cover ${circle ? 'rounded-full' : 'rounded-lg'}`}
            />
          ) : value && typeof value === 'string' ? (
            <img
              src={value}
              alt="Photo preview"
              className={`h-full w-full object-cover ${circle ? 'rounded-full' : 'rounded-lg'}`}
            />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <Camera className="h-6 w-6" aria-hidden="true" />
              <span className="px-1 text-[10px] font-medium">Add photo</span>
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 opacity-0 transition-opacity group-hover:bg-slate-900/30 group-hover:opacity-100">
            <span className="badge bg-white/90 text-slate-700">Change</span>
          </span>
        </button>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {camera ? (
            <button
              type="button"
              onClick={() => startCamera('environment')}
              disabled={cameraBusy}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              Take photo
            </button>
          ) : null}
          {(preview || value) && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Remove photo
            </button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {camera ? (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      ) : null}
      <p className="text-xs text-slate-400">
        JPG or PNG — photos are compressed automatically to keep uploads under {maxMb} MB.
        {circle ? ' A square image works best.' : ''}
      </p>
      {note ? <p className="text-xs font-medium text-emerald-600">{note}</p> : null}
      {error ? (
        <Alert tone="error" className="w-full">
          {error}
        </Alert>
      ) : null}
{cameraOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
            <p className="text-sm font-bold text-slate-700">Take a photo</p>
            <p className="mt-0.5 text-xs text-slate-400">Position the face in the frame, then press Capture.</p>
            {cameraError ? (
              <Alert tone="error" className="mt-2 w-full">
                {cameraError}
              </Alert>
            ) : null}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="mt-3 w-full rounded-xl bg-slate-950"
              style={{ aspectRatio: '3 / 4' }}
            />
            <div className="mt-3 grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => startCamera('user')}
                disabled={cameraBusy}
                className="rounded-lg px-1 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Front
              </button>
              <button
                type="button"
                onClick={() => startCamera('environment')}
                disabled={cameraBusy}
                className="rounded-lg px-1 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Rear
              </button>
              <button
                type="button"
                onClick={capture}
                disabled={cameraBusy}
                className="rounded-lg bg-brand-600 px-1 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Capture
              </button>
              <button
                type="button"
                onClick={stopCamera}
                className="rounded-lg px-1 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}