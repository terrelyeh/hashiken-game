import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';

const HashikenGame = () => {
  // 遊戲狀態加入 'boot' 作為音訊授權與載入首頁
  const [gameState, setGameState] = useState('boot'); 
  const [playerRole, setPlayerRole] = useState('');
  const [cpuRole, setCpuRole] = useState('');
  const [playerWins, setPlayerWins] = useState(0);
  const [cpuWins, setCpuWins] = useState(0);
  const [playerChoice, setPlayerChoice] = useState(null);
  const [cpuChoice, setCpuChoice] = useState(null);
  const [roundResult, setRoundResult] = useState(''); 
  const [totalChopsticks, setTotalChopsticks] = useState(0);
  
  const [dialogueStep, setDialogueStep] = useState(0); 
  
  const [isBgmPlaying, setIsBgmPlaying] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true); 
  const [aiLoadedStatus, setAiLoadedStatus] = useState('loading'); // 'loading', 'ready', 'error'
  const [isShaking, setIsShaking] = useState(false);

  // Refs: 分離 BGM 與 SFX/Voice 引擎，確保互不干擾且能強制摧毀
  const bgmCtxRef = useRef<AudioContext | null>(null);
  const bgmIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rawVoiceBuffersRef = useRef<Record<string, ArrayBuffer> | null>(null);
  const voiceBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const playerHistoryRef = useRef<number[]>([]);
  const skipRef = useRef(false);

  // 初始化主音效引擎 (必須在使用者點擊時觸發)
  const initAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  // 拍子木音效 (清脆)
  const playClack = () => {
    if (!soundEnabled || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
  };

  // 太鼓音效 (震撼)
  const playTaiko = (heavy = false) => {
    if (!soundEnabled || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 90 : 140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(heavy ? 0.9 : 0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  };

  // BGM 引擎：獨立運行，強制銷毀防重疊
  const toggleBGM = () => {
    // 1. 強制清除並銷毀舊音軌
    if (bgmIntervalRef.current) {
      clearInterval(bgmIntervalRef.current);
      bgmIntervalRef.current = null;
    }
    if (bgmCtxRef.current) {
      bgmCtxRef.current.close();
      bgmCtxRef.current = null;
    }

    if (!isBgmPlaying) {
      // 2. 建立全新音軌
      bgmCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = bgmCtxRef.current;
      
      let nextNoteTime = ctx.currentTime + 0.1;
      let step = 0;
      
      const schedule = () => {
        if (ctx.state === 'closed') return;
        while (nextNoteTime < ctx.currentTime + 0.2) {
          if (step % 8 === 0 || step % 8 === 3 || step % 8 === 6) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(step % 8 === 0 ? 80 : 120, nextNoteTime);
            osc.frequency.exponentialRampToValueAtTime(30, nextNoteTime + 0.2);
            gain.gain.setValueAtTime(0.25, nextNoteTime);
            gain.gain.exponentialRampToValueAtTime(0.01, nextNoteTime + 0.2);
            osc.start(nextNoteTime); osc.stop(nextNoteTime + 0.2);
          }
          const melody = [329.63, 349.23, 440, 493.88, 523.25, 440, 349.23, 329.63];
          if (step % 2 === 0) {
            const noteFreq = melody[(step / 2) % melody.length];
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(noteFreq, nextNoteTime);
            gain.gain.setValueAtTime(0.08, nextNoteTime);
            gain.gain.exponentialRampToValueAtTime(0.01, nextNoteTime + 0.3);
            osc.start(nextNoteTime); osc.stop(nextNoteTime + 0.3);
          }
          step++;
          nextNoteTime += 0.16;
        }
      };
      
      bgmIntervalRef.current = setInterval(schedule, 50);
      setIsBgmPlaying(true);
    } else {
      setIsBgmPlaying(false);
    }
  };

  // 平行背景下載 AI 真人語音 (加入重試機制與安全字眼修正)
  const fetchVoice = async (phrase: { key: string, text: string }) => {
    const cached = localStorage.getItem(`hashiken_voice_${phrase.key}`);
    if (cached) {
      const binary = atob(cached);
      const buffer = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
      return buffer;
    }

    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY");
      return null;
    }
    
    const ai = new GoogleGenAI({ apiKey });

    const delays = [1000, 2000, 4000];
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: `Say very loudly, forcefully, and energetically in Japanese: ${phrase.text}!` }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } }
          }
        });
        
        const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64) {
          const binary = atob(base64);
          const buffer = new ArrayBuffer(44 + binary.length);
          const view = new DataView(buffer);
          const writeString = (offset: number, str: string) => { for(let i=0; i<str.length; i++) view.setUint8(offset+i, str.charCodeAt(i)); };
          writeString(0, 'RIFF'); view.setUint32(4, 36 + binary.length, true);
          writeString(8, 'WAVE'); writeString(12, 'fmt '); view.setUint32(16, 16, true);
          view.setUint16(20, 1, true); view.setUint16(22, 1, true);
          view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
          view.setUint16(32, 2, true); view.setUint16(34, 16, true);
          writeString(36, 'data'); view.setUint32(40, binary.length, true);
          for (let i=0; i<binary.length; i++) view.setUint8(44+i, binary.charCodeAt(i));
          
          let binaryWav = '';
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.byteLength; i++) {
              binaryWav += String.fromCharCode(bytes[i]);
          }
          try {
            localStorage.setItem(`hashiken_voice_${phrase.key}`, btoa(binaryWav));
          } catch (e) {
            console.warn("localStorage full, skipping cache");
          }

          return buffer;
        }
      } catch (e) {
        console.error("Voice fetch error:", e);
        if (attempt === 3) return null;
        await new Promise(r => setTimeout(r, delays[attempt]));
      }
    }
    return null;
  };

  // 解碼音訊並載入記憶體
  const decodeVoices = async () => {
    if (!audioCtxRef.current || !rawVoiceBuffersRef.current) return;
    const temp = rawVoiceBuffersRef.current;
    for (let key in temp) {
      if (!voiceBuffersRef.current[key]) {
        try {
          const buf = await audioCtxRef.current.decodeAudioData(temp[key].slice(0));
          voiceBuffersRef.current[key] = buf;
        } catch(e) { console.error("Decode error:", e); }
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadAllVoices = async () => {
      const phrases = [
        { key: 'irasshai', text: 'いらっしゃい' },
        { key: 'sanbon', text: 'さんぼん' },
        { key: 'ippon', text: 'いっぽん' },
        { key: 'gohon', text: 'ごほん' },
        { key: 'win', text: '俺の勝ちだ' },
        { key: 'lose', text: '負けた' },
        { key: 'round_win', text: '勝負あり' },
        { key: 'round_lose', text: 'やられた' },
        { key: 'round_draw', text: 'もう一回' }
      ];

      // 平行加速下載 6 句語音
      const results = await Promise.all(phrases.map(async p => ({ key: p.key, buf: await fetchVoice(p) })));
      
      if (!isMounted) return;
      
      let successCount = 0;
      const tempMap: Record<string, ArrayBuffer> = {};
      for (const res of results) {
        if (res.buf) {
          tempMap[res.key] = res.buf;
          successCount++;
        }
      }

      if (successCount === 9) {
        rawVoiceBuffersRef.current = tempMap;
        setAiLoadedStatus('ready');
        // 若使用者已經等不及按了入座，直接觸發解碼
        if (audioCtxRef.current) decodeVoices();
      } else {
        setAiLoadedStatus('error');
      }
    };
    loadAllVoices();
    return () => { isMounted = false; };
  }, []);

  // 入座啟動：解碼語音、啟動音樂
  const handleBoot = async () => {
    initAudioCtx();
    if (!isBgmPlaying) toggleBGM();
    
    if (rawVoiceBuffersRef.current) {
      decodeVoices();
    }
    setGameState('intro');
  };

  // 完美同步的底層語音播放器
  const playVoiceAsync = (phraseKey: string, pitch = 1.0) => {
    const playPromise = new Promise<void>((resolve) => {
      if (!soundEnabled || !audioCtxRef.current) return resolve();
      const ctx = audioCtxRef.current;
      
      if (voiceBuffersRef.current[phraseKey]) {
        const source = ctx.createBufferSource();
        source.buffer = voiceBuffersRef.current[phraseKey];
        source.playbackRate.value = pitch > 1.0 ? 1.15 : 1.0; 
        source.connect(ctx.destination);
        source.onended = () => resolve(); // 絕對保證聽完才 resolve
        source.start();
      } 
      else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const texts: Record<string, string> = { 
          irasshai: 'いらっしゃい！', sanbon: 'さんぼん！', ippon: 'いっぽん！', gohon: 'ごほん！',
          win: '俺の勝ちだ！', lose: '負けた！', round_win: '勝負あり！', round_lose: 'やられた！', round_draw: 'もう一回！'
        };
        const utterance = new SpeechSynthesisUtterance(texts[phraseKey]);
        utterance.lang = 'ja-JP'; utterance.pitch = pitch; utterance.rate = 1.3;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      } else {
        resolve();
      }
    });

    // 最大等待防呆機制 (4秒)
    const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 4000));
    return Promise.race([playPromise, timeoutPromise]);
  };

  const handleRPS = () => {
    playTaiko(true);
    const isPlayerSente = Math.random() > 0.5; 
    setPlayerRole(isPlayerSente ? 'sente' : 'gote');
    setCpuRole(isPlayerSente ? 'gote' : 'sente');
    setGameState('playing');
  };

  const getGoteShout = (choice: number | null) => {
    if (choice === 0 || choice === 1) return 1;
    if (choice === 2 || choice === 3) return 5;
    return 0;
  };

  const handlePlay = (choice: number) => {
    playClack();
    setPlayerChoice(choice as any);
    
    playerHistoryRef.current.push(choice);
    if (playerHistoryRef.current.length > 5) playerHistoryRef.current.shift();

    let cChoice = Math.floor(Math.random() * 4);
    
    // 簡單心理戰 AI
    if (cpuRole === 'gote') {
      const lastPlayerMove = playerHistoryRef.current[playerHistoryRef.current.length - 2] ?? 1;
      const safeChoices = [0, 1, 2, 3].filter(c => c + lastPlayerMove !== 3);
      if (safeChoices.length > 0 && Math.random() > 0.3) {
        cChoice = safeChoices[Math.floor(Math.random() * safeChoices.length)];
      }
    } else {
      const lastPlayerMove = playerHistoryRef.current[playerHistoryRef.current.length - 2] ?? 1;
      const winningChoice = 3 - lastPlayerMove;
      if (winningChoice >= 0 && winningChoice <= 3 && Math.random() > 0.3) {
        cChoice = winningChoice;
      }
    }

    setCpuChoice(cChoice as any);
    const total = choice + cChoice;
    setTotalChopsticks(total);
    
    let winner = 'draw';
    if (total === 3) winner = playerRole === 'sente' ? 'player' : 'cpu';
    else if (total === 1 || total === 5) winner = playerRole === 'gote' ? 'player' : 'cpu';
    
    setRoundResult(winner);
    setGameState('round_result');
  };

  // 最核心：保證完美的語音等待接力順序
  useEffect(() => {
    let isCancelled = false;

    if (gameState === 'round_result') {
      const runDialogueSequence = async () => {
        const goteIsPlayer = playerRole === 'gote';
        const senteIsPlayer = playerRole === 'sente';
        const goteShoutNum = getGoteShout(goteIsPlayer ? playerChoice : cpuChoice);
        
        const gotePitch = goteIsPlayer ? 1.0 : 1.3;
        const sentePitch = senteIsPlayer ? 1.0 : 1.3;

        // 1. 後手：放馬過來
        if (isCancelled) return;
        setDialogueStep(1); 
        if (!skipRef.current) await playVoiceAsync('irasshai', gotePitch);
        
        if (isCancelled) return;
        if (!skipRef.current) await new Promise(r => setTimeout(r, 100)); // 呼吸間隔

        // 2. 先手：敲鼓 + 喊三本
        if (isCancelled) return;
        setDialogueStep(2); 
        if (!skipRef.current) playTaiko(); 
        if (!skipRef.current) await playVoiceAsync('sanbon', sentePitch); 
        
        if (isCancelled) return;
        if (!skipRef.current) await new Promise(r => setTimeout(r, 100)); 

        // 3. 後手：敲鼓 + 迎擊
        if (isCancelled) return;
        setDialogueStep(3); 
        if (!skipRef.current) playTaiko(); 
        if (!skipRef.current) await playVoiceAsync(goteShoutNum === 1 ? 'ippon' : 'gohon', gotePitch); 

        if (isCancelled) return;
        if (!skipRef.current) await new Promise(r => setTimeout(r, 300)); // 攤牌前的緊張感

        // 4. 重磅太鼓與開獎
        if (isCancelled) return;
        setDialogueStep(4); 
        playTaiko(true); 
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 300);
        if (roundResult === 'player') setPlayerWins(prev => prev + 1);
        else if (roundResult === 'cpu') setCpuWins(prev => prev + 1);

        // 5. 回合結果語音
        if (isCancelled) return;
        if (!skipRef.current) {
          if (roundResult === 'player') await playVoiceAsync('round_win', 1.0);
          else if (roundResult === 'cpu') await playVoiceAsync('round_lose', 1.0);
          else await playVoiceAsync('round_draw', 1.0);
        }
      };

      runDialogueSequence();
    } else {
      setDialogueStep(0);
    }

    return () => { isCancelled = true; };
  }, [gameState]); 

  useEffect(() => {
    if (dialogueStep === 4 && (playerWins >= 2 || cpuWins >= 2)) {
      setTimeout(() => {
        playTaiko(true);
        setTimeout(() => playTaiko(true), 300);
        setGameState('game_over');
        if (playerWins >= 2) {
          playVoiceAsync('lose', 1.0);
        } else {
          playVoiceAsync('win', 1.0);
        }
      }, 1500);
    }
  }, [playerWins, cpuWins, dialogueStep]);

  const resetRound = () => { playClack(); setPlayerChoice(null); setCpuChoice(null); setGameState('playing'); skipRef.current = false; };
  const restartGame = () => { setGameState('intro'); setPlayerWins(0); setCpuWins(0); setPlayerChoice(null); setCpuChoice(null); skipRef.current = false; };

  const renderChopsticks = (count: number | null, direction = 'up', isHidden = false) => {
    if (isHidden) return <div className="text-4xl py-1 opacity-60 animate-pulse">✊</div>;
    const sticks = [];
    for (let i = 0; i < (count || 0); i++) {
      sticks.push(<div key={i} className={`w-3 h-20 bg-gradient-to-b from-red-600 to-red-900 rounded-full mx-1 shadow-lg border-2 border-red-900 transform ${direction === 'down' ? 'rotate-[170deg]' : 'rotate-6'}`}></div>);
    }
    return (
      <div className="flex h-24 items-center justify-center min-w-[80px] bg-[#f8f0d8] rounded-xl p-2 border-2 border-dashed border-amber-400 shadow-inner">
        {count === 0 ? <span className="text-stone-400 font-black text-lg">空手 (0)</span> : sticks}
      </div>
    );
  };

  const renderMiniChopsticks = (count: number) => {
    const sticks = [];
    for (let i = 0; i < count; i++) {
      sticks.push(<div key={i} className="w-1.5 h-10 bg-gradient-to-b from-red-600 to-red-900 rounded-full mx-0.5 shadow-sm transform rotate-6"></div>);
    }
    return (
      <div className="flex h-12 items-center justify-center min-w-[40px]">
        {count === 0 ? <span className="text-stone-400 font-bold text-xs">空</span> : sticks}
      </div>
    );
  };

  // === 啟動授權頁 (解決瀏覽器音訊阻擋) ===
  if (gameState === 'boot') {
    return (
      <div className="h-screen w-full bg-[#1c1b1a] flex flex-col items-center justify-center px-4 font-sans text-stone-200">
        <div className="text-7xl mb-6 drop-shadow-lg">🏮</div>
        <h1 className="text-3xl font-black text-amber-500 tracking-widest mb-2">土佐箸拳</h1>
        <p className="text-stone-400 text-sm mb-12">高知無形文化財・酒宴對決模擬</p>
        
        <div className="mb-6 text-center min-h-[40px]">
          {aiLoadedStatus === 'loading' && <p className="text-amber-400 animate-pulse font-bold text-sm">⏳ 正在連線召喚酒館大叔... (約需2秒)</p>}
          {aiLoadedStatus === 'ready' && <p className="text-green-500 font-bold text-sm">✅ 大叔已就緒！</p>}
          {aiLoadedStatus === 'error' && <p className="text-red-400 font-bold text-sm">⚠️ 連線超時，將採用機器人語音</p>}
        </div>

        <button 
          onClick={handleBoot}
          disabled={aiLoadedStatus === 'loading'}
          className={`font-black text-xl py-4 px-10 rounded-xl shadow-[0_6px_0_rgb(80,15,15)] transition-all flex items-center gap-3 ${aiLoadedStatus === 'loading' ? 'bg-stone-600 text-stone-400 cursor-wait shadow-[0_6px_0_rgb(60,60,60)]' : 'bg-[#8b2323] hover:bg-[#a52a2a] text-white active:translate-y-[6px] active:shadow-[0_0px_0_rgb(80,15,15)] animate-bounce-in'}`}
        >
          {aiLoadedStatus === 'loading' ? '等候語音載入中...' : '入座並開啟音效 🍶'}
        </button>

        {aiLoadedStatus === 'loading' && (
          <button onClick={handleBoot} className="mt-6 text-stone-500 text-xs underline hover:text-stone-400 transition-colors">
            不想等了，先以純音效開始
          </button>
        )}
      </div>
    );
  }

  // === 遊戲主畫面 ===
  return (
    <div className="h-screen w-full bg-[#2c2b29] flex flex-col items-center justify-center py-2 px-2 font-sans text-stone-800 overflow-hidden">
      <div className={`w-full max-w-md bg-stone-100 rounded-3xl shadow-2xl border-4 border-[#8c7e63] relative flex flex-col h-[95vh] max-h-[850px] overflow-hidden ${isShaking ? 'animate-shake' : ''}`}>
        
        {/* Header 控制列 */}
        <div className="bg-[#1c1b1a] p-3 flex justify-between items-center shadow-lg relative z-20 border-b-2 border-[#8c7e63] shrink-0">
          <button onClick={toggleBGM} className={`text-xs font-bold py-1.5 px-3 rounded-lg shadow-inner transition-colors flex items-center gap-1 ${isBgmPlaying ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-stone-700 text-stone-300 hover:bg-stone-600'}`}>
            🎵 BGM
          </button>
          
          <h1 className="text-lg font-black tracking-widest text-amber-500 mx-2">土佐箸拳</h1>
          
          <button onClick={restartGame} className="text-xs font-bold py-1.5 px-3 rounded-lg bg-[#8b2323] hover:bg-[#a52a2a] text-white shadow-inner transition-colors flex items-center gap-1">
            🔄 重來
          </button>
        </div>

        {/* 主要內容區 */}
        <div 
          className="flex-1 overflow-y-auto bg-[url('https://www.transparenttextures.com/patterns/rice-paper.png')] bg-stone-100 p-3 flex flex-col"
          onClick={() => { if (gameState === 'round_result' && dialogueStep < 4) skipRef.current = true; }}
        >
          
          {gameState === 'intro' && (
            <div className="space-y-4 text-center animate-fade-in py-4 my-auto">
              <div className="text-6xl mb-2 drop-shadow-md">🍶</div>
              <h2 className="text-2xl font-black text-[#6b1e1e]">高知座敷遊戯</h2>
              <div className="bg-[#f8f0d8] border-2 border-[#8c7e63] p-4 rounded-xl text-left shadow-sm mt-4">
                <p className="text-sm text-stone-700 font-bold mb-2">🔥 居酒屋對戰須知：</p>
                <ol className="text-xs space-y-2 text-[#4a453b] font-medium list-decimal pl-4">
                  <li>語音系統已啟動，對戰節奏會自動配合大叔的喊聲。</li>
                  <li>後手喊完<strong className="text-blue-700">「Irasshai」</strong>後，會敲響太鼓。</li>
                  <li>接著先手喊出<strong className="text-red-700">「Sanbon」</strong>，最後後手迎擊！</li>
                </ol>
              </div>
              <div className="mt-6">
                <button onClick={() => { playTaiko(); setGameState('rps'); }} className="w-full bg-[#8b2323] hover:bg-[#a52a2a] text-white font-black text-lg py-4 rounded-xl shadow-[0_6px_0_rgb(80,15,15)] active:translate-y-[6px] active:shadow-[0_0px_0_rgb(80,15,15)] transition-all">
                  ⚔️ 開始猜拳
                </button>
              </div>
            </div>
          )}

          {gameState === 'rps' && (
            <div className="text-center space-y-8 animate-fade-in py-12 my-auto">
              <h2 className="text-2xl font-black text-stone-800">猜拳決定先後手</h2>
              <div className="flex justify-center gap-4">
                {['rock', 'scissors', 'paper'].map((hand) => {
                  const emojis: Record<string, string> = {'rock': '✊', 'scissors': '✌️', 'paper': '🖐️'};
                  return (
                    <button key={hand} onClick={handleRPS} className="w-20 h-20 bg-white border-4 border-stone-400 rounded-full shadow-lg hover:border-red-600 text-4xl active:scale-90 transition-all flex justify-center items-center">
                      {emojis[hand]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {(gameState === 'playing' || gameState === 'round_result') && (
            <div className="flex flex-col flex-1 justify-between animate-fade-in -mx-1 h-full gap-2">
              
              <div className={`p-3 rounded-2xl border-b-4 border-x-4 shadow-sm relative flex flex-col items-center shrink-0 ${cpuRole === 'sente' ? 'bg-[#ffedb3] border-[#d1a624]' : 'bg-[#d6eaff] border-[#5591d1]'}`}>
                <div className={`absolute -top-4 left-1/2 transform -translate-x-1/2 text-white px-5 py-1 rounded-full text-sm font-black shadow-lg border-2 border-white z-20 flex items-center gap-2 whitespace-nowrap ${cpuRole === 'sente' ? 'bg-[#c75e14]' : 'bg-[#1b5e9c]'}`}>
                  <span>👺 對手 ({cpuRole === 'sente' ? '先手' : '後手'})</span>
                  <span className="bg-black/30 px-2 py-0.5 rounded-full text-xs">勝: {cpuWins}</span>
                </div>
                <div className="mt-3 mb-1">
                  {gameState === 'playing' ? renderChopsticks(0, 'down', true) : (dialogueStep >= 4 ? renderChopsticks(cpuChoice, 'down') : renderChopsticks(0, 'down', true))}
                </div>
                {(gameState === 'round_result' && dialogueStep >= 1) && (
                  <div className="bg-white border-2 border-stone-300 px-3 py-1.5 rounded-xl rounded-tr-none shadow-md text-base font-black text-stone-800 animate-slide-in relative">
                    {cpuRole === 'gote' && dialogueStep === 1 && "「イラッシャイ！」"}
                    {cpuRole === 'sente' && dialogueStep === 2 && "「3本！！」"}
                    {cpuRole === 'gote' && dialogueStep === 3 && `「${getGoteShout(cpuChoice)}本！！」`}
                    {(cpuRole === 'sente' && dialogueStep === 3) || (cpuRole === 'gote' && dialogueStep === 2) ? "..." : ""}
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col items-center justify-center relative min-h-[100px]">
                <div className="w-full h-1 bg-[#8c7e63] absolute top-1/2 transform -translate-y-1/2 -z-10 shadow-sm opacity-50"></div>
                {gameState === 'playing' && (
                  <div className="bg-[#2c2b29] text-amber-400 font-bold px-4 py-1.5 rounded-full border-2 border-stone-900 shadow-md text-sm animate-pulse flex flex-col items-center">
                    <span>輪到你出拳...</span>
                    <span className="text-xs text-stone-300 mt-0.5">
                      {playerRole === 'sente' ? '🔥 目標：雙方總和為 3' : '🛡️ 目標：雙方總和為 1 或 5'}
                    </span>
                  </div>
                )}
                {gameState === 'round_result' && dialogueStep >= 4 && (
                  <div className="bg-[#1c1b1a] text-white border-4 border-[#c75e14] rounded-xl p-3 shadow-xl text-center z-10 animate-bounce-in w-10/12 max-w-[280px]">
                    <div className="text-[10px] text-stone-400 font-bold mb-1">雙方總和</div>
                    <div className="text-4xl font-black text-amber-400 mb-2">{totalChopsticks} <span className="text-xl">本</span></div>
                    <div className="text-sm font-black bg-stone-800 rounded py-1 mb-2">
                      {roundResult === 'player' && <span className="text-green-400">🎉 你的勝利！</span>}
                      {roundResult === 'cpu' && <span className="text-red-500">💀 對手得分</span>}
                      {roundResult === 'draw' && <span className="text-stone-300">🤝 平手重來</span>}
                    </div>
                    {(playerWins < 2 && cpuWins < 2) && (
                      <button onClick={resetRound} className="w-full bg-[#c75e14] hover:bg-[#a84d0e] text-white font-black py-2 rounded-lg shadow-[0_4px_0_rgb(100,40,10)] active:translate-y-[4px] active:shadow-[0_0px_0_rgb(100,40,10)] transition-all text-sm">
                        下一回合
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={`p-3 rounded-2xl border-t-4 border-x-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] relative flex flex-col items-center shrink-0 ${playerRole === 'sente' ? 'bg-[#ffedb3] border-[#d1a624]' : 'bg-[#d6eaff] border-[#5591d1]'}`}>
                {(gameState === 'round_result' && dialogueStep >= 1) && (
                  <div className="bg-white border-2 border-stone-300 px-3 py-1.5 rounded-xl rounded-br-none shadow-md text-base font-black text-stone-800 animate-slide-in mb-2 relative z-10">
                    {playerRole === 'gote' && dialogueStep === 1 && "「イラッシャイ！」"}
                    {playerRole === 'sente' && dialogueStep === 2 && "「3本！！」"}
                    {playerRole === 'gote' && dialogueStep >= 3 && `「${getGoteShout(playerChoice)}本！！」`}
                    {(playerRole === 'sente' && dialogueStep === 1) || (playerRole === 'gote' && dialogueStep === 2) ? "..." : ""}
                  </div>
                )}

                {gameState === 'playing' ? (
                  <div className="w-full bg-white p-2 rounded-xl border-2 border-stone-300 shadow-sm z-10">
                    <div className="text-center font-bold text-stone-700 mb-1.5 text-xs">
                      你 ({playerRole === 'sente' ? '先手' : '後手'}) <span className="bg-stone-800 text-white px-1.5 py-0.5 rounded ml-1">勝: {playerWins}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[0, 1, 2, 3].map(num => (
                        <button key={num} onClick={() => handlePlay(num)} className="flex flex-col items-center py-1 bg-stone-50 border-2 border-stone-300 rounded-lg hover:bg-amber-100 hover:border-amber-500 active:scale-95 transition-all">
                          {renderMiniChopsticks(num)}
                          <span className="mt-1 font-black text-stone-700 bg-white border border-stone-300 px-1 rounded w-11/12 text-[10px] leading-tight">{num} 根</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 z-0">
                    {dialogueStep >= 4 ? renderChopsticks(playerChoice, 'up') : renderChopsticks(0, 'up', true)}
                  </div>
                )}

                <div className={`absolute -bottom-4 left-1/2 transform -translate-x-1/2 text-white px-6 py-1 rounded-full text-sm font-black shadow-lg border-2 border-white z-20 flex items-center gap-2 whitespace-nowrap ${playerRole === 'sente' ? 'bg-[#c75e14]' : 'bg-[#1b5e9c]'}`}>
                  <span>👤 你的座位 ({playerRole === 'sente' ? '先手' : '後手'})</span>
                </div>
              </div>

            </div>
          )}

          {gameState === 'game_over' && (
            <div className="text-center space-y-4 animate-fade-in py-6 bg-white rounded-2xl border-4 border-[#8c7e63] shadow-xl mt-4 my-auto">
              <h2 className="text-2xl font-black drop-shadow-sm">
                {playerWins >= 2 ? <span className="text-green-700">🏆 勝負已分！</span> : <span className="text-red-700">🍶 輸家喝獻杯！</span>}
              </h2>
              <div className="text-6xl my-4 drop-shadow-md">
                {playerWins >= 2 ? '😎' : '🥴'}
              </div>
              <p className="text-sm font-bold px-4 text-stone-700">
                {playerWins >= 2 ? "氣勢如虹！完美的心理戰壓制了對手！" : "被看破手腳了，這杯土佐罰酒請一乾二淨吧！"}
              </p>
              {playerWins < 2 && (
                <div className="bg-red-100 p-4 rounded-full inline-block my-2 border-4 border-red-300 shadow-inner">
                  <div className="text-5xl animate-pulse">🍶</div>
                </div>
              )}
              <div className="px-6 mt-4">
                <button onClick={restartGame} className="w-full bg-[#1c1b1a] hover:bg-black text-white font-black text-lg py-3 rounded-xl shadow-[0_4px_0_rgb(0,0,0)] active:translate-y-[4px] active:shadow-[0_0px_0_rgb(0,0,0)] transition-all">
                  🔄 返回重新開始
                </button>
              </div>
            </div>
          )}
          
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .animate-fade-in { animation: fadeIn 0.3s ease-out; }
        .animate-slide-in { animation: slideIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .animate-bounce-in { animation: bounceIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bounceIn { 0% { opacity: 0; transform: scale(0.6); } 70% { opacity: 1; transform: scale(1.05); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px) rotate(-1deg); }
          50% { transform: translateX(5px) rotate(1deg); }
          75% { transform: translateX(-5px) rotate(-1deg); }
        }
        .animate-shake { animation: shake 0.3s cubic-bezier(.36,.07,.19,.97) both; }
      `}} />
    </div>
  );
};

export default function App() { return <HashikenGame />; }
