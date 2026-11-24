/**
 * narration.js
 * Cross-platform Voice Narration & Lab Audio Cue Engine for Young's Double-Slit VR Laboratory.
 * Primary playback uses pre-synthesized PCM WAV narration tracks decoded via Web Audio API
 * (immune to browser SpeechSynthesis voice pack gaps and MIME-type quirks), with synchronous
 * Web Speech API (SpeechSynthesis) fallback and live sentence-synced captions.
 */

class YDSENarrationEngine {
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.enabled = true;
        this.autoNarrateStages = true;
        this.isSpeaking = false;
        this.currentText = '';
        this.currentSentence = '';
        this.selectedVoice = null;
        this.audioCtx = null;
        this._gainNode = null;
        this._activeSource = null;
        this._activeUtterance = null;
        this._captionTimer = null;
        this._queueToken = 0;
        this._arrayBufferCache = new Map();
        this._audioBufferCache = new Map();

        this.welcomeScript =
            "Welcome to the YDSE VR Laboratory! Here is the full setup of the experiment. " +
            "On the optical bench in front of you, coherent light from the laser source passes through the double-slit carriage and projects an interference pattern onto the movable observation screen. " +
            "Use the parameter console or the floating controls to adjust wavelength, slit separation, and screen distance in real time. " +
            "You can also explore the Welcome Kiosk or switch to Quantum Single-Photon Mode whenever you are ready.";

        this.audioTracks = {
            welcome: './audio/welcome.wav',
            stage1: './audio/stage1.wav',
            stage2: './audio/stage2.wav',
            stage3: './audio/stage3.wav',
            stage4: './audio/stage4.wav',
            stage5: './audio/stage5.wav',
            stage6: './audio/stage6.wav',
            obs1: './audio/obs1.wav',
            obs2: './audio/obs2.wav',
            obs3: './audio/obs3.wav',
            obs4: './audio/obs4.wav'
        };

        this.supported = (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined');

        if (this.supported) {
            this._refreshVoices();
            if (typeof window.speechSynthesis.addEventListener === 'function') {
                window.speechSynthesis.addEventListener('voiceschanged', () => this._refreshVoices());
            } else {
                window.speechSynthesis.onvoiceschanged = () => this._refreshVoices();
            }
        }
    }

    preload() {
        if (typeof fetch !== 'function' || typeof window === 'undefined') return;
        this._fetchAudioBytes(this.audioTracks.welcome).catch(() => {});
    }

    _ensureAudioContext() {
        if (typeof window === 'undefined') return null;
        const AudioContextCls = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCls) return null;
        if (!this.audioCtx) {
            this.audioCtx = new AudioContextCls();
            this._gainNode = this.audioCtx.createGain();
            this._gainNode.gain.value = 1.0;
            this._gainNode.connect(this.audioCtx.destination);
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
        }
        return this.audioCtx;
    }

    async _fetchAudioBytes(url) {
        if (this._arrayBufferCache.has(url)) {
            return this._arrayBufferCache.get(url);
        }
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`Audio fetch failed (${resp.status}) for ${url}`);
        }
        const buf = await resp.arrayBuffer();
        this._arrayBufferCache.set(url, buf);
        return buf;
    }

    async _loadDecodedAudio(url) {
        if (this._audioBufferCache.has(url)) {
            return this._audioBufferCache.get(url);
        }
        const ctx = this._ensureAudioContext();
        if (!ctx) throw new Error('AudioContext unavailable');
        const rawBytes = await this._fetchAudioBytes(url);
        // Clone buffer because decodeAudioData detaches the passed ArrayBuffer
        const copy = rawBytes.slice(0);
        const decoded = await ctx.decodeAudioData(copy);
        this._audioBufferCache.set(url, decoded);
        return decoded;
    }

    _refreshVoices() {
        if (!this.supported) return;
        const voices = window.speechSynthesis.getVoices() || [];
        if (voices.length === 0) return;

        const preferredPatterns = [
            /Microsoft (Aria|Jenny|Guy|Ana).*Natural/i,
            /Google US English/i,
            /Google UK English Female/i,
            /Samantha|Daniel|Karen|Alex/i,
            /Microsoft (Zira|David|Mark)/i
        ];

        for (const pattern of preferredPatterns) {
            const match = voices.find(v => pattern.test(v.name) && /^en/i.test(v.lang));
            if (match) {
                this.selectedVoice = match;
                return;
            }
        }

        this.selectedVoice = voices.find(v => /^en[-_]?US/i.test(v.lang))
            || voices.find(v => /^en/i.test(v.lang))
            || voices[0];
    }

    _notify() {
        if (this.callbacks && typeof this.callbacks.onStateChange === 'function') {
            this.callbacks.onStateChange({
                enabled: this.enabled,
                isSpeaking: this.isSpeaking,
                currentText: this.currentText,
                currentSentence: this.currentSentence,
                supported: this.supported || !!this._ensureAudioContext
            });
        }
    }

    playChime() {
        if (!this.enabled || typeof window === 'undefined') return;
        try {
            const ctx = this._ensureAudioContext();
            if (!ctx) return;

            const now = ctx.currentTime;
            const notes = [523.25, 659.25, 783.99]; // C5 - E5 - G5 welcoming lab chord
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);

                gain.gain.setValueAtTime(0.0001, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.05, now + idx * 0.08 + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.36);

                osc.connect(gain);
                gain.connect(this._gainNode || ctx.destination);

                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.4);
            });
        } catch (_) {}
    }

    _splitSentences(text) {
        if (!text) return [];
        const raw = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
        return raw ? raw.map(s => s.trim()).filter(Boolean) : [text];
    }

    _startCaptionTimeline(sentences, totalDurationSec, token) {
        if (this._captionTimer) {
            clearInterval(this._captionTimer);
            this._captionTimer = null;
        }
        if (!sentences || sentences.length <= 1) return;

        const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
        const thresholds = [];
        let acc = 0;
        for (let i = 0; i < sentences.length; i++) {
            thresholds.push((acc / totalChars) * totalDurationSec);
            acc += sentences[i].length;
        }

        const startTime = performance.now();
        let activeIdx = 0;
        this._captionTimer = setInterval(() => {
            if (token !== this._queueToken) {
                clearInterval(this._captionTimer);
                this._captionTimer = null;
                return;
            }
            const elapsedSec = (performance.now() - startTime) / 1000;
            let nextIdx = activeIdx;
            for (let i = 0; i < thresholds.length; i++) {
                if (elapsedSec >= thresholds[i]) nextIdx = i;
            }
            if (nextIdx !== activeIdx) {
                activeIdx = nextIdx;
                this.currentSentence = sentences[activeIdx];
                this._notify();
            }
        }, 120);
    }

    async _playTrack(audioUrl, fallbackText, options = {}) {
        const cleanText = (fallbackText || '').trim();
        this.stop();
        this.currentText = cleanText;

        if (!this.enabled && !options.force) {
            this.currentSentence = cleanText;
            this._notify();
            return;
        }

        // Must unlock AudioContext synchronously inside user gesture before any await
        const ctx = this._ensureAudioContext();
        if (options.chime) {
            this.playChime();
        }

        const token = ++this._queueToken;
        const sentences = this._splitSentences(cleanText);
        this.isSpeaking = true;
        this.currentSentence = sentences[0] || cleanText;
        this._notify();

        if (audioUrl && ctx && typeof fetch === 'function') {
            try {
                const audioBuffer = await this._loadDecodedAudio(audioUrl);
                if (token !== this._queueToken) return;
                if (!this.enabled && !options.force) return;

                if (ctx.state === 'suspended') {
                    await ctx.resume();
                }

                const src = ctx.createBufferSource();
                src.buffer = audioBuffer;
                src.connect(this._gainNode || ctx.destination);

                const startOffset = options.chime ? 0.22 : 0.02;
                this._activeSource = src;
                this._startCaptionTimeline(sentences, audioBuffer.duration, token);

                src.onended = () => {
                    if (this._activeSource === src) this._activeSource = null;
                    if (token !== this._queueToken) return;
                    if (this._captionTimer) {
                        clearInterval(this._captionTimer);
                        this._captionTimer = null;
                    }
                    this.isSpeaking = false;
                    this.currentSentence = '';
                    this._notify();
                    if (typeof options.onComplete === 'function') {
                        options.onComplete();
                    }
                };

                src.start(ctx.currentTime + startOffset);
                return;
            } catch (err) {
                console.warn('WAV narration track fallback to Web Speech API:', err.message);
            }
        }

        if (token !== this._queueToken) return;
        this._speakViaSpeechSynthesis(cleanText, token, options);
    }

    _speakViaSpeechSynthesis(cleanText, token, options = {}) {
        if (!this.supported) {
            this.isSpeaking = false;
            this.currentSentence = cleanText;
            this._notify();
            return;
        }

        this._refreshVoices();
        const sentences = this._splitSentences(cleanText);
        if (sentences.length === 0) return;

        const speakNext = (index) => {
            if (token !== this._queueToken) return;
            if (index >= sentences.length) {
                this._activeUtterance = null;
                this.isSpeaking = false;
                this.currentSentence = '';
                this._notify();
                if (typeof options.onComplete === 'function') {
                    options.onComplete();
                }
                return;
            }

            const sentence = sentences[index];
            this.currentSentence = sentence;
            this._notify();

            const utter = new SpeechSynthesisUtterance(sentence);
            this._activeUtterance = utter; // Strong ref prevents Chromium GC drop
            if (this.selectedVoice) utter.voice = this.selectedVoice;
            utter.lang = (this.selectedVoice && this.selectedVoice.lang) ? this.selectedVoice.lang : 'en-US';
            utter.rate = options.rate || 0.96;
            utter.pitch = options.pitch || 1.0;
            utter.volume = options.volume !== undefined ? options.volume : 1.0;

            utter.onend = () => {
                if (token !== this._queueToken) return;
                speakNext(index + 1);
            };
            utter.onerror = () => {
                if (token !== this._queueToken) return;
                this._activeUtterance = null;
                this.isSpeaking = false;
                this._notify();
            };

            try {
                window.speechSynthesis.speak(utter);
            } catch (_) {
                this._activeUtterance = null;
                this.isSpeaking = false;
                this._notify();
            }
        };

        speakNext(0);
    }

    speak(text, options = {}) {
        const cleanText = (text || '').trim();
        if (!cleanText) return;

        this.stop();
        this.currentText = cleanText;

        if (!this.enabled && !options.force) {
            this.currentSentence = cleanText;
            this._notify();
            return;
        }

        this._ensureAudioContext();
        if (options.chime) this.playChime();

        const token = ++this._queueToken;
        this.isSpeaking = true;
        this._speakViaSpeechSynthesis(cleanText, token, options);
    }

    narrateWelcome(options = {}) {
        return this._playTrack(this.audioTracks.welcome, this.welcomeScript, {
            chime: options.chime !== false,
            force: !!options.force,
            rate: 0.96,
            onComplete: options.onComplete
        });
    }

    narrateStage(stageInfo, options = {}) {
        if (!stageInfo) return;
        if (!this.autoNarrateStages && !options.force) return;
        const spokenPrompt = (stageInfo.prompt || '')
            .replace(/Δr/g, 'delta r')
            .replace(/Δφ/g, 'delta phi')
            .replace(/λ/g, 'lambda')
            .replace(/β/g, 'beta')
            .replace(/π/g, 'pi')
            .replace(/sinc²/g, 'sinc squared')
            .replace(/∫I\(x\)dx/g, 'integral of I of x dx');
        const script = `${stageInfo.title}. ${spokenPrompt} Task: ${stageInfo.action}`;
        const trackUrl = this.audioTracks[`stage${stageInfo.id}`] || null;
        return this._playTrack(trackUrl, script, {
            chime: false,
            force: !!options.force,
            rate: 0.97
        });
    }

    narrateObservation(stepIndex, spokenText, options = {}) {
        const idx = Number(stepIndex);
        const trackUrl = this.audioTracks[`obs${idx}`] || null;
        return this._playTrack(trackUrl, spokenText || '', {
            chime: false,
            force: !!options.force,
            rate: 0.97
        });
    }

    stop() {
        this._queueToken++;
        if (this._captionTimer) {
            clearInterval(this._captionTimer);
            this._captionTimer = null;
        }
        if (this._activeSource) {
            try {
                this._activeSource.onended = null;
                this._activeSource.stop();
                this._activeSource.disconnect();
            } catch (_) {}
            this._activeSource = null;
        }
        this._activeUtterance = null;
        if (this.supported) {
            try {
                if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                    window.speechSynthesis.cancel();
                }
            } catch (_) {}
        }
        if (this.isSpeaking) {
            this.isSpeaking = false;
            this.currentSentence = '';
            this._notify();
        }
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (this._gainNode && this.audioCtx) {
            try {
                this._gainNode.gain.setValueAtTime(this.enabled ? 1.0 : 0.0, this.audioCtx.currentTime);
            } catch (_) {}
        }
        if (!this.enabled) {
            this.stop();
        }
        this._notify();
        return this.enabled;
    }

    toggleMute() {
        return this.setEnabled(!this.enabled);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = YDSENarrationEngine;
}
