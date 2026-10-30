// Cube-state and sticker-cycle helpers for the Speffz Lab blindfold trainer.
// Uses the same face/sticker layout as src/main.jsx; no random letter sequences are used.
export const FACES = [
  { id: "U", name: "Up", color: "#ffffff", letters: "AABBCCDD" },
  { id: "L", name: "Left", color: "#ff7700", letters: "EEFFGGHH" },
  { id: "F", name: "Front", color: "#00ff00", letters: "IIJJKKLL" },
  { id: "R", name: "Right", color: "#ff0000", letters: "MMNNOOPP" },
  { id: "B", name: "Back", color: "#0000ff", letters: "QQRRSSTT" },
  { id: "D", name: "Down", color: "#ffff00", letters: "UUVVWWXX" },
];
export const POS = [[0,0],[0,1],[0,2],[1,2],[2,2],[2,1],[2,0],[1,0]];
export const FACE_AXES = {
  U: { n:[0,1,0], right:[1,0,0], down:[0,0,1] },
  D: { n:[0,-1,0], right:[1,0,0], down:[0,0,-1] },
  F: { n:[0,0,1], right:[1,0,0], down:[0,-1,0] },
  B: { n:[0,0,-1], right:[-1,0,0], down:[0,-1,0] },
  R: { n:[1,0,0], right:[0,0,-1], down:[0,-1,0] },
  L: { n:[-1,0,0], right:[0,0,1], down:[0,-1,0] },
};
const EDGE_POS = new Set(["0,1","1,0","1,2","2,1"]);
export const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
const plus = (a,b) => a.map((x,i)=>x+b[i]);
const scale = (a,k) => a.map(x=>x*k);
const same = (a,b) => a.every((x,i)=>x===b[i]);
export const isEdgePos = ({r,c}) => EDGE_POS.has(`${r},${c}`);
export const isCornerPos = ({r,c}) => !isEdgePos({r,c});
const makeStickers = () => FACES.flatMap(face => POS.map(([r,c], i) => {
  const a = FACE_AXES[face.id];
  const cubie = plus(a.n, plus(scale(a.right,c-1), scale(a.down,r-1)));
  return {
    letter: face.letters[i], face: face.id, faceName: face.name, color: face.color,
    r,c, key:`${face.id}-${r}-${c}`, cubie, normal:a.n,
    kind: isEdgePos({r,c}) ? "edge" : "corner",
  };
}));
export const STICKERS = makeStickers();
export const KIND_STICKERS = {
  edges: STICKERS.filter(s=>s.kind==="edge"),
  corners: STICKERS.filter(s=>s.kind==="corner"),
};
const slotKey = (pos, normal) => `${pos.join(",")}|${normal.join(",")}`;
const SLOT_LOOKUP = new Map(STICKERS.map(s=>[slotKey(s.cubie,s.normal),s]));
const faceFromNormal = normal => Object.keys(FACE_AXES).find(f=>same(FACE_AXES[f].n,normal));
const rotateQuarter = (v, axis, direction) => {
  // All coordinates are integral. direction=+1 is +90 degrees by right-hand rule.
  const parallel = scale(axis, dot(axis,v));
  const cross = [
    axis[1]*v[2]-axis[2]*v[1],
    axis[2]*v[0]-axis[0]*v[2],
    axis[0]*v[1]-axis[1]*v[0],
  ];
  return plus(parallel, scale(cross,direction));
};
const rotateVector = (v, axis, turns) => {
  let out = [...v];
  const direction = Math.sign(turns);
  for(let i=0;i<Math.abs(turns);i++) out=rotateQuarter(out,axis,direction);
  return out;
};
export function parseScramble(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/\s+/);
  const valid = /^[URFDLB](?:2|')?$/;
  const invalid = tokens.find(t=>!valid.test(t));
  if (invalid) throw new Error(`Invalid move "${invalid}". Use standard moves such as R, U', F2, L, D', or B2.`);
  return tokens;
}
export function generateScramble(length=20) {
  const faces = ["U","D","L","R","F","B"];
  const suffixes = ["","'","2"];
  const result=[];
  let lastFace="", lastAxis="";
  for(let i=0;i<length;i++) {
    // Avoid consecutive turns of the same face; opposite faces are permitted.
    const candidates=faces.filter(f=>f!==lastFace);
    const face=candidates[Math.floor(Math.random()*candidates.length)];
    result.push(face+suffixes[Math.floor(Math.random()*suffixes.length)]);
    lastFace=face;
    lastAxis=face;
  }
  return result.join(" ");
}
export function applyScramble(scramble) {
  const tokens = Array.isArray(scramble) ? scramble : parseScramble(scramble);
  let state=STICKERS.map(s=>({...s,cubie:[...s.cubie],normal:[...s.normal]}));
  for(const token of tokens) {
    const face=token[0], axis=FACE_AXES[face].n;
    const suffix=token.slice(1);
    const turns=suffix==="2" ? 2 : suffix==="'" ? 1 : -1;
    state=state.map(sticker=>{
      if(dot(sticker.cubie,axis)!==1) return sticker;
      return {
        ...sticker,
        cubie: rotateVector(sticker.cubie,axis,turns),
        normal: rotateVector(sticker.normal,axis,turns),
      };
    });
  }
  return state;
}
export function getStickerMapping(scramble, kind) {
  const state=applyScramble(scramble);
  const base=KIND_STICKERS[kind];
  const allowed=new Set(base.map(s=>s.key));
  const mapping={};
  for(const sticker of state) {
    if(!allowed.has(sticker.key)) continue;
    const destination=SLOT_LOOKUP.get(slotKey(sticker.cubie,sticker.normal));
    if(destination && destination.kind===(kind==="edges" ? "edge" : "corner")) mapping[destination.letter]=sticker.letter;
  }
  return mapping;
}

// Return the visible color of each sticker at its destination facelet after a scramble.
// Each face has 9 entries in row-major order, suitable for a small 3x3 diagram.
export function getScrambledFacelets(scramble) {
  const state = applyScramble(scramble);
  const faces = Object.fromEntries(FACES.map((face) => {
    const stickers = Array(9).fill(null);
    // The center sticker never moves during ordinary face turns.
    stickers[4] = { color: face.color, letter: null };
    return [face.id, stickers];
  }));
  for (const sticker of state) {
    const destination = SLOT_LOOKUP.get(slotKey(sticker.cubie, sticker.normal));
    if (!destination) continue;
    faces[destination.face][destination.r * 3 + destination.c] = {
      color: sticker.color,
      letter: destination.letter,
    };
  }
  return FACES.map((face) => ({ ...face, stickers: faces[face.id] }));
}
export function pieceLetters(letter, kind) {
  const sticker=KIND_STICKERS[kind].find(s=>s.letter===letter);
  if(!sticker) return [];
  return KIND_STICKERS[kind].filter(s=>same(s.cubie,sticker.cubie)).map(s=>s.letter);
}
export function pieceName(letter, kind) {
  const sticker=KIND_STICKERS[kind].find(s=>s.letter===letter);
  if(!sticker) return "";
  return Object.keys(FACE_AXES).filter(face=>dot(sticker.cubie,FACE_AXES[face].n)===1).join("");
}

// Describes whether the selected buffer cubie is solved, twisted/flipped in
// its own slot, or displaced to another slot in the current scramble.
export function getBufferStatus(mapping, kind, bufferLetter) {
  const letters = pieceLetters(bufferLetter, kind);
  if (!letters.length) return "unknown";
  const mapped = letters.map((letter) => mapping[letter] ?? letter);
  if (mapped.every((letter, index) => letter === letters[index])) return "solved";
  if (mapped.every((letter) => letters.includes(letter))) return kind === "edges" ? "flipped" : "twisted";
  return "displaced";
}
const pieceKeyForLetter = (letter, kind) => {
  const s=KIND_STICKERS[kind].find(x=>x.letter===letter);
  return s ? s.cubie.join(",") : "";
};
export function getCycles(mapping, kind, bufferLetter) {
  const stickers = KIND_STICKERS[kind];
  const pieces = new Map();
  stickers.forEach((s) => {
    const key = s.cubie.join(",");
    if (!pieces.has(key)) pieces.set(key, []);
    pieces.get(key).push(s.letter);
  });
  for (const letters of pieces.values()) letters.sort();

  const bufferPiece = pieceKeyForLetter(bufferLetter, kind);
  const visitedPieces = new Set();
  const cycles = [];
  const trace = (startLetter, isBufferStart = false) => {
    const startPiece = pieceKeyForLetter(startLetter, kind);
    let current = startLetter;
    let guard = 0;
    const targets = [];
    const touched = [startPiece];
    const seenLocal = new Set([startPiece]);

    while (guard++ < stickers.length + 2) {
      const sourceLetter = mapping[current] ?? current;
      const sourcePiece = pieceKeyForLetter(sourceLetter, kind);
      // The selected buffer sticker is a location, not a memo target. Do not
      // append it when the trace closes back into the selected buffer sticker.
      // Buffer stickers identify the starting location; neither letter on the
      // physical buffer cubie is a target in the memo sequence.
      if (sourcePiece !== bufferPiece) targets.push(sourceLetter);
      if (sourcePiece === startPiece) break;
      if (seenLocal.has(sourcePiece)) break;
      seenLocal.add(sourcePiece);
      touched.push(sourcePiece);
      current = sourceLetter;
    }
    return { startPiece, targets, touched };
  };

  // The buffer is considered in its correct position when the stickers currently
  // occupying its slot both belong to the same physical buffer cubie. Its
  // orientation is deliberately irrelevant to this decision: a flipped/twisted
  // buffer still does not create a buffer cycle in this trainer's convention.
  const bufferStickerLetters = pieces.get(bufferPiece) ?? [bufferLetter];
  const bufferIsDisplaced = bufferStickerLetters.some((letter) => {
    const sourceLetter = mapping[letter] ?? letter;
    return pieceKeyForLetter(sourceLetter, kind) !== bufferPiece;
  });

  if (bufferIsDisplaced) {
    const traced = trace(bufferLetter, true);
    traced.touched.forEach((key) => visitedPieces.add(key));
    // Neither sticker letter belonging to the buffer cubie is ever a memo target.
    const memoLetters = traced.targets.filter((letter) => pieceKeyForLetter(letter, kind) !== bufferPiece);
    if (memoLetters.length) {
      cycles.push({
        id: `${kind}-buffer-${traced.touched.slice().sort().join("_")}`,
        letters: memoLetters,
        startSticker: bufferLetter,
        startPiece: bufferPiece,
        pieces: traced.touched,
        minLetter: [...memoLetters].sort()[0] ?? bufferLetter,
        isBufferCycle: true,
        bufferLetter,
      });
    }
  } else {
    // A correctly positioned buffer (including a flipped/twisted one) is not a
    // cycle and neither of its sticker letters may appear anywhere in the memo.
    visitedPieces.add(bufferPiece);
  }

  // Enumerate all remaining non-identity piece cycles. Their sequence keeps
  // the chosen starting sticker and may end with the other sticker on that
  // same physical piece; it must not be forced to end with the same letter.
  for (const [pieceKey, letters] of pieces.entries()) {
    if (visitedPieces.has(pieceKey)) continue;
    let selected = null;
    for (const candidate of letters) {
      const traced = trace(candidate, false);
      if (traced.targets.length === 1 && traced.targets[0] === candidate) continue;
      if (traced.touched.length > 1 || traced.targets.some((letter) => letter !== candidate || pieceKeyForLetter(letter, kind) !== pieceKey)) {
        selected = { candidate, traced };
        break;
      }
    }
    if (!selected) {
      visitedPieces.add(pieceKey);
      continue;
    }
    const { candidate, traced } = selected;
    traced.touched.forEach((key) => visitedPieces.add(key));
    const sequenceLetters = [candidate, ...traced.targets];
    cycles.push({
      id: `${kind}-${traced.touched.slice().sort().join("_")}`,
      letters: sequenceLetters,
      startSticker: candidate,
      startPiece: traced.startPiece,
      pieces: traced.touched,
      minLetter: [...sequenceLetters].sort()[0] ?? candidate,
      isBufferCycle: false,
    });
  }

  const bufferCycle = cycles.find((cycle) => cycle.isBufferCycle) || null;
  cycles.sort((a, b) => {
    if (bufferCycle && a === bufferCycle) return -1;
    if (bufferCycle && b === bufferCycle) return 1;
    return a.minLetter.localeCompare(b.minLetter);
  });
  return cycles.map((cycle, index) => ({ ...cycle, index }));
}
export function rotateCycle(cycle, startLetter, mapping, kind) {
  const startPiece = pieceKeyForLetter(startLetter, kind);
  let current = startLetter;
  let guard = 0;
  const targets = [];
  const touched = [startPiece];
  const seenLocal = new Set([startPiece]);
  while (guard++ < KIND_STICKERS[kind].length + 2) {
    const sourceLetter = mapping[current] ?? current;
    const sourcePiece = pieceKeyForLetter(sourceLetter, kind);
    // The buffer cubie itself is never a memo target. Suppress either sticker
    // letter on that physical piece, regardless of orientation.
    const bufferPiece = cycle.isBufferCycle ? pieceKeyForLetter(cycle.bufferLetter, kind) : null;
    if (!bufferPiece || sourcePiece !== bufferPiece) targets.push(sourceLetter);
    if (sourcePiece === startPiece) break;
    if (seenLocal.has(sourcePiece)) break;
    seenLocal.add(sourcePiece);
    touched.push(sourcePiece);
    current = sourceLetter;
  }
  const bufferPiece = cycle.isBufferCycle ? pieceKeyForLetter(cycle.bufferLetter, kind) : null;
  const letters = cycle.isBufferCycle ? targets.filter((letter) => pieceKeyForLetter(letter, kind) !== bufferPiece) : [startLetter, ...targets];
  return {
    ...cycle,
    letters: letters.length ? letters : cycle.letters,
    startSticker: startLetter,
    startPiece,
    pieces: touched,
    minLetter: [...letters].sort()[0] ?? startLetter,
  };
}
export function formatPairs(cycles) {
  const letters=cycles.flatMap(c=>c.letters).join("");
  return letters.match(/.{1,2}/g)?.join(" ") ?? "";
}
export function normalizeAnswer(text) {
  return String(text??"").toUpperCase().replace(/[^A-X]/g,"");
}
export function autoPairInput(text) {
  const letters=String(text??"").toUpperCase().replace(/[^A-X]/g,"");
  return letters.match(/.{1,2}/g)?.join(" ") ?? "";
}
