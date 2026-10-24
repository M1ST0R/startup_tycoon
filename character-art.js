'use strict';

const CharacterArt = (() => {
  // [x, y, width, height], ordered left to right, then top to bottom.
  const sheets = [
    { src: '/assets/guses_s.png', rects: [
      [2, 81, 104, 161], [101, 65, 104, 177], [201, 83, 106, 159],
      [306, 75, 103, 171], [405, 83, 105, 159],
      [0, 269, 105, 179], [95, 282, 110, 166], [201, 271, 106, 178],
      [306, 280, 103, 170], [408, 268, 104, 182]
    ] },
    { src: '/assets/guses_s1.png', rects: [
      [1, 87, 105, 163], [102, 78, 103, 171], [204, 80, 98, 170],
      [306, 81, 102, 168], [410, 81, 101, 168],
      [3, 270, 101, 177], [102, 283, 103, 165], [204, 274, 102, 174],
      [307, 286, 101, 162], [411, 277, 101, 172]
    ] }
  ];
  const spriteIndices = StartupNameGenerator.SPRITE_INDICES;
  let portraits = [], desks = [];

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
      img.src = src;
    });
  }

  function cutCharacters(img, rects) {
    const width = img.naturalWidth, height = img.naturalHeight;
    const sheet = document.createElement('canvas');
    sheet.width = width; sheet.height = height;
    const ctx = sheet.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const source = ctx.getImageData(0, 0, width, height).data;
    const size = width * height;
    const background = new Uint8Array(size);
    const queue = new Int32Array(size);
    let head = 0, tail = 0;

    // The checkerboard is baked into the PNG. Remove only pale neutral pixels
    // connected to the outside, keeping white hair and clothes inside outlines.
    function addBackground(i) {
      if (background[i]) return;
      const p = i * 4;
      const low = Math.min(source[p], source[p + 1], source[p + 2]);
      const high = Math.max(source[p], source[p + 1], source[p + 2]);
      if (low < 225 || high - low > 12) return;
      background[i] = 1;
      queue[tail++] = i;
    }
    for (let x = 0; x < width; x++) {
      addBackground(x);
      addBackground((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      addBackground(y * width);
      addBackground(y * width + width - 1);
    }
    while (head < tail) {
      const i = queue[head++], x = i % width;
      if (x > 0) addBackground(i - 1);
      if (x + 1 < width) addBackground(i + 1);
      if (i >= width) addBackground(i - width);
      if (i + width < size) addBackground(i + width);
    }

    // Neighbouring characters overlap in X, so use their connected silhouettes
    // to prevent a sliver of another character appearing in a coordinate crop.
    const labels = new Int16Array(size);
    let nextLabel = 0;
    for (let start = 0; start < size; start++) {
      if (background[start] || labels[start]) continue;
      const label = ++nextLabel;
      head = 0; tail = 0; queue[tail++] = start; labels[start] = label;
      while (head < tail) {
        const i = queue[head++], x = i % width;
        const add = j => {
          if (!background[j] && !labels[j]) { labels[j] = label; queue[tail++] = j; }
        };
        if (x > 0) add(i - 1);
        if (x + 1 < width) add(i + 1);
        if (i >= width) add(i - width);
        if (i + width < size) add(i + width);
      }
    }

    return rects.map(([sx, sy, w, h]) => {
      const counts = new Map();
      for (let y = sy; y < sy + h; y++) for (let x = sx; x < sx + w; x++) {
        const label = labels[y * width + x];
        if (label) counts.set(label, (counts.get(label) || 0) + 1);
      }
      const ownLabel = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!ownLabel) throw new Error('Персонаж не найден в атласе');
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const out = canvas.getContext('2d');
      const pixels = out.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sourceIndex = (sy + y) * width + sx + x;
        if (labels[sourceIndex] !== ownLabel) continue;
        const from = sourceIndex * 4, to = (y * w + x) * 4;
        const low = Math.min(source[from], source[from + 1], source[from + 2]);
        const high = Math.max(source[from], source[from + 1], source[from + 2]);
        // Light, neutral edge pixels are the white matte of the source sheet.
        if (low >= 180 && high - low <= 18) {
          let touchesOutside = false;
          for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = sx + x + dx, ny = sy + y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || labels[ny * width + nx] !== ownLabel) {
              touchesOutside = true;
              break;
            }
          }
          if (touchesOutside) continue;
        }
        pixels.data[to] = source[from];
        pixels.data[to + 1] = source[from + 1];
        pixels.data[to + 2] = source[from + 2];
        pixels.data[to + 3] = source[from + 3];
      }
      out.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png');
    });
  }

  function cutDesk(img, sx, sy) {
    const canvas = document.createElement('canvas');
    canvas.width = 627; canvas.height = 627;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, sx, sy, 627, 627, 0, 0, 627, 627);
    const data = ctx.getImageData(0, 0, 627, 627).data;
    let left = 627, top = 627, right = -1, bottom = -1;
    for (let y = 0; y < 627; y++) for (let x = 0; x < 627; x++) {
      if (data[(y * 627 + x) * 4 + 3] < 24) continue;
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
    const [characterSheets, deskSheet] = await Promise.all([
      Promise.all(sheets.map(sheet => loadImage(sheet.src))), loadImage('/assets/desks.png')
    ]);
    portraits = characterSheets.flatMap((img, i) => cutCharacters(img, sheets[i].rects));
    desks = [0, 1, 2, 3].map(i => cutDesk(deskSheet, (i % 2) * 627, Math.floor(i / 2) * 627));
  }

  function portrait(person, mode = '', gender = person.gender) {
    const avatar = document.createElement('span');
    avatar.className = `avatar ${mode}`;
    avatar.setAttribute('aria-hidden', 'true');
    const look = person.appearance || {};
    const savedIndex = Number.isInteger(look.sprite) ? look.sprite :
      ((look.hair ?? person.id) * 3 + (look.cloth ?? 0)) % 10;
    const allowed = spriteIndices[gender];
    const sameSheet = savedIndex < 10 ? allowed?.slice(0, 5) : allowed?.slice(5);
    const index = allowed && !allowed.includes(savedIndex) ? sameSheet[savedIndex % sameSheet.length] : savedIndex;
    if (portraits[index]) {
      const img = document.createElement('img');
      img.className = 'avatar-sprite';
      img.src = portraits[index]; img.alt = '';
      avatar.append(img);
    } else {
      avatar.textContent = '👤';
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

  return { load, portrait, desk, spriteIndices };
})();
