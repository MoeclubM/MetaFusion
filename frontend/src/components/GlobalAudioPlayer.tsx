"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/lib/playerContext";
import { Play, Pause, Volume2, VolumeX, X, Disc3 } from "lucide-react";

export const GlobalAudioPlayer: React.FC = () => {
  const { currentTrack, isPlaying, togglePlay, closePlayer } = usePlayer();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, currentTrack]);

  if (!currentTrack) return null;

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const formatTime = (sec: number) => {
    if (isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-white/10 px-3 sm:px-4 py-2 sm:py-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <audio
        ref={audioRef}
        src={currentTrack.audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => togglePlay()}
        onLoadedMetadata={handleTimeUpdate}
      />

      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <div className="flex items-center justify-between gap-3 w-full sm:w-auto"><div className="flex items-center gap-2.5 min-w-0 flex-1 sm:min-w-[180px] sm:max-w-[240px]">
          <div className="w-8 h-8 rounded-card bg-background border border-white/10 flex-shrink-0 flex items-center justify-center overflow-hidden">
            {currentTrack.coverUrl ? (
              <img src={currentTrack.coverUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <Disc3 className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
            )}
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <h4 className="font-semibold text-white truncate text-xs">{currentTrack.title}</h4>
            <p className="text-[11px] text-gray-400 truncate font-mono">{currentTrack.artist || currentTrack.album}</p>
          </div>
          </div><div className="flex items-center gap-1.5 sm:hidden shrink-0"><button onClick={togglePlay} className="w-10 h-10 rounded-full bg-white text-black grid place-items-center active:scale-95">{isPlaying ? <Pause className="w-4 h-4 fill-black" strokeWidth={1.7} /> : <Play className="w-4 h-4 fill-black ml-0.5" strokeWidth={1.7} />}</button><button onClick={closePlayer} className="w-10 h-10 grid place-items-center rounded-full bg-white/[0.06] border border-white/10 text-gray-400"><X className="w-4 h-4" strokeWidth={1.6} /></button></div></div>

        <div className="flex items-center gap-2 sm:gap-3 w-full sm:flex-1 sm:max-w-xl">
          <button
            onClick={togglePlay}
            className="hidden sm:flex w-8 h-8 rounded-full bg-white text-black items-center justify-center shrink-0 hover:bg-gray-100 transition-colors"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-black" strokeWidth={1.7} /> : <Play className="w-3.5 h-3.5 fill-black ml-0.5" strokeWidth={1.7} />}
          </button>

          <span className="font-mono text-[11px] text-gray-500 w-10 text-right tabular-nums hidden sm:inline">{formatTime(currentTime)}</span><span className="font-mono text-[11px] text-gray-500 tabular-nums sm:hidden">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-2 sm:h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white touch-manipulation"
          />
          <span className="font-mono text-[11px] text-gray-500 w-10 tabular-nums">{formatTime(duration)}</span>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          <button onClick={toggleMute} className="w-8 h-8 grid place-items-center rounded-full bg-white/[0.06] border border-white/10 text-gray-400 hover:text-white transition-colors">
            {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" strokeWidth={1.5} /> : <Volume2 className="w-3.5 h-3.5" strokeWidth={1.5} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white hidden sm:block"
          />
          <button onClick={closePlayer} className="w-8 h-8 grid place-items-center rounded-full text-gray-500 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-3.5 h-3.5" strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </div>
  );
};
