import type { InputFrame } from './types';

export class InputController {
  keys = new Set<string>();
  lastFrame: InputFrame = { t: 0, left: false, right: false, up: false, down: false, fire: false, bomb: false };
  log: InputFrame[] = [];
  pointerActive = false;
  pointerX = 0;
  fireHeld = false;

  attach(canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      // Store both layout key (e.key) AND physical key (e.code) so non-Latin
      // keyboard layouts (Cyrillic, Greek, etc.) still register X / WASD / arrows.
      this.keys.add(e.key.toLowerCase());
      if (e.code) this.keys.add(e.code.toLowerCase());
      const code = (e.code || '').toLowerCase();
      const key = e.key.toLowerCase();
      const movementOrFire =
        ['arrowleft','arrowright','arrowup','arrowdown',' '].includes(key) ||
        ['w','a','s','d'].includes(key) ||
        ['keyw','keya','keys','keyd','keyx','keyz','space','arrowleft','arrowright','arrowup','arrowdown'].includes(code);
      if (movementOrFire) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.code) this.keys.delete(e.code.toLowerCase());
    });
    addEventListener('blur', () => this.keys.clear());

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerX = ((e.clientX - rect.left) / rect.width) * canvas.width;
      this.pointerActive = true;
    };
    canvas.addEventListener('pointerdown', (e) => { onPointer(e); this.fireHeld = true; });
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerup', () => { this.fireHeld = false; });
    canvas.addEventListener('pointerleave', () => { this.fireHeld = false; });
  }

  capture(frame: number): InputFrame {
    const k = this.keys;
    // Each action checks both the Latin char (US layout) AND the physical key code
    // (KeyW, KeyX, etc.) so non-Latin layouts still work.
    const f: InputFrame = {
      t: frame,
      left:  k.has('arrowleft')  || k.has('a') || k.has('keya'),
      right: k.has('arrowright') || k.has('d') || k.has('keyd'),
      up:    k.has('arrowup')    || k.has('w') || k.has('keyw'),
      down:  k.has('arrowdown')  || k.has('s') || k.has('keys'),
      fire:  k.has(' ') || k.has('space') || k.has('z') || k.has('keyz') || this.fireHeld,
      // Bomb is X only — Shift was too easy to fat-finger while moving with WASD.
      bomb:  k.has('x') || k.has('keyx'),
    };
    this.lastFrame = f;
    this.log.push(f);
    return f;
  }

  reset() {
    this.log = [];
    this.lastFrame = { t: 0, left: false, right: false, up: false, down: false, fire: false, bomb: false };
  }
}
