import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { validateImageFile } from '../lib/storage';
import { Alert } from './ui-extras';

const DEFAULT_MAX_MB = 0.5;

export function PhotoUpload({ value, onChange, maxMb = DEFAULT_MAX_MB, circle = false }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const handleFile = (file) => {
    setError('');
    if (!file) return;
    const validation = validateImageFile(file, maxMb);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    const url = URL.createObjectURL(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(url);
    onChange(file);
  };

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
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
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <p className="text-xs text-slate-400">
        JPG or PNG, up to {maxMb} MB. {circle ? 'A square image works best.' : ''}
      </p>
      {error ? (
        <Alert tone="error" className="w-full">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}