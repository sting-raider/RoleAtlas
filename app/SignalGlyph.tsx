"use client";

type SignalGlyphName = "atlas" | "radar" | "search" | "check" | "empty";

const GLYPHS: Record<SignalGlyphName, string[]> = {
  atlas: [
    "..#####..",
    ".##...##.",
    ".##...##.",
    ".#######.",
    ".##...##.",
    ".##...##.",
    ".##...##.",
    ".........",
    "......#..",
  ],
  radar: [
    "...###...",
    ".##...##.",
    ".#..#..#.",
    "#...#...#",
    "#...###.#",
    "#.......#",
    ".#.....#.",
    ".##...##.",
    "...###..#",
  ],
  search: [
    "..#####..",
    ".##...##.",
    ".#.....#.",
    ".#.....#.",
    ".##...##.",
    "..#####..",
    "......##.",
    ".......##",
    "........#",
  ],
  check: [
    ".........",
    ".......#.",
    "......##.",
    ".#...##..",
    ".##.##...",
    "..###....",
    "...#.....",
    ".........",
    "........#",
  ],
  empty: [
    "...###...",
    ".##...##.",
    ".#.....#.",
    "#.......#",
    "#..#.#..#",
    "#.......#",
    ".#.....#.",
    ".##...##.",
    "...###...",
  ],
};

export function SignalGlyph({ name = "radar", size = "md", signal = true, className = "" }: { name?: SignalGlyphName; size?: "sm" | "md" | "lg" | "xl"; signal?: boolean; className?: string }) {
  const cells = GLYPHS[name].join("").split("");
  return (
    <span className={`signal-glyph signal-glyph-${size} ${className}`.trim()} aria-hidden="true">
      {cells.map((cell, index) => <i key={index} className={`${cell === "#" ? "lit" : ""}${signal && index === 80 ? " signal" : ""}`} />)}
    </span>
  );
}

export function OpportunitySignal({ count, label, state = "idle" }: { count: number; label: string; state?: "idle" | "running" | "needs-input" | "done" }) {
  return (
    <div className={`opportunity-signal ${state}`} aria-label={`${count} ${label}`}>
      <div className="opportunity-glyph-wrap"><SignalGlyph name="radar" size="xl" signal={state === "needs-input" || state === "running"} /></div>
      <div className="opportunity-readout"><strong>{count}</strong><span>{label}</span></div>
    </div>
  );
}
