import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
  History,
  RotateCcw,
  Play,
  CheckCircle2,
  XCircle,
  Timer,
  Target,
  ChevronRight,
  Home,
  ChartNoAxesCombined,
} from "lucide-react";
import "./styles.css";
import {
  KIND_STICKERS,
  generateScramble,
  parseScramble,
  getStickerMapping,
  getCycles,
  pieceLetters,
  pieceName,
  rotateCycle,
  formatPairs,
  normalizeAnswer,
  autoPairInput,
  getScrambledFacelets,
  getBufferStatus,
} from "./cubeTrainer.js";
const FACES = [
  { id: "U", name: "Up", color: "#ffffff", letters: "AABBCCDD" },
  { id: "L", name: "Left", color: "#ff7700", letters: "EEFFGGHH" },
  { id: "F", name: "Front", color: "#00ff00", letters: "IIJJKKLL" },
  { id: "R", name: "Right", color: "#ff0000", letters: "MMNNOOPP" },
  { id: "B", name: "Back", color: "#0000ff", letters: "QQRRSSTT" },
  { id: "D", name: "Down", color: "#ffff00", letters: "UUVVWWXX" },
];
const POS = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [2, 1],
  [2, 0],
  [1, 0],
];
const FACE_AXES = {
  U: { n: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] },
  D: { n: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
  F: { n: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  B: { n: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] },
  R: { n: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] },
  L: { n: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] },
};
const LETTERS = FACES.flatMap((f) =>
  POS.map(([r, c], i) => {
    const a = FACE_AXES[f.id],
      v = a.n.map((n, k) => n + a.right[k] * (c - 1) + a.down[k] * (r - 1));
    return {
      letter: f.letters[i],
      face: f.id,
      faceName: f.name,
      color: f.color,
      r,
      c,
      key: `${f.id}-${r}-${c}`,
      cubie: v.join(","),
    };
  }),
);
const EDGE = new Set(["0,1", "1,0", "1,2", "2,1"]),
  CORNER = new Set(["0,0", "0,2", "2,0", "2,2"]),
  STORE = "speffz-lab-history-v1",
  PREFS = "speffz-lab-preferences-v1";
const isEdge = (p) => EDGE.has(`${p.r},${p.c}`),
  fmt = (ms) => `${(ms / 1000).toFixed(2)}s`;
const PIECES = LETTERS.map((p) => ({
  ...p,
  stickers: LETTERS.filter((s) => s.cubie === p.cubie).sort((a, b) =>
    a.key === p.key ? -1 : b.key === p.key ? 1 : 0,
  ),
}));
function ColorPiece({ target, showFaceNames }) {
  const stickers = target?.stickers || [];
  return (
    <div
      className="color-piece"
      aria-label={`${stickers.length} sticker piece, colors shown left to right`}
    >
      {stickers.map((sticker, i) => (
        <div className="color-piece-item" key={sticker.key}>
          <div
            className="color-swatch"
            style={{ background: sticker.color }}
            aria-label={`${sticker.faceName} ${sticker.color}`}
          />
          {showFaceNames && <span>{sticker.faceName}</span>}
          {i === 0 && <small>FIRST</small>}
        </div>
      ))}
    </div>
  );
}

function BlindfoldWorkspace({ onHome }) {
  const [scramble, setScramble] = useState("");
  const [edgeBuffer, setEdgeBuffer] = useState(() => {
    try { return JSON.parse(localStorage.getItem("speffz-lab-blindfold-preferences-v1") || "{}").edgeBuffer || "A"; }
    catch { return "A"; }
  });
  const [cornerBuffer, setCornerBuffer] = useState(() => {
    try { return JSON.parse(localStorage.getItem("speffz-lab-blindfold-preferences-v1") || "{}").cornerBuffer || "A"; }
    catch { return "A"; }
  });
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | memorizing | recall | scored
  const [memoStarted, setMemoStarted] = useState(0);
  const [memoNow, setMemoNow] = useState(0);
  const [memorizationMs, setMemorizationMs] = useState(0);
  const [recallStarted, setRecallStarted] = useState(0);
  const [edgeAnswer, setEdgeAnswer] = useState("");
  const [cornerAnswer, setCornerAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem("speffz-lab-blindfold-preferences-v1", JSON.stringify({ edgeBuffer, cornerBuffer }));
    } catch { /* Preferences remain usable if storage is unavailable. */ }
  }, [edgeBuffer, cornerBuffer]);

  useEffect(() => {
    if (phase !== "memorizing" && phase !== "recall") return;
    const id = setInterval(() => setMemoNow(performance.now()), 50);
    return () => clearInterval(id);
  }, [phase]);

  const elapsed = phase === "memorizing"
    ? Math.max(0, memoNow - memoStarted)
    : phase === "recall"
      ? Math.max(0, memoNow - recallStarted)
      : 0;
  const fmtTime = (ms) => `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
  const currentCycles = (kind) => analysis?.[kind]?.cycles ?? [];
  const sequence = (kind) => formatPairs(currentCycles(kind));
  const hasBufferCycle = (kind) => currentCycles(kind).some((c) => c.isBufferCycle);
  const bufferStatus = (kind) => {
    if (!analysis) return null;
    const letter = kind === "edges" ? edgeBuffer : cornerBuffer;
    return getBufferStatus(analysis[kind].mapping, kind, letter);
  };
  const isHidden = phase === "recall" || phase === "scored";

  function build(text) {
    try {
      const tokens = parseScramble(text);
      if (!tokens.length) throw new Error("Enter a scramble or generate a random one first.");
      const edgeMapping = getStickerMapping(tokens, "edges");
      const cornerMapping = getStickerMapping(tokens, "corners");
      const next = {
        tokens,
        scramble: tokens.join(" "),
        facelets: getScrambledFacelets(tokens),
        edges: { mapping: edgeMapping, cycles: getCycles(edgeMapping, "edges", edgeBuffer) },
        corners: { mapping: cornerMapping, cycles: getCycles(cornerMapping, "corners", cornerBuffer) },
      };
      setAnalysis(next);
      setScramble(next.scramble);
      setError("");
      setPhase("memorizing");
      setMemoStarted(performance.now());
      setMemoNow(performance.now());
      setMemorizationMs(0);
      setRecallStarted(0);
      setEdgeAnswer("");
      setCornerAnswer("");
      setResult(null);
    } catch (e) {
      setError(e?.message || "Could not analyze this scramble.");
    }
  }

  function skipScramble() {
    const generated = generateScramble(20);
    setScramble(generated);
    build(generated);
  }

  const scrambleFacelets = useMemo(() => {
    try {
      return getScrambledFacelets(parseScramble(scramble));
    } catch {
      return null;
    }
  }, [scramble]);

  function updateCycles(kind, updater) {
    setAnalysis((old) => {
      if (!old) return old;
      return { ...old, [kind]: { ...old[kind], cycles: updater(old[kind].cycles) } };
    });
  }

  function reorderCycles(kind, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    updateCycles(kind, (oldCycles) => {
      const bufferCycle = oldCycles.find((c) => c.isBufferCycle);
      const fromIndex = oldCycles.findIndex((c) => c.id === fromId);
      let toIndex = oldCycles.findIndex((c) => c.id === toId);
      if (fromIndex < 0 || toIndex < 0) return oldCycles;
      if (bufferCycle && oldCycles[fromIndex].isBufferCycle) return oldCycles;
      if (bufferCycle) toIndex = Math.max(1, toIndex);
      const next = [...oldCycles];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next.map((c, i) => ({ ...c, index: i }));
    });
  }

  function resetOrder(kind) {
    if (!analysis) return;
    const buffer = kind === "edges" ? edgeBuffer : cornerBuffer;
    updateCycles(kind, () => getCycles(analysis[kind].mapping, kind, buffer));
  }

  function changeStart(kind, cycleId, letter) {
    updateCycles(kind, (oldCycles) => oldCycles.map((cycle) => {
      if (cycle.id !== cycleId) return cycle;
      const next = rotateCycle(cycle, letter, analysis[kind].mapping, kind);
      return { ...next, id: cycle.id };
    }));
  }

  function readyForRecall() {
    setMemorizationMs(Math.max(0, performance.now() - memoStarted));
    setRecallStarted(performance.now());
    setMemoNow(performance.now());
    setPhase("recall");
  }

  function compare(kind, expected, answer) {
    const exp = normalizeAnswer(expected);
    const got = normalizeAnswer(answer);
    const totalPairs = Math.ceil(exp.length / 2);
    const expPairs = exp.match(/.{1,2}/g) || [];
    const gotPairs = got.match(/.{1,2}/g) || [];
    const pairResults = Array.from({ length: Math.max(expPairs.length, gotPairs.length) }, (_, i) => ({
      expected: expPairs[i] || "—",
      entered: gotPairs[i] || "—",
      correct: !!expPairs[i] && expPairs[i] === gotPairs[i],
    }));
    return {
      kind,
      expected: exp,
      entered: got,
      exact: exp === got,
      correctPairs: pairResults.filter((p) => p.correct).length,
      totalPairs,
      pairResults,
    };
  }

  function submitRecall() {
    if (!analysis) return;
    const edges = compare("edges", sequence("edges"), edgeAnswer);
    const corners = compare("corners", sequence("corners"), cornerAnswer);
    setResult({
      edges,
      corners,
      recallMs: Math.max(0, performance.now() - recallStarted),
      memorizationMs,
    });
    setPhase("scored");
  }

  const bufferOptions = (kind) => KIND_STICKERS[kind].map((sticker) => ({
    // Every sticker is a separate buffer orientation. For example, UF and FU
    // are the same physical edge but different buffer stickers.
    letter: sticker.letter,
    piece: pieceName(sticker.letter, kind),
    stickers: pieceLetters(sticker.letter, kind),
  }));
  const edgeOptions = bufferOptions("edges");
  const cornerOptions = bufferOptions("corners");

  return (
    <main className="main blindfold-main">
      <div className="train-header blindfold-topline">
        <button className="back-link" onClick={onHome}>← Back to color trainer</button>
        <span className="type-chip">BLINDFOLD / CYCLE LAB</span>
      </div>
      <section className="setup-card bld-setup">
        <div className="section-heading">
          <div><span className="step">02</span><h2>Blindfold memorization & cycle analyzer</h2></div>
          <span className="muted">REAL SCRAMBLE → TRACE</span>
        </div>
        <p className="bld-intro">
          Enter a standard 3×3 face-turn scramble or generate one. The trainer simulates the turns and derives edge/corner sticker traces using your existing Speffz letters.
        </p>
        <div className="bld-scramble-layout">
          <div className="bld-scramble-entry">
            <label className="field-label" htmlFor="bld-scramble">SCRAMBLE</label>
            <textarea
              id="bld-scramble"
              className="scramble-input"
              rows={4}
              value={scramble}
              onChange={(e) => setScramble(e.target.value)}
              placeholder="Example: R U R' U' F2 D L2 B' U2"
              disabled={phase === "memorizing" || phase === "recall"}
            />
            <div className="bld-toolbar">
              <button className="secondary-btn" onClick={() => {
                const generated = generateScramble(20);
                setScramble(generated);
                build(generated);
              }}>Generate random scramble</button>
              <button className="primary-btn" onClick={() => build(scramble)}>Analyze & memorize</button>
              <button className="secondary-btn bld-skip-btn" onClick={skipScramble}>Skip scramble ↗</button>
              {phase === "memorizing" && <span className="bld-live-time">Memorizing {fmtTime(elapsed)}</span>}
            </div>
          </div>
          <aside className="bld-cube-preview" aria-label="Live six-face cube diagram for the entered scramble">
            <div className="bld-cube-preview-head"><strong>SCRAMBLE PREVIEW</strong><span>6 faces</span></div>
            {scrambleFacelets ? (
              <div className="bld-six-faces">
                {scrambleFacelets.map((face) => (
                  <div className={`bld-mini-face bld-face-${face.id}`} key={face.id}>
                    <span>{face.id}</span>
                    <div className="bld-mini-grid">
                      {face.stickers.map((sticker, i) => (
                        <i key={i} style={{ backgroundColor: sticker?.color || "#222" }} title={`${face.id} sticker ${i + 1}`} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="bld-preview-error">Invalid move notation — correct the scramble to preview the cube.</p>}
            <p>Updates as you edit the scramble. Colors show the resulting cube state.</p>
          </aside>
        </div>
        <div className="bld-buffers">
          <label>
            <span className="field-label">EDGE BUFFER PIECE</span>
            <select value={edgeBuffer} onChange={(e) => setEdgeBuffer(e.target.value)} disabled={phase === "memorizing" || phase === "recall"}>
              {edgeOptions.map((option) => <option key={option.letter} value={option.letter}>{option.piece} — start {option.letter} ({option.stickers.join("/")})</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">CORNER BUFFER PIECE</span>
            <select value={cornerBuffer} onChange={(e) => setCornerBuffer(e.target.value)} disabled={phase === "memorizing" || phase === "recall"}>
              {cornerOptions.map((option) => <option key={option.letter} value={option.letter}>{option.piece} — start {option.letter} ({option.stickers.join("/")})</option>)}
            </select>
          </label>
        </div>
        {analysis && (
          <div className="bld-buffer-statuses">
            {[["edges", "Edge"], ["corners", "Corner"]].map(([kind, label]) => {
              const status = bufferStatus(kind);
              const text = status === "solved"
                ? "Buffer solved — tracing begins at the next unsolved cycle."
                : status === "flipped" || status === "twisted"
                  ? `Buffer ${status} in its slot — its orientation target must be memoized.`
                  : status === "displaced"
                    ? "Buffer displaced — its cycle is traced first."
                    : "";
              return <p className={`bld-buffer-status ${status || ""}`} key={kind}><strong>{label} buffer:</strong> {text}</p>;
            })}
          </div>
        )}
        {error && <div className="bld-error" role="alert">{error}</div>}
        <p className="bld-note">
          Each buffer option represents a specific sticker orientation on a physical piece. For example, the two orientations of one edge are separate options. Use the selectors on each cycle to start tracing from any piece in that cycle and choose any sticker on that piece.
          <br />Supported notation: <code>U D L R F B</code>, optional <code>'</code> or <code>2</code>. Wide turns, slices, rotations, and non-3×3 notation are not supported in this version.
        </p>
      </section>

      {analysis && (
        <>
          <div className="bld-summary-strip">
            <div><span>SCRAMBLE MOVES</span><strong>{analysis.tokens.length}</strong></div>
            <div><span>EDGE CYCLES</span><strong>{analysis.edges.cycles.length}</strong></div>
            <div><span>CORNER CYCLES</span><strong>{analysis.corners.cycles.length}</strong></div>
            <div><span>PHASE</span><strong>{phase === "memorizing" ? "Memorize" : phase === "recall" ? "Recall" : phase === "scored" ? "Results" : "Ready"}</strong></div>
          </div>

          {phase === "memorizing" && (
            <section className="bld-memory-banner">
              <div><span className="tiny-label">MEMORIZATION TIMER</span><strong>{fmtTime(elapsed)}</strong><p>Study the sequences and cycle order. Reorder cycles or change a cycle's starting sticker before you hide the solution.</p></div>
              <button className="primary-btn" onClick={readyForRecall}>I'm ready — hide solution <ChevronRight size={17}/></button>
            </section>
          )}

          {["edges", "corners"].map((kind) => (
            <section className="table-card bld-cycle-panel" key={kind}>
              <div className="table-heading">
                <div>
                  <span className="tiny-label">{kind === "edges" ? "24 EDGE STICKERS" : "24 CORNER STICKERS"}</span>
                  <h2>{kind === "edges" ? "Edge cycles" : "Corner cycles"}</h2>
                  <p className="bld-panel-subtitle">
                    {hasBufferCycle(kind) ? "The buffer cycle is first by default; the other cycles can be rearranged." : "The buffer is solved, so all detected cycles can be rearranged."}
                  </p>
                </div>
                <button className="text-btn" onClick={() => resetOrder(kind)} disabled={isHidden}>Reset default order</button>
              </div>
              {!currentCycles(kind).length ? (
                <div className="empty-inline">No unsolved {kind} pieces were detected for this scramble.</div>
              ) : (
                <div className="bld-cycles">
                  {currentCycles(kind).map((cycle, index) => (
                    <div
                      className={`bld-cycle-card ${cycle.isBufferCycle ? "buffer-cycle" : ""}`}
                      key={cycle.id}
                      draggable={!isHidden && (!hasBufferCycle(kind) || !cycle.isBufferCycle)}
                      onDragStart={() => setDragging({ kind, id: cycle.id })}
                      onDragOver={(e) => { if (!isHidden) e.preventDefault(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging?.kind === kind) reorderCycles(kind, dragging.id, cycle.id);
                        setDragging(null);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <div className="cycle-card-head">
                        <span className="drag-handle" aria-hidden="true">{(!hasBufferCycle(kind) || !cycle.isBufferCycle) && !isHidden ? "⠿" : "🔒"}</span>
                        <div><strong>Cycle {index + 1}</strong><small>{isHidden ? "Cycle details hidden" : cycle.isBufferCycle ? "Buffer cycle" : `Default key: ${cycle.minLetter}`}</small></div>
                        {!isHidden && (
                          <div className="cycle-piece-selectors" aria-label="Choose a starting sticker for any piece in this cycle">
                            {[cycle.startSticker, ...cycle.letters].reduce((items, letter) => {
                              const name = pieceName(letter, kind);
                              if (!name || items.some((item) => item.name === name)) return items;
                              items.push({ name, letter });
                              return items;
                            }, []).map(({ name, letter }) => (
                              <label className="cycle-start-select" key={name}>
                                <span>{name}</span>
                                <select
                                  aria-label={`Starting sticker for piece ${name}`}
                                  value={letter}
                                  onChange={(e) => changeStart(kind, cycle.id, e.target.value)}
                                >
                                  {pieceLetters(letter, kind).map((optionLetter) => (
                                    <option key={optionLetter} value={optionLetter}>{optionLetter}</option>
                                  ))}
                                </select>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="cycle-letters">{isHidden ? "•• •• ••" : formatPairs([cycle]) || "—"}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="bld-combined">
                <span>COMBINED LETTER PAIRS</span>
                <strong>{isHidden ? "Hidden during recall" : sequence(kind) || "—"}</strong>
                {!isHidden && <button className="text-btn" onClick={() => navigator.clipboard?.writeText(sequence(kind))}>Copy sequence</button>}
              </div>
            </section>
          ))}

          {phase === "recall" && (
            <section className="setup-card bld-recall-card">
              <div className="section-heading"><div><span className="step">03</span><h2>Recall the letter pairs</h2></div><span className="bld-live-time">{fmtTime(elapsed)}</span></div>
              <p className="bld-intro">Type each sequence from memory. A space is inserted after every two letters. Recall time is recorded when you submit.</p>
              <label className="field-label" htmlFor="edge-recall">YOUR EDGE PAIRS</label>
              <textarea id="edge-recall" className="scramble-input answer-pairs" rows={2} value={edgeAnswer} onChange={(e) => setEdgeAnswer(autoPairInput(e.target.value))} placeholder="e.g. AI GT MQ" autoCapitalize="characters" />
              <label className="field-label" htmlFor="corner-recall">YOUR CORNER PAIRS</label>
              <textarea id="corner-recall" className="scramble-input answer-pairs" rows={2} value={cornerAnswer} onChange={(e) => setCornerAnswer(autoPairInput(e.target.value))} placeholder="e.g. CR FU NP" autoCapitalize="characters" />
              <button className="primary-btn" onClick={submitRecall}>Check answers <CheckCircle2 size={17}/></button>
            </section>
          )}

          {phase === "scored" && result && (
            <section className="table-card bld-results">
              <div className="table-heading"><div><span className="tiny-label">SESSION COMPLETE</span><h2>Memorization results</h2></div><span className="bld-live-time">Recall {fmtTime(result.recallMs)}</span></div>
              <div className="result-cards bld-result-cards">
                <div className="result-card"><span>MEMORIZATION</span><strong>{fmtTime(result.memorizationMs)}</strong><div className="result-foot">Time before recall</div></div>
                <div className="result-card"><span>RECALL / ENTRY</span><strong>{fmtTime(result.recallMs)}</strong><div className="result-foot">Time to submit</div></div>
                <div className="result-card"><span>EDGE PAIRS</span><strong>{result.edges.correctPairs}/{result.edges.totalPairs}</strong><div className="result-foot">{result.edges.exact ? "Exact sequence" : "Sequence differs"}</div></div>
                <div className="result-card"><span>CORNER PAIRS</span><strong>{result.corners.correctPairs}/{result.corners.totalPairs}</strong><div className="result-foot">{result.corners.exact ? "Exact sequence" : "Sequence differs"}</div></div>
              </div>
              {[
                ["edges", result.edges],
                ["corners", result.corners],
              ].map(([kind, r]) => (
                <div className="bld-answer-review" key={kind}>
                  <h3>{kind === "edges" ? "Edge answer" : "Corner answer"} — {r.exact ? "Correct" : "Review pairs"}</h3>
                  <p><b>Expected:</b> {formatPairs(currentCycles(kind)) || "—"}</p>
                  <p><b>Entered:</b> {autoPairInput(kind === "edges" ? edgeAnswer : cornerAnswer) || "—"}</p>
                  <div className="pair-review">
                    {r.pairResults.map((pair, i) => <span key={i} className={pair.correct ? "pair-good" : "pair-bad"} title={pair.correct ? "Correct pair" : `Expected ${pair.expected}; entered ${pair.entered}`}>{pair.entered}</span>)}
                  </div>
                </div>
              ))}
              <div className="result-actions">
                <button className="primary-btn" onClick={() => build(scramble)}><RotateCcw size={17}/> Practice same scramble</button>
                <button className="secondary-btn" onClick={() => { const generated=generateScramble(20); setScramble(generated); build(generated); }}>New random scramble</button>
              </div>
            </section>
          )}
        </>
      )}
      <p className="bld-disclaimer">This is a local training aid. Verify the tracing convention against your preferred Speffz / blindfold method before relying on it for a timed solve.</p>
    </main>
  );
}

function App() {
  const [page, setPage] = useState("home"),
    [type, setType] = useState("edges"),
    [count, setCount] = useState(25),
    [custom, setCustom] = useState("50"),
    [queue, setQueue] = useState([]),
    [idx, setIdx] = useState(0),
    [input, setInput] = useState(""),
    [records, setRecords] = useState([]),
    [startAt, setStartAt] = useState(0),
    [now, setNow] = useState(0),
    [feedback, setFeedback] = useState(null),
    [showFaceNames, setShowFaceNames] = useState(() => {
      try {
        return (
          JSON.parse(localStorage.getItem(PREFS) || "{}").showFaceNames ?? true
        );
      } catch {
        return true;
      }
    }),
    [keyboardOnly, setKeyboardOnly] = useState(() => {
      try {
        return (
          JSON.parse(localStorage.getItem(PREFS) || "{}").keyboardOnly ?? false
        );
      } catch {
        return false;
      }
    }),
    [history, setHistory] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem(STORE) || "[]");
      } catch {
        return [];
      }
    });
  const inputRef = useRef(null);
  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    localStorage.setItem(
      PREFS,
      JSON.stringify({ showFaceNames, keyboardOnly }),
    );
  }, [showFaceNames, keyboardOnly]);
  useEffect(() => {
    if (page !== "train") return;
    const id = setInterval(() => setNow(performance.now()), 25);
    return () => clearInterval(id);
  }, [page, startAt]);
  const target = queue[idx],
    elapsed = Math.max(0, now - startAt),
    correct = records.filter((r) => r.correct).length,
    wrong = records.filter((r) => !r.correct && !r.skipped).length,
    skipped = records.filter((r) => r.skipped).length,
    avg = records.length
      ? records.reduce((s, r) => s + r.ms, 0) / records.length
      : 0,
    all = history.flatMap((s) => s.records || []);
  const weaknessStats = useMemo(() => {
    const result = { edge: [], corner: [] };
    for (const kind of ["edge", "corner"]) {
      const rows = all.filter((r) => r.type === kind);
      const baseline = rows.length
        ? rows.reduce((sum, r) => sum + r.ms, 0) / rows.length
        : 0;
      const map = {};
      rows.forEach((r) => {
        const key = r.letter.toUpperCase();
        map[key] ??= {
          letter: key,
          type: kind,
          total: 0,
          correct: 0,
          wrong: 0,
          skipped: 0,
          ms: 0,
        };
        const x = map[key];
        x.total++;
        x.ms += r.ms;
        if (r.correct) x.correct++;
        else if (r.skipped) x.skipped++;
        else x.wrong++;
      });
      result[kind] = Object.values(map)
        .map((x) => {
          const accuracy = x.correct / x.total;
          const avgMs = x.ms / x.total;
          const slow = baseline
            ? Math.max(0, Math.min(1, (avgMs / baseline - 1) / 1.5))
            : 0;
          const error = 1 - accuracy;
          return {
            ...x,
            accuracy,
            avgMs,
            score: Math.round((error * 0.65 + slow * 0.35) * 100),
          };
        })
        .sort(
          (a, b) =>
            b.score - a.score || a.accuracy - b.accuracy || b.avgMs - a.avgMs,
        );
    }
    return result;
  }, [history]);
  const letterStats = [...weaknessStats.edge, ...weaknessStats.corner].sort(
    (a, b) => b.score - a.score,
  );
  useEffect(() => {
    if (page === "train" && !keyboardOnly && !feedback) {
      const id = requestAnimationFrame(() =>
        inputRef.current?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(id);
    }
  }, [page, idx, feedback, keyboardOnly]);
  useEffect(() => {
    if (page !== "train" || !keyboardOnly) return;
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || feedback) return;
      if (/^[a-z]$/i.test(e.key)) {
        e.preventDefault();
        answerWith(e.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    page,
    keyboardOnly,
    feedback,
    target,
    startAt,
    idx,
    queue,
    records,
    type,
  ]);
  function poolFor(t) {
    return PIECES.filter(
      (p) =>
        t === "mixed" ||
        (t === "edges" && isEdge(p)) ||
        (t === "corners" && !isEdge(p)),
    );
  }
  function startWeaknessDrill(kind) {
    const weak = weaknessStats[kind].slice(0, 8);
    if (!weak.length) return;
    const weights = PIECES.filter(
      (p) =>
        (kind === "edge" ? isEdge(p) : !isEdge(p)) &&
        weak.some((w) => w.letter === p.letter.toUpperCase()),
    ).flatMap((p) => {
      const stat = weak.find((w) => w.letter === p.letter.toUpperCase());
      return Array(
        Math.max(1, Math.min(5, 1 + Math.round(stat.score / 20))),
      ).fill(p);
    });
    if (!weights.length) return;
    const qs = Array.from(
      { length: 25 },
      () => weights[Math.floor(Math.random() * weights.length)],
    );
    start(kind === "edge" ? "edges" : "corners", qs);
  }
  function start(t = type, q = null) {
    const n = q?.length || Number(count === "custom" ? custom : count),
      pool = poolFor(t),
      qs =
        q ||
        Array.from(
          { length: Math.max(1, Math.min(500, n)) },
          () => pool[Math.floor(Math.random() * pool.length)],
        );
    setType(t);
    setQueue(qs);
    setIdx(0);
    setRecords([]);
    setInput("");
    setFeedback(null);
    setStartAt(performance.now());
    setNow(performance.now());
    setPage("train");
    setTimeout(() => inputRef.current?.focus(), 70);
  }
  function finish(rs) {
    setPage("results");
    const total = rs.reduce((s, r) => s + r.ms, 0);
    setHistory((old) =>
      [
        {
          id: Date.now(),
          date: new Date().toISOString(),
          type,
          total: rs.length,
          correct: rs.filter((r) => r.correct).length,
          wrong: rs.filter((r) => !r.correct && !r.skipped).length,
          skipped: rs.filter((r) => r.skipped).length,
          avg: rs.length ? total / rs.length : 0,
          records: rs,
        },
        ...old,
      ].slice(0, 100),
    );
  }
  function moveNext() {
    if (idx + 1 >= queue.length) {
      finish(records);
      return;
    }
    setIdx((i) => i + 1);
    setFeedback(null);
    setInput("");
    setStartAt(performance.now());
    setNow(performance.now());
    setTimeout(() => inputRef.current?.focus(), 40);
  }
  function answerWith(raw) {
    if (!target || feedback || !String(raw).trim()) return;
    const ms = Math.max(0, performance.now() - startAt),
      answer = String(raw).trim().toLowerCase().slice(0, 1),
      r = {
        number: idx + 1,
        letter: target.letter,
        face: target.face,
        faceName: target.faceName,
        color: target.color,
        type: isEdge(target) ? "edge" : "corner",
        answer: answer.toUpperCase(),
        correct: answer === target.letter.toLowerCase(),
        skipped: false,
        ms,
        key: target.key,
      };
    const next = [...records, r];
    setRecords(next);
    setInput("");
    setFeedback({ correct: r.correct, expected: target.letter, ms });
    if (idx + 1 >= queue.length) {
      setTimeout(() => finish(next), r.correct ? 180 : 550);
    } else
      setTimeout(
        () => {
          setIdx((i) => i + 1);
          setFeedback(null);
          setStartAt(performance.now());
          setNow(performance.now());
        },
        r.correct ? 180 : 550,
      );
  }
  function submit(e) {
    e?.preventDefault();
    if (!input.trim()) return;
    answerWith(input);
  }
  function skip() {
    if (!target || feedback) return;
    const r = {
      number: idx + 1,
      letter: target.letter,
      face: target.face,
      faceName: target.faceName,
      color: target.color,
      type: isEdge(target) ? "edge" : "corner",
      answer: "—",
      correct: false,
      skipped: true,
      ms: Math.max(0, performance.now() - startAt),
      key: target.key,
    };
    const next = [...records, r];
    setRecords(next);
    if (idx + 1 >= queue.length) finish(next);
    else {
      setIdx((i) => i + 1);
      setStartAt(performance.now());
      setNow(performance.now());
    }
  }
  const exportJSON = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { date: new Date().toISOString(), type, records },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "speffz-session.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage("home")}>
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>
            speffz<span className="brand-light">lab</span>
            <small>3BLD TRAINING</small>
          </span>
        </button>
        <div className="top-actions">
          <span className="offline-pill">
            <i /> OFFLINE READY
          </span>
          <button className="bld-nav-btn" onClick={() => setPage("blindfold")}>
            Blindfold Lab
          </button>
          <button
            className="icon-btn"
            title="Session history"
            onClick={() => setPage("history")}
          >
            <History size={19} />
          </button>
        </div>
      </header>
      {page === "blindfold" && <BlindfoldWorkspace onHome={() => setPage("home")} />}
      {page === "home" && (
        <main className="main">
          <section className="hero">
            <div className="eyebrow">
              <span className="eyebrow-line" /> STICKER RECOGNITION / MODULE 01
            </div>
            <h1>
              Train your letters.
              <br />
              <em>Trust your recall.</em>
            </h1>
            <p className="hero-copy">
              Build faster, more reliable Speffz recognition for blindfolded
              solving. One sticker at a time.
            </p>
            <div className="hero-stats">
              <div>
                <strong>{history.length}</strong>
                <span>SESSIONS</span>
              </div>
              <div>
                <strong>{all.length}</strong>
                <span>STICKERS TRAINED</span>
              </div>
              <div>
                <strong>
                  {all.length
                    ? Math.round(
                        (all.filter((r) => r.correct).length / all.length) *
                          100,
                      )
                    : 0}
                  %
                </strong>
                <span>ALL-TIME ACCURACY</span>
              </div>
            </div>
          </section>
          <section className="setup-card">
            <div className="section-heading">
              <div>
                <span className="step">01</span>
                <h2>Configure your session</h2>
              </div>
              <span className="muted">READY WHEN YOU ARE</span>
            </div>
            <label className="field-label">PIECE TYPE</label>
            <div className="segmented">
              <button
                className={type === "edges" ? "active" : ""}
                onClick={() => setType("edges")}
              >
                <span className="segment-icon">◆</span> Edges{" "}
                <small>24 stickers</small>
              </button>
              <button
                className={type === "corners" ? "active" : ""}
                onClick={() => setType("corners")}
              >
                <span className="segment-icon">⬟</span> Corners{" "}
                <small>24 stickers</small>
              </button>
              <button
                className={type === "mixed" ? "active" : ""}
                onClick={() => setType("mixed")}
              >
                <span className="segment-icon">✣</span> Mixed{" "}
                <small>All positions</small>
              </button>
            </div>
            <label className="field-label count-label">
              QUESTIONS PER SESSION
            </label>
            <div className="count-options">
              {[10, 25, 50, 100].map((n) => (
                <button
                  key={n}
                  className={count === n ? "selected" : ""}
                  onClick={() => setCount(n)}
                >
                  {n}
                </button>
              ))}
              <button
                className={count === "custom" ? "selected" : ""}
                onClick={() => setCount("custom")}
              >
                Custom
              </button>
            </div>
            {count === "custom" && (
              <input
                className="custom-count"
                type="number"
                min="1"
                max="500"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="Custom question count"
              />
            )}
            <div className="trainer-options">
              <label>
                <input
                  type="checkbox"
                  checked={showFaceNames}
                  onChange={(e) => setShowFaceNames(e.target.checked)}
                />{" "}
                Show side names <span>(Front, Back, etc.)</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={keyboardOnly}
                  onChange={(e) => setKeyboardOnly(e.target.checked)}
                />{" "}
                Keyboard-only mode <span>(desktop)</span>
              </label>
            </div>
            {keyboardOnly && (
              <p className="keyboard-mode-note">
                Keyboard-only mode: press the Speffz letter key (A–X) to answer.
                No textbox or submit button will be shown. Best with a physical
                keyboard.
              </p>
            )}
            <div className="mapping-note">
              <span className="note-icon">i</span>
              <p>
                <strong>Fixed orientation</strong> — U=white, D=yellow, F=green,
                B=blue, R=red, L=orange. Large color strips replace the cube
                diagram. The first color is the sticker whose Speffz letter you
                must enter. This trainer uses your configured face-letter
                mapping, including repeated letter pairs on each face.
              </p>
            </div>
            <button className="primary-btn" onClick={() => start()}>
              <Play size={17} fill="currentColor" /> Start training{" "}
              <ChevronRight size={18} />
            </button>
          </section>
          <section className="weakness-panel">
            <div className="weakness-heading">
              <div>
                <span className="tiny-label">ADAPTIVE PRACTICE</span>
                <h2>Train what slows you down</h2>
                <p>
                  Drills prioritize letters you miss or take longer to recall.
                  Edge and corner performance is tracked separately.
                </p>
              </div>
            </div>
            <div className="weakness-cards">
              <div className="weakness-card">
                <div className="weakness-card-top">
                  <span className="segment-icon">◆</span>
                  <div>
                    <h3>Edge weaknesses</h3>
                    <p>
                      {weaknessStats.edge.length
                        ? `Top letters: ${weaknessStats.edge
                            .slice(0, 3)
                            .map((x) => x.letter)
                            .join(", ")}`
                        : "Complete edge practice to build your profile."}
                    </p>
                  </div>
                </div>
                <button
                  className="secondary-btn"
                  disabled={!weaknessStats.edge.length}
                  onClick={() => startWeaknessDrill("edge")}
                >
                  Practice weak edges <ChevronRight size={16} />
                </button>
              </div>
              <div className="weakness-card">
                <div className="weakness-card-top">
                  <span className="segment-icon">⬟</span>
                  <div>
                    <h3>Corner weaknesses</h3>
                    <p>
                      {weaknessStats.corner.length
                        ? `Top letters: ${weaknessStats.corner
                            .slice(0, 3)
                            .map((x) => x.letter)
                            .join(", ")}`
                        : "Complete corner practice to build your profile."}
                    </p>
                  </div>
                </div>
                <button
                  className="secondary-btn"
                  disabled={!weaknessStats.corner.length}
                  onClick={() => startWeaknessDrill("corner")}
                >
                  Practice weak corners <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>
          <section className="bottom-grid">
            <div className="mini-card">
              <div className="mini-icon">
                <Target size={19} />
              </div>
              <h3>One sticker. One letter.</h3>
              <p>
                See two or three piece colors in a line and recall the letter
                for the first color.
              </p>
            </div>
            <div className="mini-card">
              <div className="mini-icon">
                <Timer size={19} />
              </div>
              <h3>Speed with accuracy</h3>
              <p>
                Per-question timing helps you improve without losing track of
                correctness.
              </p>
            </div>
            <div className="mini-card">
              <div className="mini-icon">
                <ChartNoAxesCombined size={19} />
              </div>
              <h3>Learn from every session</h3>
              <p>
                Review mistakes, response times, and letters that need more
                practice.
              </p>
            </div>
          </section>
        </main>
      )}
      {page === "train" && target && (
        <main className="main train-main">
          <div className="train-header">
            <button
              className="back-link"
              onClick={() => {
                if (confirm("End this session and return to setup?"))
                  setPage("home");
              }}
            >
              <Home size={16} /> Exit session
            </button>
            <div className="live-timer">
              <span className="pulse" /> {fmt(elapsed)}
            </div>
          </div>
          <div className="progress-line">
            <div style={{ width: `${(idx / queue.length) * 100}%` }} />
          </div>
          <div className="question-meta">
            <span>
              QUESTION <b>{String(idx + 1).padStart(2, "0")}</b>{" "}
              <i>/ {queue.length}</i>
            </span>
            <span className="type-chip">{type.toUpperCase()}</span>
          </div>
          <section className="question-card">
            <div className="question-title">
              <span className="tiny-label">IDENTIFY THE PIECE</span>
              <h2>Which Speffz letter?</h2>
              <p>
                Read the colors from left to right. Answer for the first color.
              </p>
            </div>
            <ColorPiece target={target} showFaceNames={showFaceNames} />
            <div className="target-description">
              <span>
                Answer for the <strong>first color</strong>
              </span>
              <span className="target-piece">
                {isEdge(target) ? "EDGE" : "CORNER"} PIECE
              </span>
            </div>
            {!keyboardOnly && (
              <form className="answer-form" onSubmit={submit}>
                <label htmlFor="answer">YOUR LETTER</label>
                <div
                  className={`answer-input-wrap ${feedback ? (feedback.correct ? "is-correct" : "is-wrong") : ""}`}
                >
                  <input
                    ref={inputRef}
                    id="answer"
                    autoComplete="off"
                    autoCapitalize="none"
                    maxLength={1}
                    value={input}
                    onChange={(e) => {
                      const value = e.target.value
                        .replace(/[^a-z]/gi, "")
                        .slice(0, 1);
                      setInput(value);
                      if (value) answerWith(value);
                    }}
                    placeholder="?"
                    disabled={!!feedback}
                    aria-label="Enter Speffz letter"
                  />
                  <span className="input-hint">A–X · AUTO</span>
                </div>
                {feedback && (
                  <div
                    className={`feedback ${feedback.correct ? "good" : "bad"}`}
                  >
                    {feedback.correct ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <XCircle size={17} />
                    )}{" "}
                    {feedback.correct
                      ? "Correct!"
                      : `Not quite — the answer is ${feedback.expected.toUpperCase()}.`}{" "}
                    <span>{fmt(feedback.ms)}</span>
                  </div>
                )}
              </form>
            )}
            {keyboardOnly && (
              <div className="keyboard-only-feedback" aria-live="polite">
                {feedback && (
                  <div
                    className={`feedback ${feedback.correct ? "good" : "bad"}`}
                  >
                    {feedback.correct ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <XCircle size={17} />
                    )}{" "}
                    {feedback.correct
                      ? "Correct!"
                      : `Answer: ${feedback.expected.toUpperCase()}`}{" "}
                    <span>{fmt(feedback.ms)}</span>
                  </div>
                )}
                <span>Press a letter key to answer</span>
              </div>
            )}
            <div className="train-footer">
              <div>
                <CheckCircle2 size={15} />
                <span>{correct} correct</span>
              </div>
              <div>
                <XCircle size={15} />
                <span>{wrong} mistakes</span>
              </div>
              <button onClick={skip} disabled={!!feedback}>
                Skip question ↗
              </button>
            </div>
          </section>
          <p className="keyboard-tip">
            {keyboardOnly ? (
              <>KEYBOARD-ONLY: PRESS THE LETTER KEY TO ANSWER.</>
            ) : (
              <>
                Type one letter to answer automatically. Your response time
                starts when each question appears.
              </>
            )}
          </p>
        </main>
      )}
      {page === "results" && (
        <main className="main results-main">
          <div className="result-head">
            <span className="eyebrow">
              <span className="eyebrow-line" /> SESSION COMPLETE
            </span>
            <h1>
              Good work.
              <br />
              <em>Keep building recall.</em>
            </h1>
            <p>Every repetition makes recognition more automatic.</p>
          </div>
          <div className="result-cards">
            <div className="result-card">
              <span>ACCURACY</span>
              <strong>
                {records.length
                  ? Math.round((correct / records.length) * 100)
                  : 0}
                <small>%</small>
              </strong>
              <div className="result-foot">
                {correct} of {records.length} correct
              </div>
            </div>
            <div className="result-card">
              <span>AVG. RESPONSE</span>
              <strong>{fmt(avg)}</strong>
              <div className="result-foot">Per question</div>
            </div>
            <div className="result-card">
              <span>FASTEST CORRECT</span>
              <strong>
                {records.some((r) => r.correct)
                  ? fmt(
                      Math.min(
                        ...records.filter((r) => r.correct).map((r) => r.ms),
                      ),
                    )
                  : "—"}
              </strong>
              <div className="result-foot">Correct responses only</div>
            </div>
            <div className="result-card">
              <span>MISTAKES</span>
              <strong>{wrong + skipped}</strong>
              <div className="result-foot">{skipped} skipped</div>
            </div>
          </div>
          <section className="table-card">
            <div className="table-heading">
              <div>
                <span className="tiny-label">SESSION BREAKDOWN</span>
                <h2>Every answer</h2>
              </div>
              <button className="text-btn" onClick={exportJSON}>
                <Download size={15} /> Export JSON
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>FACE</th>
                    <th>LETTER</th>
                    <th>ANSWER</th>
                    <th>TIME</th>
                    <th>RESULT</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={i}>
                      <td className="dim">{String(i + 1).padStart(2, "0")}</td>
                      <td>
                        <span
                          className="face-badge"
                          style={{
                            background: r.color,
                            color: ["#0000ff", "#ff0000"].includes(r.color)
                              ? "white"
                              : "#111",
                          }}
                        >
                          {r.face}
                        </span>
                      </td>
                      <td className="letter-cell">{r.letter.toUpperCase()}</td>
                      <td>{r.answer}</td>
                      <td className="time-cell">{fmt(r.ms)}</td>
                      <td>
                        <span
                          className={`result-pill ${r.correct ? "pass" : r.skipped ? "skip" : "fail"}`}
                        >
                          {r.correct
                            ? "Correct"
                            : r.skipped
                              ? "Skipped"
                              : "Mistake"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="result-actions">
            <button className="primary-btn" onClick={() => start(type)}>
              <RotateCcw size={17} /> Train again <ChevronRight size={18} />
            </button>
            <button
              className="secondary-btn"
              onClick={() => {
                const missed = records
                  .filter((r) => !r.correct)
                  .map((r) => PIECES.find((p) => p.key === r.key))
                  .filter(Boolean);
                start(type, missed.length ? missed : undefined);
              }}
            >
              <Target size={17} /> Retry mistakes
            </button>
            <button
              className="secondary-btn"
              onClick={() => setPage("history")}
            >
              <History size={17} /> History
            </button>
          </div>
        </main>
      )}
      {page === "history" && (
        <main className="main history-main">
          <div className="history-title">
            <span className="eyebrow">
              <span className="eyebrow-line" /> YOUR PROGRESS
            </span>
            <h1>
              Session <em>history.</em>
            </h1>
            <p>Your training stays on this device.</p>
          </div>
          <div className="result-cards">
            <div className="result-card">
              <span>SESSIONS</span>
              <strong>{history.length}</strong>
              <div className="result-foot">Saved locally</div>
            </div>
            <div className="result-card">
              <span>QUESTIONS</span>
              <strong>{all.length}</strong>
              <div className="result-foot">Total attempts</div>
            </div>
            <div className="result-card">
              <span>ACCURACY</span>
              <strong>
                {all.length
                  ? Math.round(
                      (all.filter((r) => r.correct).length / all.length) * 100,
                    )
                  : 0}
                <small>%</small>
              </strong>
              <div className="result-foot">All recorded answers</div>
            </div>
            <div className="result-card">
              <span>WEAKEST LETTER</span>
              <strong>
                {letterStats.length ? letterStats[0].letter.toUpperCase() : "—"}
              </strong>
              <div className="result-foot">By correctness rate</div>
            </div>
          </div>
          <section className="table-card">
            <div className="table-heading">
              <div>
                <span className="tiny-label">RECENT PRACTICE</span>
                <h2>Past sessions</h2>
              </div>
              {history.length > 0 && (
                <button
                  className="text-btn danger-text"
                  onClick={() => {
                    if (confirm("Delete all saved session history?"))
                      setHistory([]);
                  }}
                >
                  Clear history
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="empty-state">
                <History size={28} />
                <h3>No sessions yet</h3>
                <p>
                  Complete your first training session to see your progress
                  here.
                </p>
                <button className="primary-btn" onClick={() => setPage("home")}>
                  Start training <ChevronRight size={17} />
                </button>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>TYPE</th>
                      <th>QUESTIONS</th>
                      <th>ACCURACY</th>
                      <th>AVG. TIME</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {new Date(s.date).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                        <td>{s.type}</td>
                        <td>{s.total}</td>
                        <td>
                          {s.total
                            ? Math.round((s.correct / s.total) * 100)
                            : 0}
                          %
                        </td>
                        <td className="time-cell">{fmt(s.avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {["edge", "corner"].map((kind) => (
            <section className="table-card letter-stats" key={kind}>
              <div className="table-heading">
                <div>
                  <span className="tiny-label">
                    PERSONALIZED RECALL ANALYSIS
                  </span>
                  <h2>
                    {kind === "edge" ? "Edge" : "Corner"} letters to revisit
                  </h2>
                </div>
                <button
                  className="text-btn"
                  disabled={!weaknessStats[kind].length}
                  onClick={() => startWeaknessDrill(kind)}
                >
                  Start drill <ChevronRight size={14} />
                </button>
              </div>
              {!weaknessStats[kind].length ? (
                <div className="empty-inline">
                  Finish a {kind} session to see accuracy and response-time
                  insights here.
                </div>
              ) : (
                <div className="weakness-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>LETTER</th>
                        <th>ATTEMPTS</th>
                        <th>ACCURACY</th>
                        <th>AVG. TIME</th>
                        <th>WEAKNESS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weaknessStats[kind].slice(0, 12).map((x) => (
                        <tr key={x.letter}>
                          <td className="letter-cell">{x.letter}</td>
                          <td>{x.total}</td>
                          <td>{Math.round(x.accuracy * 100)}%</td>
                          <td className="time-cell">{fmt(x.avgMs)}</td>
                          <td>
                            <div className="weakness-meter">
                              <i style={{ width: `${x.score}%` }} />
                            </div>
                            <span className="weakness-score">
                              {x.score}/100
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </main>
      )}
      <footer className="site-footer">
        <span>
          speffz<span className="brand-light">lab</span>{" "}
          <span className="footer-dot">•</span> BUILD YOUR RECALL
        </span>
        <span>LOCAL-FIRST · OFFLINE READY</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
