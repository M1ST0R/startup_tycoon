'use strict';

// Cut the supplied sprite sheets in the browser so their original pixels stay intact.
const CharacterArt = (() => {
  const hair = [], clothes = [], desks = [];

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function cut(img, sx, sy, width, height, whiteBackground = false) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, sx, sy, width, height, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const data = pixels.data;
    if (whiteBackground) {
      // Remove only white connected to the crop edge. White parts inside a shirt remain.
      const seen = new Uint8Array(width * height);
      const queue = new Int32Array(width * height);
      let head = 0, tail = 0;
      const add = i => {
        if (seen[i]) return;
        const p = i * 4;
        if (data[p] < 236 || data[p + 1] < 236 || data[p + 2] < 236) return;
        seen[i] = 1; queue[tail++] = i;
      };
      for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
      for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
      while (head < tail) {
        const i = queue[head++], x = i % width, y = (i / width) | 0;
        data[i * 4 + 3] = 0;
        if (x > 0) add(i - 1);
        if (x + 1 < width) add(i + 1);
        if (y > 0) add(i - width);
        if (y + 1 < height) add(i + width);
      }
      ctx.putImageData(pixels, 0, 0);
    }
    // Trim transparent margins; the returned URL is a single usable sprite.
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 24) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < left) return '';
    const output = document.createElement('canvas');
    output.width = right - left + 1; output.height = bottom - top + 1;
    output.getContext('2d').drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height);
    return output.toDataURL('image/png');
  }

  async function load() {
    const [hairSheet, clothSheet, deskSheet] = await Promise.all([
      loadImage('/assets/hair.png'), loadImage('/assets/cloth.png'), loadImage('/assets/desks.png')
    ]);
    // The hair rows are not evenly spaced in the supplied image.
    const hairRows = [0, 154, 272, 392, 512, 644, 762, 863, 1024];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++)
      hair.push(cut(hairSheet, col * 128, hairRows[row], 128, hairRows[row + 1] - hairRows[row], true));
    for (let col = 0; col < 4; col++)
      clothes.push(cut(clothSheet, col * 256, 128, 256, 770, true));
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++)
      desks.push(cut(deskSheet, col * 627, row * 627, 627, 627));
  }

  function portrait(person, mode = '') {
    const avatar = document.createElement('span');
    avatar.className = `avatar ${mode}`;
    avatar.setAttribute('aria-hidden', 'true');
    for (const part of ['arms', 'neck', 'face']) {
      const el = document.createElement('span');
      el.className = `avatar-${part}`;
      avatar.append(el);
    }
    const outfit = clothes[person.appearance.cloth];
    const hairstyle = hair[person.appearance.hair];
    if (outfit) {
      const img = document.createElement('img');
      img.className = 'avatar-clothes'; img.src = outfit; img.alt = '';
      avatar.append(img);
    }
    if (hairstyle) {
      const img = document.createElement('img');
      img.className = 'avatar-hair'; img.src = hairstyle; img.alt = '';
      avatar.append(img);
    }
    return avatar;
  }

  function desk(variant) {
    const img = document.createElement('img');
    img.className = 'seat-desk';
    if (desks[variant % 4]) img.src = desks[variant % 4];
    img.alt = '';
    return img;
  }

  return { load, portrait, desk };
})();
