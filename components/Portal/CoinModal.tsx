import React, { useEffect, useRef, useState } from 'react';
import { Rate } from '../../types';
import { io } from 'socket.io-client';
import { apiClient } from '../../lib/api';

interface Props {
  onClose: () => void;
  onSuccess: (pesos: number, minutes: number, mode: 'internet' | 'credit') => void;
  onCancelWithCredit?: (pesos: number, minutes: number) => void;
  rates: Rate[];
  audioSrc?: string;
  insertCoinAudioSrc?: string;
  selectedSlot?: string;
  coinSlot?: string;
  coinSlotLockId?: string;
}

const CoinModal: React.FC<Props> = ({
  onClose,
  onSuccess,
  onCancelWithCredit,
  rates,
  audioSrc,
  insertCoinAudioSrc,
  selectedSlot = 'main',
  coinSlot,
  coinSlotLockId
}) => {
  const [timeLeft, setTimeLeft] = useState(60);
  const [totalPesos, setTotalPesos] = useState(0);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const didAutoClose = useRef(false);
  const [mode, setMode] = useState<'internet' | 'credit'>('internet');

  const formatHMS = (minutes: number) => {
    const totalSeconds = minutes * 60;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);

    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    
    return parts.join(' ');
  };

  const calculateTotalMinutes = (pesos: number) => {
    if (!rates || rates.length === 0) return pesos * 10;

    let remaining = pesos;
    let minutes = 0;
    const sortedRates = [...rates].sort((a, b) => b.pesos - a.pesos);

    for (const rate of sortedRates) {
      if (rate.pesos <= 0) continue;
      const count = Math.floor(remaining / rate.pesos);
      if (count > 0) {
        minutes += count * rate.minutes;
        remaining -= count * rate.pesos;
      }
    }

    if (remaining > 0) {
      const smallestRate = sortedRates[sortedRates.length - 1];
      if (smallestRate && smallestRate.pesos > 0) {
        minutes += Math.floor((remaining / smallestRate.pesos) * smallestRate.minutes);
      } else {
        minutes += remaining * 10;
      }
    }

    return minutes;
  };

  // Handle Background Audio (Insert Coin Loop)
  useEffect(() => {
    let audio: HTMLAudioElement | null = null;
    if (insertCoinAudioSrc) {
      try {
        audio = new Audio(insertCoinAudioSrc);
        audio.loop = true;
        audio.volume = 0.5; // Slightly lower volume for background
        audio.play().catch(e => console.log('Background audio play failed', e));
      } catch (e) {
        console.error(e);
      }
    }
    return () => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [insertCoinAudioSrc]);

  

  useEffect(() => {
    console.log('[COIN] Connecting to Hardware Socket...');
    // Fix: Explicitly casting to 'any' because the Socket type in this environment is not correctly exposing the '.on' event emitter method.
    const socket: any = io(window.location.origin);

    socket.on('connect', () => {
      console.log('[COIN] Socket Connected to Gateway');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.warn('[COIN] Socket Disconnected');
      setIsConnected(false);
    });

    const handlePulse = (pesos: number) => {
      console.log(`[COIN] Received Pulse: ₱${pesos}`);
      
      // Play Audio
      if (audioSrc) {
        try {
          const audio = new Audio(audioSrc);
          audio.play().catch(e => console.log('Audio play failed', e));
        } catch (e) { console.error(e); }
      }

      setTotalPesos(prev => {
        const newTotal = prev + pesos;
        setTotalMinutes(calculateTotalMinutes(newTotal));
        return newTotal;
      });
      
      setTimeLeft(60); // Reset timeout on drop

      if (coinSlot && coinSlotLockId) {
        apiClient.heartbeatCoinSlot(coinSlot, coinSlotLockId).catch(() => {});
      }
    };

    socket.on('coin-pulse', (data: { pesos: number; totalPesos?: number; lockId?: string }) => {
      if (selectedSlot === 'main') {
        if (data.lockId && coinSlotLockId && data.lockId !== coinSlotLockId) return;
        if (typeof data.totalPesos === 'number') {
          setTotalPesos(data.totalPesos);
          setTotalMinutes(calculateTotalMinutes(data.totalPesos));
          setTimeLeft(60);
        } else {
          handlePulse(data.pesos);
        }
      }
    });

    socket.on('nodemcu-pulse', (data: { denomination: number, macAddress: string }) => {
      if (selectedSlot === data.macAddress) {
        handlePulse(data.denomination);
      }
    });

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, [rates, selectedSlot, audioSrc, coinSlot, coinSlotLockId]);

  useEffect(() => {
    if (!coinSlot || !coinSlotLockId) return;
    let cancelled = false;

    const heartbeat = async () => {
      try {
        const result = await apiClient.heartbeatCoinSlot(coinSlot, coinSlotLockId);
        if (cancelled || !result.success) return;
        if (typeof result.totalPesos === 'number') {
          setTotalPesos(result.totalPesos);
          setTotalMinutes(calculateTotalMinutes(result.totalPesos));
        }
      } catch (e) {}
    };

    heartbeat();
    const heartbeatTimer = setInterval(heartbeat, 2000);
    return () => {
      cancelled = true;
      clearInterval(heartbeatTimer);
    };
  }, [coinSlot, coinSlotLockId, rates]);

  useEffect(() => {
    if (timeLeft !== 0) return;
    if (didAutoClose.current) return;
    didAutoClose.current = true;
    onClose();
  }, [timeLeft, onClose]);

  const handleCancel = () => {
    if (totalPesos > 0 && onCancelWithCredit) {
      onCancelWithCredit(totalPesos, totalMinutes);
    } else {
      onClose();
    }
  };

  const handleConfirm = () => {
    if (mode === 'internet') {
      onSuccess(totalPesos, totalMinutes, mode);
    } else {
      onSuccess(totalPesos, 0, mode);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-in zoom-in duration-300 shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-blue-600 p-6 text-center">
          <h3 className="text-xl font-black text-white uppercase tracking-tight">
            {mode === 'internet' ? 'Insert Coins' : 'Add Credit'}
          </h3>
          <p className="text-[9px] font-bold text-blue-100 uppercase tracking-[0.2em]">
            {coinSlot === 'main' ? 'Main Machine' : 'Remote Vendo'}
          </p>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-col gap-4">
            <div className="bg-slate-50 p-4 rounded-3xl text-center border border-slate-100 shadow-inner">
              <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Total Amount</span>
              <span className="text-4xl font-black text-slate-900 tracking-tighter">₱{totalPesos}</span>
            </div>
            
            {mode === 'internet' && (
              <div className="bg-slate-50 p-4 rounded-3xl text-center border border-slate-100 shadow-inner">
                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Total Time</span>
                <span className="text-3xl font-black text-slate-900 tracking-tighter whitespace-nowrap">{formatHMS(totalMinutes)}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => setMode('internet')}
              className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.18em] border ${
                mode === 'internet'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              Surf Internet
            </button>
            <button
              type="button"
              onClick={() => setMode('credit')}
              className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.18em] border ${
                mode === 'credit'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              Save as Credit
            </button>
          </div>
        </div>

          <div className="space-y-3">
            <button
              onClick={handleConfirm}
              disabled={totalPesos <= 0}
              className="admin-btn-primary w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <span>🚀</span> {mode === 'internet' ? 'Start Surfing' : 'Confirm Credit'}
            </button>
            
            <button
              onClick={handleCancel}
              className="w-full py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
  );
};

export default CoinModal;
