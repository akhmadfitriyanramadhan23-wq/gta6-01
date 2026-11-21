// Solmar Bay — keyboard input. Holds the keys down right now and the
// one-shot presses (punch, enter/exit car) since the last frame was read.
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

export function createInput() {
  const down = new Set();
  const pressed = new Set();

  function onKeyDown(event) {
    if (GAME_KEYS.has(event.code) || event.code === 'Enter' || event.code === 'KeyP' || event.code === 'Escape' || event.code === 'KeyE') {
      event.preventDefault();
    }
    if (!event.repeat) pressed.add(event.code);
    down.add(event.code);
  }

  function onKeyUp(event) {
    down.delete(event.code);
  }

  function attach() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  function detach() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  }

  // The input object one world step consumes. One-shot presses are
  // consumed here; menu keys (Enter, P, Escape) stay for wasPressed().
  function read() {
    const input = {
      up: down.has('KeyW') || down.has('ArrowUp'),
      down: down.has('KeyS') || down.has('ArrowDown'),
      left: down.has('KeyA') || down.has('ArrowLeft'),
      right: down.has('KeyD') || down.has('ArrowRight'),
      run: down.has('ShiftLeft') || down.has('ShiftRight'),
      action: pressed.has('Space'),
      enter: pressed.has('KeyE'),
    };
    pressed.delete('Space');
    pressed.delete('KeyE');
    return input;
  }

  // True once per physical press of a menu key.
  function wasPressed(code) {
    if (!pressed.has(code)) return false;
    pressed.delete(code);
    return true;
  }

  return { attach, detach, read, wasPressed, down };
}
