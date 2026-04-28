import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import "./modern-game.css";

const CARD_WIDTH = 74;
const CARD_HEIGHT = 108;
const CELL_GAP_X = 8;
const CELL_GAP_Y = 10;
const CARD_BASE_POINTS = 5;
const DECK_SIZE = 24;
const INITIAL_POKEDEX_POOL_SIZE = 100;
const FULL_POKEDEX_POOL_SIZE = 151;
const POKEDEX_CACHE_KEY = "cardTower.pokedexPool.v1";
const POKEDEX_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAYER_NAME_CACHE_KEY = "cardTower.playerName.v1";
const HIGHSCORES_CACHE_KEY = "cardTower.highscores.v1";
const HUD_PANEL_OFFSET_KEY = "cardTower.hudPanelOffset.v1";
const DECK_PANEL_OFFSET_KEY = "cardTower.deckPanelOffset.v1";
const DECK_PANEL_SIZE_KEY = "cardTower.deckPanelSize.v1";
const TAP_MOVE_THRESHOLD_PX = 12;
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

const GAME_MODE = {
  CLASSIC: "classic",
  POKEDEX: "pokedex"
} as const;

type GameMode = (typeof GAME_MODE)[keyof typeof GAME_MODE];

const SUITS = [
  { symbol: "♥", name: "hearts", color: "red" as const },
  { symbol: "♦", name: "diamonds", color: "red" as const },
  { symbol: "♣", name: "clubs", color: "black" as const },
  { symbol: "♠", name: "spades", color: "black" as const }
];

const EVOLUTION_CHAINS = [
  [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15], [16, 17, 18], [19, 20],
  [21, 22], [23, 24], [25, 26], [27, 28], [29, 30, 31], [32, 33, 34], [35, 36], [37, 38],
  [39, 40], [41, 42], [43, 44, 45], [46, 47], [48, 49], [50, 51], [52, 53], [54, 55], [56, 57],
  [58, 59], [60, 61, 62], [63, 64, 65], [66, 67, 68], [69, 70, 71], [72, 73], [74, 75, 76],
  [77, 78], [79, 80], [81, 82], [84, 85], [86, 87], [88, 89], [90, 91], [92, 93, 94], [95],
  [96, 97], [98, 99], [100, 101], [102, 103], [104, 105], [106], [107], [108], [109, 110], [111, 112],
  [113], [114], [115], [116, 117], [118, 119], [120, 121], [122], [123], [124], [125], [126], [127], [128],
  [129, 130], [131], [132], [133], [134], [135], [136], [137], [138, 139], [140, 141], [142], [143], [144],
  [145], [146], [147, 148, 149], [150], [151]
];

type PokedexEntry = {
  dexNumber: number;
  name: string;
  type1: string;
  type2?: string | null;
};

type CardType = "normal" | "suite" | "super" | "type" | "evolved";

type BaseCard = {
  id: string;
  type: CardType;
  color: "red" | "black";
  value: number;
};

type ClassicCard = BaseCard & {
  kind: "classic";
  suit: string;
  suitName: string;
};

type PokemonCard = BaseCard & {
  kind: "pokemon";
  dexNumber: number;
  name: string;
  imageUrl: string;
  pokemonType1: string;
  pokemonType2: string | null;
  evolutionChainId: string | null;
  evolutionStage: number | null;
  evolutionFinalDex: number | null;
  evolutionFinalName: string | null;
  suit: string;
  suitName: string;
};

type Card = ClassicCard | PokemonCard;
type BoardCard = Card & { col: number; row: number };
type Highscore = { name: string; score: number; cards: number; rows: number };

type ComboDescriptor = {
  type: CardType;
  bonus: number;
  cards: BoardCard[];
  comboKey?: string;
};

const keyFor = (col: number, row: number) => `${col},${row}`;
const getPokemonImageUrl = (dexNumber: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexNumber}.png`;

const randomSuit = () => SUITS[Math.floor(Math.random() * SUITS.length)];
const shuffleList = <T,>(items: T[]) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};
const pickRandomSubset = <T,>(items: T[], count: number) => {
  if (count >= items.length) return shuffleList(items);
  return shuffleList(items).slice(0, Math.max(0, count));
};
const getPokemonTypeClass = (typeName?: string | null) =>
  `pokemon-type-${String(typeName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "") || "unknown"}`;

let convexClient: ConvexHttpClient | null = null;
function getConvexClient() {
  if (!convexUrl) {
    throw new Error("Missing VITE_CONVEX_URL");
  }
  if (!convexClient) {
    convexClient = new ConvexHttpClient(convexUrl);
  }
  return convexClient;
}

function normalizePlayerName(value: string) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed.slice(0, 20) : "";
}

function makeClassicCard() {
  const suit = randomSuit();
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    kind: "classic" as const,
    type: "normal" as const,
    suit: suit.symbol,
    suitName: suit.name,
    color: suit.color,
    value: CARD_BASE_POINTS
  };
}

function pickFinalEvolutionCard(cards: (BoardCard & PokemonCard)[]) {
  if (!cards.length) return null;
  return cards.reduce((best, candidate) => {
    const bestStage = Number(best?.evolutionStage || 0);
    const candidateStage = Number(candidate?.evolutionStage || 0);
    if (candidateStage > bestStage) return candidate;
    if (candidateStage === bestStage && Number(candidate.dexNumber || 0) > Number(best.dexNumber || 0)) return candidate;
    return best;
  }, cards[0]);
}

function createShuffledDeck() {
  const cards = Array.from({ length: DECK_SIZE }, () => makeClassicCard());
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

type PanelOffset = { x: number; y: number };
type PanelSize = { width: number; height: number };

function readPanelOffset(storageKey: string): PanelOffset {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { x: 0, y: 0 };
    const p = JSON.parse(raw) as { x?: number; y?: number };
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
    return { x, y };
  } catch {
    return { x: 0, y: 0 };
  }
}

function clampPanelOffset({ x, y }: PanelOffset): PanelOffset {
  if (typeof window === "undefined") return { x, y };
  const w = window.innerWidth;
  const h = window.innerHeight;
  const minX = -100;
  const minY = -50;
  const maxX = Math.max(minX, w - 64);
  const maxY = Math.max(minY, h - 64);
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y))
  };
}

function readDeckPanelSize(storageKey: string): PanelSize {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { width: 220, height: 0 };
    const p = JSON.parse(raw) as { width?: number; height?: number };
    const width = Number(p.width);
    const height = Number(p.height);
    return {
      width: Number.isFinite(width) ? width : 220,
      height: Number.isFinite(height) ? height : 0
    };
  } catch {
    return { width: 220, height: 0 };
  }
}

function clampDeckPanelSize({ width, height }: PanelSize): PanelSize {
  if (typeof window === "undefined") return { width, height };
  const minWidth = 180;
  const maxWidth = Math.max(minWidth, window.innerWidth - 12);
  const minHeight = 160;
  const maxHeight = Math.max(minHeight, window.innerHeight - 16);
  const safeWidth = Number.isFinite(width) ? width : 220;
  const safeHeight = Number.isFinite(height) ? height : 0;
  return {
    width: Math.max(minWidth, Math.min(maxWidth, safeWidth)),
    height: safeHeight <= 0 ? 0 : Math.max(minHeight, Math.min(maxHeight, safeHeight))
  };
}

export function ModernGamePage() {
  const towerZoneRef = useRef<HTMLDivElement | null>(null);
  const deckPanelRef = useRef<HTMLDivElement | null>(null);
  const resetGameRef = useRef<(targetMode: GameMode) => Promise<void>>(async () => {});
  const [board, setBoard] = useState<Map<string, BoardCard>>(new Map());
  const [drawPile, setDrawPile] = useState<ClassicCard[]>([]);
  const [nextCard, setNextCard] = useState<Card | null>(null);
  const [score, setScore] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isDeckComplete, setIsDeckComplete] = useState(false);
  const [isDeckLoading, setIsDeckLoading] = useState(false);
  const [mode, setMode] = useState<GameMode>(GAME_MODE.POKEDEX);
  const [pokedexPool, setPokedexPool] = useState<PokedexEntry[]>([]);
  const [pokedexDrawPile, setPokedexDrawPile] = useState<PokedexEntry[]>([]);
  const [highscores, setHighscores] = useState<Highscore[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; card: Card } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [pendingTap, setPendingTap] = useState<{ id: number; x: number; y: number } | null>(null);
  const [panelHidden, setPanelHidden] = useState<Record<string, boolean>>({
    title: true,
    deck: false,
    score: true,
    highscores: true
  });
  const [hudPanelOffset, setHudPanelOffset] = useState<PanelOffset>({ x: 0, y: 0 });
  const [deckPanelOffset, setDeckPanelOffset] = useState<PanelOffset>({ x: 0, y: 0 });
  const [deckPanelSize, setDeckPanelSize] = useState<PanelSize>({ width: 220, height: 0 });
  const [panelDrag, setPanelDrag] = useState<{
    kind: "hud" | "deck";
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [panelResize, setPanelResize] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
  const deckPanelOffsetRef = useRef<PanelOffset>({ x: 0, y: 0 });

  const evolutionByDex = useMemo(() => {
    const map = new Map<number, { chainId: string; stage: number; finalDex: number; finalName: string }>();
    const nameByDex = new Map(pokedexPool.map((entry) => [Number(entry.dexNumber), String(entry.name)]));
    EVOLUTION_CHAINS.forEach((chain) => {
      const finalDex = chain[chain.length - 1];
      const finalName = nameByDex.get(finalDex) || `#${String(finalDex).padStart(3, "0")}`;
      chain.forEach((dexNumber, index) => {
        map.set(Number(dexNumber), {
          chainId: chain.join("-"),
          stage: index + 1,
          finalDex,
          finalName
        });
      });
    });
    return map;
  }, [pokedexPool]);

  const columns = useCallback(() => {
    const zone = towerZoneRef.current;
    if (!zone) return 1;
    return Math.max(1, Math.floor((zone.clientWidth - 16 + CELL_GAP_X) / (CARD_WIDTH + CELL_GAP_X)));
  }, []);

  const rowsCapacity = useCallback(() => {
    const zone = towerZoneRef.current;
    if (!zone) return 1;
    return Math.max(1, Math.floor((zone.clientHeight - 16 + CELL_GAP_Y) / (CARD_HEIGHT + CELL_GAP_Y)));
  }, []);

  const gridGapX = useCallback(() => {
    const zone = towerZoneRef.current;
    if (!zone) return CELL_GAP_X;
    const maxCols = Math.max(1, Math.floor((zone.clientWidth - 16 + CELL_GAP_X) / (CARD_WIDTH + CELL_GAP_X)));
    if (maxCols <= 1) return 0;
    return Math.max(0, (zone.clientWidth - 16 - maxCols * CARD_WIDTH) / (maxCols - 1));
  }, []);

  const gridGapY = useCallback(() => {
    const zone = towerZoneRef.current;
    if (!zone) return CELL_GAP_Y;
    const maxRows = Math.max(1, Math.floor((zone.clientHeight - 16 + CELL_GAP_Y) / (CARD_HEIGHT + CELL_GAP_Y)));
    if (maxRows <= 1) return 0;
    return Math.max(0, (zone.clientHeight - 16 - maxRows * CARD_HEIGHT) / (maxRows - 1));
  }, []);

  const gridLeftOffset = useCallback(() => {
    return 8;
  }, []);

  const gridTopOffset = useCallback(() => {
    return 8;
  }, []);

  const cards = useMemo(() => Array.from(board.values()), [board]);
  const rowsUsed = useMemo(() => new Set(cards.map((card) => card.row)).size, [cards]);

  const clampDeckPanelOffsetToViewport = useCallback((nextOffset: PanelOffset) => {
    const panelEl = deckPanelRef.current;
    if (typeof window === "undefined" || !panelEl) {
      return clampPanelOffset(nextOffset);
    }
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 6;
    const currentOffset = deckPanelOffsetRef.current;
    const rect = panelEl.getBoundingClientRect();
    let deltaX = nextOffset.x - currentOffset.x;
    let deltaY = nextOffset.y - currentOffset.y;
    let projectedLeft = rect.left + deltaX;
    let projectedRight = rect.right + deltaX;
    let projectedTop = rect.top + deltaY;
    let projectedBottom = rect.bottom + deltaY;

    if (rect.width + margin * 2 <= viewportWidth) {
      if (projectedLeft < margin) {
        deltaX += margin - projectedLeft;
        projectedRight += margin - projectedLeft;
      }
      if (projectedRight > viewportWidth - margin) {
        deltaX -= projectedRight - (viewportWidth - margin);
      }
    } else {
      deltaX += margin - projectedLeft;
    }

    if (rect.height + margin * 2 <= viewportHeight) {
      if (projectedTop < margin) {
        deltaY += margin - projectedTop;
        projectedBottom += margin - projectedTop;
      }
      if (projectedBottom > viewportHeight - margin) {
        deltaY -= projectedBottom - (viewportHeight - margin);
      }
    } else {
      deltaY += margin - projectedTop;
    }

    return {
      x: currentOffset.x + deltaX,
      y: currentOffset.y + deltaY
    };
  }, []);

  const setCardAt = useCallback((next: Map<string, BoardCard>, col: number, row: number, card: Card) => {
    next.set(keyFor(col, row), { ...card, col, row });
  }, []);

  const getCardAtFrom = (map: Map<string, BoardCard>, col: number, row: number) => map.get(keyFor(col, row)) || null;

  const createPokemonCard = useCallback(
    (pokemon: PokedexEntry): PokemonCard => {
      const type1 = String(pokemon.type1 || "unknown");
      const suit = randomSuit();
      const color: "red" | "black" = ["fire", "fighting", "electric", "dragon"].includes(type1) ? "red" : "black";
      const evolutionMeta = evolutionByDex.get(Number(pokemon.dexNumber)) || null;
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        kind: "pokemon",
        type: "normal",
        dexNumber: Number(pokemon.dexNumber),
        name: pokemon.name,
        imageUrl: getPokemonImageUrl(Number(pokemon.dexNumber)),
        pokemonType1: type1,
        pokemonType2: pokemon.type2 || null,
        evolutionChainId: evolutionMeta?.chainId || null,
        evolutionStage: evolutionMeta?.stage || null,
        evolutionFinalDex: evolutionMeta?.finalDex || null,
        evolutionFinalName: evolutionMeta?.finalName || null,
        suit: suit.symbol,
        suitName: suit.name,
        color,
        value: CARD_BASE_POINTS
      };
    },
    [evolutionByDex]
  );

  const determineNextCard = useCallback(
    (targetMode: GameMode, classicPile: ClassicCard[], pokedexPile: PokedexEntry[]) => {
      if (targetMode === GAME_MODE.POKEDEX) {
        const nextPokemon = pokedexPile[pokedexPile.length - 1];
        return nextPokemon ? createPokemonCard(nextPokemon) : null;
      }
      return classicPile[classicPile.length - 1] || null;
    },
    [createPokemonCard]
  );

  const getGridCoordsFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = towerZoneRef.current?.getBoundingClientRect();
      if (!rect) return { col: 0, row: 0 };
      const leftOffset = gridLeftOffset();
      const topOffset = gridTopOffset();
      const gapX = gridGapX();
      const gapY = gridGapY();
      const localX = clientX - rect.left - leftOffset;
      const localY = clientY - rect.top - topOffset;
      const maxCol = columns() - 1;
      const maxRow = rowsCapacity() - 1;
      const col = Math.max(0, Math.min(maxCol, Math.floor(localX / (CARD_WIDTH + gapX))));
      const row = Math.max(0, Math.min(maxRow, Math.floor(localY / (CARD_HEIGHT + gapY))));
      return { col, row };
    },
    [columns, rowsCapacity, gridLeftOffset, gridTopOffset, gridGapX, gridGapY]
  );

  const placeDrawnCard = useCallback(
    (clientX: number, clientY: number) => {
      if (!nextCard || isGameOver || isDeckComplete || isDeckLoading) return;

      const { col: targetCol, row: targetRow } = getGridCoordsFromPointer(clientX, clientY);
      const maxCols = columns();
      const maxRows = rowsCapacity();
      if (targetCol < 0 || targetCol >= maxCols || targetRow < 0 || targetRow >= maxRows) {
        setIsGameOver(true);
        return;
      }

      const findNearestOpenSlot = (originCol: number, originRow: number, map: Map<string, BoardCard>) => {
        if (!getCardAtFrom(map, originCol, originRow)) return { col: originCol, row: originRow };
        let bestSlot: { col: number; row: number } | null = null;
        let bestDistance = Infinity;
        for (let row = 0; row < maxRows; row += 1) {
          for (let col = 0; col < maxCols; col += 1) {
            if (getCardAtFrom(map, col, row)) continue;
            const distance = Math.hypot(col - originCol, row - originRow);
            if (distance < bestDistance || (distance === bestDistance && bestSlot && row > bestSlot.row)) {
              bestDistance = distance;
              bestSlot = { col, row };
            }
          }
        }
        return bestSlot;
      };

      const resolveClassicCombos = (map: Map<string, BoardCard>): ComboDescriptor[] => {
        const currentCards = Array.from(map.values());
        const grouped = new Map<string, BoardCard[]>();
        currentCards.forEach((card) => {
          const key = `${card.suit}:${card.row}`;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(card);
        });
        const descriptors: ComboDescriptor[] = [];
        grouped.forEach((line) => {
          line.sort((a, b) => a.col - b.col);
          if (line.length >= 2) {
            descriptors.push({
              type: "suite",
              bonus: line.length * 2,
              cards: line
            });
          }
        });
        return descriptors;
      };

      const buildContiguousGroups = (
        cards: (BoardCard & PokemonCard)[],
        indexKey: "row" | "col",
        contiguousKey: "row" | "col",
        predicate: (left: BoardCard & PokemonCard, right: BoardCard & PokemonCard, anchor: BoardCard & PokemonCard) => boolean
      ) => {
        const grouped = new Map<number, (BoardCard & PokemonCard)[]>();
        cards.forEach((card) => {
          const key = card[indexKey];
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(card);
        });
        const groups: (BoardCard & PokemonCard)[][] = [];
        grouped.forEach((lineCards) => {
          lineCards.sort((a, b) => a[contiguousKey] - b[contiguousKey]);
          let run = [lineCards[0]];
          for (let index = 1; index < lineCards.length; index += 1) {
            const previous = lineCards[index - 1];
            const current = lineCards[index];
            const isAdjacent = current[contiguousKey] === previous[contiguousKey] + 1;
            const isMatch = isAdjacent && predicate(previous, current, run[0]);
            if (isMatch) run.push(current);
            else {
              if (run.length >= 2) groups.push([...run]);
              run = [current];
            }
          }
          if (run.length >= 2) groups.push([...run]);
        });
        return groups;
      };

      const mergeOverlappingGroups = (groups: (BoardCard & PokemonCard)[][]) => {
        const merged: Array<{ keys: Set<string>; cards: (BoardCard & PokemonCard)[] }> = [];
        groups.forEach((group) => {
          const groupKeys = new Set(group.map((card) => keyFor(card.col, card.row)));
          const overlaps: number[] = [];
          for (let index = 0; index < merged.length; index += 1) {
            const existing = merged[index];
            const hasOverlap = Array.from(groupKeys).some((key) => existing.keys.has(key));
            if (hasOverlap) overlaps.push(index);
          }
          if (!overlaps.length) {
            merged.push({ keys: groupKeys, cards: [...group] });
            return;
          }
          const combinedKeys = new Set(groupKeys);
          const combinedCards = [...group];
          overlaps
            .sort((a, b) => b - a)
            .forEach((mergeIndex) => {
              const current = merged[mergeIndex];
              current.cards.forEach((card) => {
                const cardKey = keyFor(card.col, card.row);
                if (!combinedKeys.has(cardKey)) {
                  combinedKeys.add(cardKey);
                  combinedCards.push(card);
                }
              });
              merged.splice(mergeIndex, 1);
            });
          merged.push({ keys: combinedKeys, cards: combinedCards });
        });
        return merged.map((entry) => entry.cards);
      };

      const mergeDescriptorCards = (descriptors: ComboDescriptor[]) => {
        const mergedByKey = new Map<string, ComboDescriptor>();
        descriptors.forEach((descriptor) => {
          const key = descriptor.comboKey || `${descriptor.type}:${descriptor.cards[0]?.id || "na"}`;
          if (!mergedByKey.has(key)) {
            mergedByKey.set(key, { ...descriptor, cards: [...descriptor.cards] });
            return;
          }
          const existing = mergedByKey.get(key)!;
          const cardKeys = new Set(existing.cards.map((card) => keyFor(card.col, card.row)));
          descriptor.cards.forEach((card) => {
            const cardKey = keyFor(card.col, card.row);
            if (!cardKeys.has(cardKey)) {
              cardKeys.add(cardKey);
              existing.cards.push(card);
            }
          });
        });
        return Array.from(mergedByKey.values());
      };

      const chooseNonOverlappingDescriptors = (descriptors: ComboDescriptor[]) => {
        const chosen: ComboDescriptor[] = [];
        const used = new Set<string>();
        const priority: Record<CardType, number> = { evolved: 3, type: 2, super: 2, suite: 1, normal: 0 };
        descriptors
          .sort((left, right) => {
            const priorityDelta = (priority[right.type] || 0) - (priority[left.type] || 0);
            if (priorityDelta !== 0) return priorityDelta;
            return right.cards.length - left.cards.length;
          })
          .forEach((descriptor) => {
            const keys = descriptor.cards.map((card) => keyFor(card.col, card.row));
            if (keys.some((key) => used.has(key))) return;
            keys.forEach((key) => used.add(key));
            chosen.push(descriptor);
          });
        return chosen;
      };

      const resolvePokedexCombos = (map: Map<string, BoardCard>): ComboDescriptor[] => {
        const all = Array.from(map.values()).filter((card): card is BoardCard & PokemonCard => card.kind === "pokemon");
        const bottomRow = maxRows - 1;
        const requiredColumnHeight = bottomRow + 1;

        const typeWindows = buildContiguousGroups(
          all,
          "col",
          "row",
          (left, right, anchor) => left.pokemonType1 === right.pokemonType1 && right.pokemonType1 === anchor.pokemonType1
        );
        const typeDescriptors = mergeDescriptorCards(
          mergeOverlappingGroups(typeWindows)
            .filter((group) => {
              const sortedByRow = [...group].sort((left, right) => left.row - right.row);
              const topCard = sortedByRow[0];
              const bottomCard = sortedByRow[sortedByRow.length - 1];
              const reachesTop = Number(topCard.row) === 0;
              const anchoredOnBottom = Number(bottomCard.row) === bottomRow;
              const isSingleColumn = group.every((card) => card.col === topCard.col);
              const fillsEntireColumn = group.length >= requiredColumnHeight;
              return reachesTop && anchoredOnBottom && isSingleColumn && fillsEntireColumn;
            })
            .map((group) => ({
              type: "type" as const,
              comboKey: `type:${group[0].pokemonType1}`,
              bonus: group.length * 3,
              cards: group
            }))
        );

        const horizontalEvolutionGroups = buildContiguousGroups(
          all,
          "row",
          "col",
          (left, right, anchor) =>
            Boolean(left.evolutionChainId) && left.evolutionChainId === right.evolutionChainId && right.evolutionChainId === anchor.evolutionChainId
        );
        const verticalEvolutionGroups = buildContiguousGroups(
          all,
          "col",
          "row",
          (left, right, anchor) =>
            Boolean(left.evolutionChainId) && left.evolutionChainId === right.evolutionChainId && right.evolutionChainId === anchor.evolutionChainId
        );
        const evolutionDescriptors = mergeDescriptorCards(
          mergeOverlappingGroups([...horizontalEvolutionGroups, ...verticalEvolutionGroups])
            .filter((group) => {
              const uniqueStages = new Set(group.map((card) => card.evolutionStage).filter((stage) => Number.isFinite(stage)));
              return group.length >= 2 && uniqueStages.size >= 2;
            })
            .map((group) => ({
              type: "evolved" as const,
              comboKey: `evo:${group[0].evolutionChainId}`,
              bonus: group.length * 4,
              cards: group
            }))
        );

        return chooseNonOverlappingDescriptors([...evolutionDescriptors, ...typeDescriptors]);
      };

      const isValidTowerPlacement = (map: Map<string, BoardCard>, col: number, row: number) => {
        const bottomRow = maxRows - 1;
        if (row === bottomRow) return true;
        const supportCard = getCardAtFrom(map, col, row + 1);
        if (!supportCard) return false;
        if (mode === GAME_MODE.POKEDEX && nextCard.kind === "pokemon" && supportCard.kind === "pokemon") {
          return supportCard.pokemonType1 === nextCard.pokemonType1;
        }
        return true;
      };

      setBoard((prev) => {
        const nextMap = new Map(prev);
        let finalCol = targetCol;
        let finalRow = targetRow;
        if (getCardAtFrom(nextMap, finalCol, finalRow)) {
          const slot = findNearestOpenSlot(finalCol, finalRow, nextMap);
          if (!slot) {
            setIsGameOver(true);
            return prev;
          }
          finalCol = slot.col;
          finalRow = slot.row;
        }
        if (!isValidTowerPlacement(nextMap, finalCol, finalRow)) {
          setIsGameOver(true);
          return prev;
        }
        setCardAt(nextMap, finalCol, finalRow, nextCard);
        setScore((value) => value + CARD_BASE_POINTS);

        const descriptors = mode === GAME_MODE.POKEDEX ? resolvePokedexCombos(nextMap) : resolveClassicCombos(nextMap);
        descriptors.forEach((descriptor) => {
          descriptor.cards.forEach((card) => {
            nextMap.delete(keyFor(card.col, card.row));
          });
          const randomAnchor = descriptor.cards[Math.floor(Math.random() * descriptor.cards.length)];
          const evolvedAnchor =
            descriptor.type === "evolved"
              ? pickFinalEvolutionCard(descriptor.cards.filter((card): card is BoardCard & PokemonCard => card.kind === "pokemon"))
              : null;
          const anchor = evolvedAnchor || randomAnchor;
          if (!anchor) return;
          const col = anchor.col;
          let row = maxRows - 1;
          while (row >= 0 && getCardAtFrom(nextMap, col, row)) row -= 1;
          if (row < 0) {
            setIsGameOver(true);
            return;
          }
          const special: Card = {
            ...anchor,
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
            type: descriptor.type,
            value: descriptor.cards.reduce((sum, card) => sum + Number(card.value || CARD_BASE_POINTS), 0) + descriptor.bonus
          };
          setCardAt(nextMap, col, row, special);
          setScore((value) => value + descriptor.bonus);
        });

        return nextMap;
      });

      if (mode === GAME_MODE.CLASSIC) {
        setDrawPile((prev) => {
          const nextPile = prev.slice(0, -1);
          if (!nextPile.length) setIsDeckComplete(true);
          setNextCard(determineNextCard(mode, nextPile, []));
          return nextPile;
        });
      } else {
        setPokedexDrawPile((prev) => {
          const sourcePile = prev.length ? prev : shuffleList(pokedexPool);
          if (!sourcePile.length) {
            setNextCard(null);
            return [];
          }
          let nextPile = sourcePile.slice(0, -1);
          if (!nextPile.length) {
            const reshuffled = shuffleList(pokedexPool);
            nextPile = reshuffled.slice(0, -1);
            setNextCard(determineNextCard(mode, [], reshuffled));
            return nextPile;
          }
          setNextCard(determineNextCard(mode, [], nextPile));
          return nextPile;
        });
      }
    },
    [
      nextCard,
      isGameOver,
      isDeckComplete,
      isDeckLoading,
      getGridCoordsFromPointer,
      columns,
      rowsCapacity,
      mode,
      determineNextCard,
      drawPile,
      pokedexPool,
      setCardAt
    ]
  );

  const loadHighscores = useCallback(async () => {
    if (convexUrl) {
      try {
        const payload = (await getConvexClient().query(api.cardTowerHighscores.list, {})) as Highscore[];
        setHighscores(Array.isArray(payload) ? payload : []);
      } catch {
        setHighscores([]);
      }
      return;
    }
    try {
      const payload = JSON.parse(localStorage.getItem(HIGHSCORES_CACHE_KEY) || "[]") as Highscore[];
      setHighscores(Array.isArray(payload) ? payload : []);
    } catch {
      setHighscores([]);
    }
  }, []);

  const loadPokedexPool = useCallback(async (limit = INITIAL_POKEDEX_POOL_SIZE, force = false) => {
    const requestedLimit = Math.max(1, Math.min(FULL_POKEDEX_POOL_SIZE, Number(limit) || INITIAL_POKEDEX_POOL_SIZE));
    if (!force) {
      try {
        const rawCache = localStorage.getItem(POKEDEX_CACHE_KEY);
        if (rawCache) {
          const parsed = JSON.parse(rawCache) as { cachedAt?: number; cards?: PokedexEntry[] };
          const cachedCards = Array.isArray(parsed.cards) ? parsed.cards : [];
          if (Date.now() - Number(parsed.cachedAt || 0) <= POKEDEX_CACHE_TTL_MS && cachedCards.length >= requestedLimit) {
            setPokedexPool(cachedCards);
            return cachedCards;
          }
        }
      } catch {
        // Ignore storage cache failures.
      }
    }
    const payload = (await getConvexClient().query(api.pokedex.listDeck, {
      limit: requestedLimit
    })) as PokedexEntry[];
    if (!Array.isArray(payload) || !payload.length) throw new Error("No pokedex data returned");
    setPokedexPool(payload);
    try {
      localStorage.setItem(
        POKEDEX_CACHE_KEY,
        JSON.stringify({
          cachedAt: Date.now(),
          cards: payload
        })
      );
    } catch {
      // Ignore quota/storage errors.
    }
    return payload;
  }, []);

  const resetGame = useCallback(async (targetMode: GameMode) => {
    setIsDeckLoading(true);
    setBoard(new Map());
    setScore(0);
    setIsGameOver(false);
    setIsDeckComplete(false);
    try {
      if (targetMode === GAME_MODE.POKEDEX) {
        setDrawPile([]);
        setPokedexDrawPile([]);
        try {
          const fullPool = await loadPokedexPool(FULL_POKEDEX_POOL_SIZE);
          const cyclePool = pickRandomSubset(fullPool, INITIAL_POKEDEX_POOL_SIZE);
          setPokedexPool(cyclePool);
          const shuffled = shuffleList(cyclePool);
          const nextPile = shuffled.slice(0, -1);
          setPokedexDrawPile(nextPile);
          setNextCard(determineNextCard(targetMode, [], shuffled));
        } catch {
          const pile = createShuffledDeck();
          setMode(GAME_MODE.CLASSIC);
          setDrawPile(pile);
          setPokedexDrawPile([]);
          setNextCard(determineNextCard(GAME_MODE.CLASSIC, pile, []));
        }
      } else {
        const pile = createShuffledDeck();
        setDrawPile(pile);
        setPokedexDrawPile([]);
        setNextCard(determineNextCard(targetMode, pile, []));
      }
    } finally {
      setIsDeckLoading(false);
    }
  }, [loadPokedexPool, determineNextCard]);

  useEffect(() => {
    const savedName = normalizePlayerName(localStorage.getItem(PLAYER_NAME_CACHE_KEY) || "");
    if (savedName) setPlayerName(savedName);
    void loadHighscores();
  }, [loadHighscores]);

  useEffect(() => {
    setHudPanelOffset(clampPanelOffset(readPanelOffset(HUD_PANEL_OFFSET_KEY)));
    setDeckPanelOffset(clampDeckPanelOffsetToViewport(readPanelOffset(DECK_PANEL_OFFSET_KEY)));
    setDeckPanelSize(clampDeckPanelSize(readDeckPanelSize(DECK_PANEL_SIZE_KEY)));
  }, [clampDeckPanelOffsetToViewport]);

  useEffect(() => {
    deckPanelOffsetRef.current = deckPanelOffset;
  }, [deckPanelOffset]);

  useEffect(() => {
    const onViewportResize = () => {
      setHudPanelOffset((prev) => clampPanelOffset(prev));
      setDeckPanelOffset((prev) => clampDeckPanelOffsetToViewport(prev));
      setDeckPanelSize((prev) => clampDeckPanelSize(prev));
    };
    window.addEventListener("resize", onViewportResize);
    return () => {
      window.removeEventListener("resize", onViewportResize);
    };
  }, [clampDeckPanelOffsetToViewport]);

  useEffect(() => {
    setDeckPanelOffset((prev) => clampDeckPanelOffsetToViewport(prev));
  }, [deckPanelSize.width, deckPanelSize.height, clampDeckPanelOffsetToViewport]);

  useEffect(() => {
    if (!panelDrag) return;
    const { pointerId, startX, startY, originX, originY, kind } = panelDrag;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      const next = {
        x: originX + (event.clientX - startX),
        y: originY + (event.clientY - startY)
      };
      if (kind === "hud") {
        setHudPanelOffset(clampPanelOffset(next));
      } else {
        setDeckPanelOffset(clampDeckPanelOffsetToViewport(next));
      }
    };
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (kind === "hud") {
        setHudPanelOffset((pos) => {
          const c = clampPanelOffset(pos);
          try {
            sessionStorage.setItem(HUD_PANEL_OFFSET_KEY, JSON.stringify(c));
          } catch {
            // storage full or private mode
          }
          return c;
        });
      } else {
        setDeckPanelOffset((pos) => {
          const c = clampDeckPanelOffsetToViewport(pos);
          try {
            sessionStorage.setItem(DECK_PANEL_OFFSET_KEY, JSON.stringify(c));
          } catch {
            // ignore
          }
          return c;
        });
      }
      setPanelDrag(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [panelDrag, clampDeckPanelOffsetToViewport]);

  useEffect(() => {
    if (!panelResize) return;
    const { pointerId, startX, startY, originWidth, originHeight } = panelResize;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      const next = clampDeckPanelSize({
        width: originWidth + (event.clientX - startX),
        height: Math.max(0, originHeight + (event.clientY - startY))
      });
      setDeckPanelSize(next);
    };
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      setDeckPanelSize((size) => {
        const clamped = clampDeckPanelSize(size);
        try {
          sessionStorage.setItem(DECK_PANEL_SIZE_KEY, JSON.stringify(clamped));
        } catch {
          // ignore storage issues
        }
        return clamped;
      });
      setPanelResize(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [panelResize]);

  useEffect(() => {
    resetGameRef.current = resetGame;
  }, [resetGame]);

  useEffect(() => {
    void resetGameRef.current(mode);
  }, [mode]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!isDragging) return;
      event.preventDefault();
      setDragGhost((prev) =>
        prev
          ? {
              ...prev,
              x: event.clientX - dragOffset.x + CARD_WIDTH / 2,
              y: event.clientY - dragOffset.y + CARD_HEIGHT / 2
            }
          : prev
      );
    };
    const up = (event: PointerEvent) => {
      if (!isDragging) return;
      event.preventDefault();
      const rect = towerZoneRef.current?.getBoundingClientRect();
      const inside = !!rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside) placeDrawnCard(event.clientX, event.clientY);
      setIsDragging(false);
      setDragGhost(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [isDragging, dragOffset, placeDrawnCard]);

  const deckCountLabel =
    mode === GAME_MODE.POKEDEX
      ? `${(nextCard ? 1 : 0) + pokedexDrawPile.length} cards in cycle`
      : `${drawPile.length > 0 ? drawPile.length - 1 : 0} ${(drawPile.length - 1) === 1 ? "card" : "cards"} left`;

  const onSaveScore = async () => {
    if (!board.size) {
      alert("Place at least one card first!");
      return;
    }
    const name = normalizePlayerName(playerName);
    if (!name) {
      alert("Please enter your name before saving.");
      return;
    }
    try {
      localStorage.setItem(PLAYER_NAME_CACHE_KEY, name);
      if (convexUrl) {
        const nextScores = (await getConvexClient().mutation(api.cardTowerHighscores.submit, {
          name,
          score,
          cards: board.size,
          rows: rowsUsed
        })) as Highscore[];
        setHighscores(Array.isArray(nextScores) ? nextScores : []);
        return;
      }
      const existing = JSON.parse(localStorage.getItem(HIGHSCORES_CACHE_KEY) || "[]") as Highscore[];
      const nextScores = [
        ...existing,
        {
          name,
          score,
          cards: board.size,
          rows: rowsUsed
        }
      ]
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 10);
      localStorage.setItem(HIGHSCORES_CACHE_KEY, JSON.stringify(nextScores));
      setHighscores(nextScores);
    } catch {
      alert("Could not save the score.");
    }
  };

  const onNextCard = useCallback(() => {
    if (isDeckLoading || !nextCard) return;

    if (mode === GAME_MODE.POKEDEX && nextCard.kind === "pokemon") {
      const currentEntry: PokedexEntry = {
        dexNumber: Number(nextCard.dexNumber),
        name: nextCard.name,
        type1: nextCard.pokemonType1,
        type2: nextCard.pokemonType2
      };

      setPokedexDrawPile((prev) => {
        const sourcePile = prev.length ? prev : shuffleList(pokedexPool);
        if (!sourcePile.length) return prev;
        const upcoming = sourcePile[sourcePile.length - 1];
        const remaining = sourcePile.slice(0, -1);
        const nextPile = [currentEntry, ...remaining];
        setNextCard(createPokemonCard(upcoming));
        return nextPile;
      });
      return;
    }

    if (mode === GAME_MODE.CLASSIC && nextCard.kind === "classic") {
      setDrawPile((prev) => {
        if (!prev.length) return prev;
        const upcoming = prev[prev.length - 1];
        const remaining = prev.slice(0, -1);
        const nextPile = [nextCard, ...remaining];
        setNextCard(upcoming);
        return nextPile;
      });
    }
  }, [isDeckLoading, nextCard, mode, pokedexPool, createPokemonCard]);

  const onHudDragHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panelDrag || panelResize || isDragging) return;
    event.preventDefault();
    event.stopPropagation();
    setPanelDrag({
      kind: "hud",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: hudPanelOffset.x,
      originY: hudPanelOffset.y
    });
  };

  const onDeckPanelPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panelDrag || isDragging) return;
    const el = event.target;
    if (!(el instanceof Element)) return;
    if (el.closest(".deck-tower-card-preview")) return;
    if (el.closest("button, input, textarea, label, a")) return;
    event.preventDefault();
    setPanelDrag({
      kind: "deck",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: deckPanelOffset.x,
      originY: deckPanelOffset.y
    });
  };

  const onDeckResizeHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panelDrag || panelResize || isDragging) return;
    event.preventDefault();
    event.stopPropagation();
    setPanelResize({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: deckPanelSize.width,
      originHeight: deckPanelSize.height
    });
  };

  return (
    <main className="modern-game-page game">
      <section className="top-bar">
        <div
          className={`hud-toggle-bar draggable-overlay ${panelDrag?.kind === "hud" ? "is-panel-dragging" : ""}`}
          aria-label="HUD panel toggles"
          style={
            {
              ["--hud-ox" as string]: `${hudPanelOffset.x}px`,
              ["--hud-oy" as string]: `${hudPanelOffset.y}px`
            } as CSSProperties
          }
        >
          <div
            className="hud-drag-handle"
            title="Drag to move"
            aria-label="Drag to reposition HUD"
            onPointerDown={onHudDragHandlePointerDown}
          >
            <span className="hud-drag-grip" aria-hidden />
          </div>
          <button
            className={`hud-toggle-button ${panelHidden.title ? "" : "active"}`}
            aria-label="Toggle game rules"
            title="Game rules"
            onClick={() => setPanelHidden((prev) => ({ ...prev, title: !prev.title }))}
          >
            <img className="hud-toggle-icon" src="/info.svg" alt="" aria-hidden />
          </button>
          <button
            className={`hud-toggle-button ${panelHidden.deck ? "" : "active"}`}
            aria-label="Toggle deck panel"
            title="Deck panel"
            onClick={() => setPanelHidden((prev) => ({ ...prev, deck: !prev.deck }))}
          >
            <img className="hud-toggle-icon" src="/book-alert.svg" alt="" aria-hidden />
          </button>
          <button
            className={`hud-toggle-button ${panelHidden.score ? "" : "active"}`}
            aria-label="Toggle score panel"
            title="Current score"
            onClick={() => setPanelHidden((prev) => ({ ...prev, score: !prev.score }))}
          >
            <img className="hud-toggle-icon" src="/leaderboard-svgrepo-com.svg" alt="" aria-hidden />
          </button>
          <button
            className={`hud-toggle-button ${panelHidden.highscores ? "" : "active"}`}
            aria-label="Toggle highscores panel"
            title="Highscores"
            onClick={() => setPanelHidden((prev) => ({ ...prev, highscores: !prev.highscores }))}
          >
            <img className="hud-toggle-icon" src="/trophy.svg" alt="" aria-hidden />
          </button>
        </div>

        <div className={`title-wrap draggable-overlay ${panelHidden.title ? "is-hidden" : ""}`} data-panel="title">
          <h1>PokiStack</h1>
          <p>
            Build your tower by matching Pokemon primary types in connected lines. Every drop is worth 5 points, type combos
            create golden bonus cards, and chain evolutions can trigger bigger multipliers. A bad drop still ends the run,
            so build from the bottom up.
          </p>
          <div className="mode-switch">
            <span>Mode: {mode === GAME_MODE.POKEDEX ? "Pokedex Deck" : "Classic Deck"}</span>
          </div>
        </div>

        <div
          ref={deckPanelRef}
          className={`deck-panel deck-panel-compact draggable-overlay ${panelHidden.deck ? "is-hidden" : ""} ${panelDrag?.kind === "deck" ? "is-panel-dragging" : ""}`}
          data-panel="deck"
          style={
            {
              ["--panel-ox" as string]: `${deckPanelOffset.x}px`,
              ["--panel-oy" as string]: `${deckPanelOffset.y}px`,
              ["--panel-w" as string]: `${deckPanelSize.width}px`,
              ["--panel-h" as string]: deckPanelSize.height > 0 ? `${deckPanelSize.height}px` : "auto"
            } as CSSProperties
          }
          onPointerDown={onDeckPanelPointerDown}
        >
          <h2>Deck</h2>
          <div className="deck">
              <div
              className={`card deck-tower-card-preview ${nextCard?.color || ""} ${nextCard?.kind === "pokemon" ? `pokemon-card pokemon-preview ${getPokemonTypeClass(nextCard.pokemonType1)}` : ""} ${!nextCard ? "deck-empty" : ""}`}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => {
                if (!nextCard || isGameOver || isDeckComplete || isDeckLoading) return;
                event.preventDefault();
                event.stopPropagation();
                try {
                  (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
                } catch {
                  // Pointer capture can fail on some devices.
                }
                const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                setDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top });
                setIsDragging(true);
                setDragGhost({
                  x: event.clientX - (event.clientX - rect.left) + CARD_WIDTH / 2,
                  y: event.clientY - (event.clientY - rect.top) + CARD_HEIGHT / 2,
                  card: nextCard
                });
              }}
              onDragStart={(event) => event.preventDefault()}
            >
              {isDeckLoading ? (
                <div className="deck-loading-indicator" aria-live="polite" aria-label="Compiling deck">
                  <span className="deck-spinner" />
                  <span className="deck-loading-text">Compiling deck</span>
                </div>
              ) : !nextCard ? (
                "✓"
              ) : nextCard.kind === "pokemon" ? (
                <>
                  <img src={nextCard.imageUrl} alt={nextCard.name} draggable={false} />
                  <span className="pokemon-name">{nextCard.name}</span>
                  <span className="pokemon-dex">#{String(nextCard.dexNumber).padStart(3, "0")}</span>
                </>
              ) : (
                nextCard.suit
              )}
            </div>
          </div>
          <p className="next-card-info">
            {isDeckLoading ? "Building randomized Pokemon deck..." : !nextCard ? "Deck exhausted" : nextCard.kind === "pokemon" ? `Next: ${nextCard.name}` : `Next: ${nextCard.suitName}`}
          </p>
          <p className="deck-count-info">{isDeckLoading ? "Please wait..." : !nextCard ? (mode === GAME_MODE.POKEDEX ? "0 cards in cycle" : "0 cards left") : deckCountLabel}</p>
          <div className="deck-actions">
            <div className="player-name-field">
              <label htmlFor="playerNameInput">Player Name</label>
              <input
                id="playerNameInput"
                type="text"
                maxLength={20}
                placeholder="Kiddo"
                value={playerName}
                onChange={(event) => setPlayerName(normalizePlayerName(event.target.value))}
              />
            </div>
            <button onClick={onNextCard} disabled={isDeckLoading || !nextCard}>Next Card</button>
            <button onClick={() => void resetGame(mode)} disabled={isDeckLoading}>New Tower</button>
            <button onClick={() => void onSaveScore()} disabled={isDeckLoading}>Save Score</button>
          </div>
          <div
            className={`deck-panel-resize-handle ${panelResize ? "is-resizing" : ""}`}
            title="Resize panel"
            role="button"
            aria-label="Resize deck panel"
            onPointerDown={onDeckResizeHandlePointerDown}
          />
        </div>

        <div className={`core-box draggable-overlay ${panelHidden.score ? "is-hidden" : ""}`} data-panel="score">
          <div className="score-box">
            <div>
              Cards: <span>{board.size}</span>
            </div>
            <div>
              Rows: <span>{rowsUsed}</span>
            </div>
            <div>
              Score: <span>{score}</span>
            </div>
            <div>
              Rule: <span>{mode === GAME_MODE.POKEDEX ? "Primary Type Match" : "Suit Match"}</span>
            </div>
          </div>
        </div>

        <div className={`highscores-panel highscores-compact draggable-overlay ${panelHidden.highscores ? "is-hidden" : ""}`} data-panel="highscores">
          <h2>Top 3 High Scores</h2>
          <ol>
            {highscores.length ? (
              highscores.slice(0, 3).map((entry, index) => (
                <li key={`${index}-${entry.name}-${entry.score}`}>
                  {entry.name}: {entry.score} points ({entry.cards} cards, {entry.rows} rows)
                </li>
              ))
            ) : (
              <li>No scores yet</li>
            )}
          </ol>
        </div>
      </section>

      <section className="play-area">
        <div className="tower-panel">
          <div
            ref={towerZoneRef}
            className={`tower-zone ${isDragging ? "ready" : ""} ${isGameOver ? "game-over" : ""} ${isDeckComplete ? "game-complete" : ""}`}
            onPointerDown={(event) => {
              if (isDragging || !nextCard || isGameOver || isDeckComplete || isDeckLoading) return;
              setPendingTap({ id: event.pointerId, x: event.clientX, y: event.clientY });
            }}
            onPointerMove={(event) => {
              if (!pendingTap || pendingTap.id !== event.pointerId) return;
              const movedX = Math.abs(event.clientX - pendingTap.x);
              const movedY = Math.abs(event.clientY - pendingTap.y);
              if (movedX > TAP_MOVE_THRESHOLD_PX || movedY > TAP_MOVE_THRESHOLD_PX) setPendingTap(null);
            }}
            onPointerUp={(event) => {
              if (!pendingTap || pendingTap.id !== event.pointerId) return;
              setPendingTap(null);
              placeDrawnCard(event.clientX, event.clientY);
            }}
          >
            {isGameOver ? <div className="game-over-banner">Game Over! Tower toppled!</div> : null}
            {isDeckComplete ? <div className="game-complete-banner">Deck clear! Save your score or start a new tower.</div> : null}
            <div className="tower">
              {cards
                .sort((a, b) => a.row - b.row || a.col - b.col)
                .map((card) => {
                  const x = gridLeftOffset() + card.col * (CARD_WIDTH + gridGapX());
                  const y = gridTopOffset() + card.row * (CARD_HEIGHT + gridGapY());
                  const specialBadge =
                    card.type === "normal" ? null : (
                      <span className="pokemon-special-badge">
                        {`+${card.value}`}
                      </span>
                    );
                  return (
                    <div
                      key={card.id}
                      className={`stacked-card ${card.color} card-type-${card.type} ${card.kind === "pokemon" ? "pokemon-card" : ""} pokemon-type-${card.kind === "pokemon" ? card.pokemonType1 : "unknown"}`}
                      style={{ left: `${x}px`, top: `${y}px` }}
                    >
                      {card.kind === "pokemon" ? (
                        <>
                          <img src={card.imageUrl} alt={card.name} draggable={false} />
                          <span className="pokemon-name">{card.name}</span>
                          <span className="pokemon-dex">#{String(card.dexNumber).padStart(3, "0")}</span>
                          {specialBadge}
                        </>
                      ) : card.type === "normal" ? (
                        card.suit
                      ) : (
                        <>
                          <div className="special-card-top">{card.suit}</div>
                          <div className="special-card-label">{card.type.toUpperCase()}!</div>
                          <div className="special-card-points">{card.value} pts</div>
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </section>

      {dragGhost ? (
        <div
          className={`card dragging ${dragGhost.card.color} ${dragGhost.card.kind === "pokemon" ? `pokemon-card pokemon-preview ${getPokemonTypeClass(dragGhost.card.pokemonType1)}` : ""}`}
          style={{ left: dragGhost.x, top: dragGhost.y }}
        >
          {dragGhost.card.kind === "pokemon" ? (
            <>
              <img src={dragGhost.card.imageUrl} alt={dragGhost.card.name} draggable={false} />
              <span className="pokemon-name">{dragGhost.card.name}</span>
              <span className="pokemon-dex">#{String(dragGhost.card.dexNumber).padStart(3, "0")}</span>
            </>
          ) : (
            dragGhost.card.suit
          )}
        </div>
      ) : null}
    </main>
  );
}
