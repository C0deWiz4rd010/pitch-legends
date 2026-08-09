import { Injectable, inject } from '@angular/core';
import { GameStateService } from './game-state.service';
import { MatchEvent } from '../../models/match.model';

type Wave = OscillatorType;

/** Tiny WebAudio mixer for original chip-style UI and match sounds. */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private readonly gs = inject(GameStateService);
  private context: AudioContext | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;

  click(): void {
    this.tone(240, 0.035, 'square', 0.16, 410);
  }

  whistle(): void {
    this.tone(1480, 0.1, 'square', 0.18, 1740);
    setTimeout(() => this.tone(1660, 0.12, 'square', 0.14, 1380), 105);
  }

  goal(): void {
    [392, 523, 659, 784].forEach((frequency, index) => {
      setTimeout(() => this.tone(frequency, 0.13, 'square', 0.2, frequency * 1.04), index * 85);
    });
  }

  error(): void {
    this.tone(150, 0.16, 'sawtooth', 0.13, 90);
  }

  /** One event entry point keeps simulation, presentation and sound decoupled. */
  matchEvent(event: MatchEvent): void {
    if (event.type === 'goal') {
      this.goal();
      return;
    }
    if (event.type === 'shot') {
      this.tone(118, 0.045, 'square', 0.12, 76);
      return;
    }
    if (event.type === 'save') {
      this.tone(190, 0.06, 'triangle', 0.11, 310);
      return;
    }
    if (event.type === 'foul' || event.type === 'yellow' || event.type === 'red') this.whistle();
  }

  startMusic(): void {
    if (this.musicTimer || !this.enabled()) return;
    const bass = [98, 98, 131, 147, 98, 165, 147, 131];
    this.musicTimer = setInterval(() => {
      const settings = this.gs.game()?.settings;
      if (!settings?.soundEnabled || settings.musicVolume <= 0) return;
      const note = bass[this.musicStep++ % bass.length];
      this.tone(note, 0.1, 'triangle', settings.musicVolume * 0.07, note * 0.99, true);
    }, 220);
  }

  stopMusic(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private enabled(): boolean {
    const settings = this.gs.game()?.settings;
    return !!settings?.soundEnabled && settings.sfxVolume > 0 && typeof window !== 'undefined' && 'AudioContext' in window;
  }

  private tone(
    frequency: number,
    duration: number,
    wave: Wave,
    volume: number,
    endFrequency = frequency,
    music = false,
  ): void {
    if (!this.enabled()) return;
    const settings = this.gs.game()!.settings;
    const level = music ? volume : volume * settings.sfxVolume;
    const context = this.context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), context.currentTime + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, level), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}
