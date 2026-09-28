/**
 * Web Speech API 語音朗讀 (TTS) 服務
 * 針對行動端進行段落分段防中斷處理，支援語速調節與語音選擇
 */

class TTSService {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.isPlaying = false;
    this.isPaused = false;
    this.rate = 1.0;
    this.paragraphs = [];
    this.currentIndex = 0;
    this.currentUtterance = null;
    this.onParagraphChange = null;
    this.onFinished = null;
    this.chineseVoice = null;

    if (this.synth) {
      this.initVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => this.initVoices();
      }
    }
  }

  initVoices() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    // 優先選取台灣繁體語音 (zh-TW)，次選中文語音 (zh)
    this.chineseVoice =
      voices.find((v) => v.lang.includes('zh-TW')) ||
      voices.find((v) => v.lang.includes('zh-HK')) ||
      voices.find((v) => v.lang.startsWith('zh')) ||
      null;
  }

  setRate(rate) {
    this.rate = Math.max(0.5, Math.min(2.5, rate));
  }

  start(text, onParagraphChange, onFinished) {
    if (!this.synth) {
      alert('您的瀏覽器不支援語音朗讀功能 (Web Speech API)');
      return;
    }

    this.stop();

    this.onParagraphChange = onParagraphChange;
    this.onFinished = onFinished;
    this.paragraphs = text
      .replace(/\r\n/g, '\n')
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    this.currentIndex = 0;
    this.isPlaying = true;
    this.isPaused = false;

    this.speakCurrent();
  }

  speakCurrent() {
    if (!this.isPlaying || this.currentIndex >= this.paragraphs.length) {
      this.stop();
      if (this.onFinished) this.onFinished();
      return;
    }

    const textToSpeak = this.paragraphs[this.currentIndex];
    if (this.onParagraphChange) {
      this.onParagraphChange(this.currentIndex, this.paragraphs.length);
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    if (this.chineseVoice) {
      utterance.voice = this.chineseVoice;
    }
    utterance.rate = this.rate;

    utterance.onend = () => {
      if (this.isPlaying && !this.isPaused) {
        this.currentIndex++;
        this.speakCurrent();
      }
    };

    utterance.onerror = (e) => {
      console.warn('TTS 朗讀錯誤:', e);
      if (this.isPlaying && !this.isPaused) {
        this.currentIndex++;
        this.speakCurrent();
      }
    };

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  pause() {
    if (this.synth && this.isPlaying) {
      this.synth.pause();
      this.isPaused = true;
    }
  }

  resume() {
    if (this.synth && this.isPlaying && this.isPaused) {
      this.synth.resume();
      this.isPaused = false;
    }
  }

  toggle() {
    if (this.isPaused) {
      this.resume();
    } else if (this.isPlaying) {
      this.pause();
    }
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.currentUtterance = null;
  }
}

export const tts = new TTSService();
