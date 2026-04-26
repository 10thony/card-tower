const dragCard = document.getElementById("dragCard");
const towerZone = document.getElementById("towerZone");
const tower = document.getElementById("tower");
const cardCountEl = document.getElementById("cardCount");
const rowCountEl = document.getElementById("rowCount");
const scoreEl = document.getElementById("score");
const ruleTextEl = document.getElementById("ruleText");
const nextCardInfoEl = document.getElementById("nextCardInfo");
const deckCountInfoEl = document.getElementById("deckCountInfo");
const toggleModeButton = document.getElementById("toggleModeButton");
const modeLabelEl = document.getElementById("modeLabel");
const resetButton = document.getElementById("resetButton");
const saveButton = document.getElementById("saveButton");
const highscoresEl = document.getElementById("highscores");
const playerNameInput = document.getElementById("playerNameInput");

const CARD_WIDTH = 74;
const CARD_HEIGHT = 108;
const CELL_GAP_X = 8;
const CELL_GAP_Y = 10;
const CARD_BASE_POINTS = 5;
const DECK_SIZE = 24;
const INITIAL_POKEDEX_POOL_SIZE = 24;
const FULL_POKEDEX_POOL_SIZE = 151;
const POKEDEX_CACHE_KEY = "cardTower.pokedexPool.v1";
const POKEDEX_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAYER_NAME_CACHE_KEY = "cardTower.playerName.v1";
const POKEMON_TYPE_CLASS_PREFIX = "pokemon-type-";
const TAP_MOVE_THRESHOLD_PX = 12;
const GAME_MODE = {
  CLASSIC: "classic",
  POKEDEX: "pokedex"
};
const TYPE_COMBO_MIN_CARDS = 5;
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
const SUITS = [
  { symbol: "♥", name: "hearts", color: "red" },
  { symbol: "♦", name: "diamonds", color: "red" },
  { symbol: "♣", name: "clubs", color: "black" },
  { symbol: "♠", name: "spades", color: "black" }
];

const board = new Map();

let pointerOffsetX = 0;
let pointerOffsetY = 0;
let activeDragClone = null;
let isDragging = false;
let nextCard = null;
let score = 0;
let isGameOver = false;
let gameOverBanner = null;
let gameOverCard = null;
let drawPile = [];
let isDeckComplete = false;
let completeBanner = null;
let currentMode = GAME_MODE.POKEDEX;
let pokedexPool = [];
let isLoadingPokedex = false;
let pokedexWarmPromise = null;
const evolutionByDex = new Map();
const pokemonNameByDex = new Map();
let pendingTapPlacement = null;

function makeCardFromSuit(suit) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    type: "normal",
    suit: suit.symbol,
    suitName: suit.name,
    color: suit.color,
    value: CARD_BASE_POINTS
  };
}

function randomSuit() {
  return SUITS[Math.floor(Math.random() * SUITS.length)];
}

function createShuffledDeck() {
  const cards = Array.from({ length: DECK_SIZE }, () => makeCardFromSuit(randomSuit()));
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function getPokemonImageUrl(dexNumber) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexNumber}.png`;
}

function makeCardFromPokemon(pokemon) {
  const type1 = String(pokemon.type1 || "unknown");
  const color = ["fire", "fighting", "electric", "dragon"].includes(type1) ? "red" : "black";
  const evolutionMeta = evolutionByDex.get(Number(pokemon.dexNumber)) || null;
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    kind: "pokemon",
    type: "normal",
    dexNumber: pokemon.dexNumber,
    name: pokemon.name,
    imageUrl: getPokemonImageUrl(pokemon.dexNumber),
    pokemonType1: type1,
    pokemonType2: pokemon.type2 || null,
    evolutionChainId: evolutionMeta?.chainId || null,
    evolutionStage: evolutionMeta?.stage || null,
    evolutionFinalDex: evolutionMeta?.finalDex || null,
    evolutionFinalName: evolutionMeta?.finalName || null,
    color,
    value: CARD_BASE_POINTS
  };
}

function createRandomPokedexCard() {
  if (!pokedexPool.length) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * pokedexPool.length);
  return makeCardFromPokemon(pokedexPool[randomIndex]);
}

function createNextCard() {
  if (currentMode === GAME_MODE.POKEDEX) {
    nextCard = createRandomPokedexCard();
  } else {
    nextCard = drawPile.pop() || null;
  }
  updateDeckCard();
}

function keyFor(col, row) {
  return `${col},${row}`;
}

function getCardAt(col, row) {
  return board.get(keyFor(col, row)) || null;
}

function setCardAt(col, row, card) {
  board.set(keyFor(col, row), { ...card, col, row });
}

function removeCardAt(col, row) {
  board.delete(keyFor(col, row));
}

function getBoardCards() {
  return Array.from(board.values());
}

function getColumns() {
  return Math.max(1, Math.floor((towerZone.clientWidth - 16) / (CARD_WIDTH + CELL_GAP_X)));
}

function getRowsCapacity() {
  return Math.max(1, Math.floor((towerZone.clientHeight - 16) / (CARD_HEIGHT + CELL_GAP_Y)));
}

function getRowsUsed() {
  const cards = getBoardCards();
  if (!cards.length) {
    return 0;
  }

  const uniqueRows = new Set(cards.map((card) => card.row));
  return uniqueRows.size;
}

function updateStats() {
  cardCountEl.textContent = String(board.size);
  rowCountEl.textContent = String(getRowsUsed());
  scoreEl.textContent = String(score);
}

function formatCardFace(card) {
  if (card.kind === "pokemon") {
    return card.name;
  }
  return card.suit;
}

function formatDexLabel(card) {
  return `#${String(card.dexNumber).padStart(3, "0")}`;
}

function normalizePlayerName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, 20);
}

function getSavedPlayerName() {
  try {
    return normalizePlayerName(localStorage.getItem(PLAYER_NAME_CACHE_KEY));
  } catch {
    return "";
  }
}

function cachePlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_CACHE_KEY, name);
  } catch {
    // Ignore storage errors.
  }
}

function clearPokemonTypeClasses(element) {
  Array.from(element.classList).forEach((className) => {
    if (className.startsWith(POKEMON_TYPE_CLASS_PREFIX)) {
      element.classList.remove(className);
    }
  });
}

function getPokemonTypeClass(typeName) {
  const safeType = String(typeName || "unknown").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return `${POKEMON_TYPE_CLASS_PREFIX}${safeType || "unknown"}`;
}

function updateModeUI() {
  if (modeLabelEl) {
    modeLabelEl.textContent =
      currentMode === GAME_MODE.POKEDEX ? "Mode: Pokedex Deck" : "Mode: Classic Deck";
  }
  if (toggleModeButton) {
    toggleModeButton.textContent =
      currentMode === GAME_MODE.POKEDEX ? "Switch to Classic Deck" : "Switch to Pokedex Deck";
  }
  if (ruleTextEl) {
    ruleTextEl.textContent = currentMode === GAME_MODE.POKEDEX ? "Primary Type Match" : "Suit Match";
  }
}

function updateDeckCard() {
  if (!nextCard) {
    clearPokemonTypeClasses(dragCard);
    dragCard.classList.remove("red", "black");
    dragCard.classList.remove("pokemon-card", "pokemon-preview");
    dragCard.classList.add("deck-empty");
    dragCard.textContent = "✓";
    dragCard.setAttribute("aria-label", "Deck complete");
    dragCard.title = "Deck exhausted. Start a new tower to play another run.";
    if (nextCardInfoEl) {
      nextCardInfoEl.textContent = "Deck exhausted";
    }
    if (deckCountInfoEl) {
      deckCountInfoEl.textContent =
        currentMode === GAME_MODE.POKEDEX ? "∞ cards left" : "0 cards left";
    }
    return;
  }

  dragCard.classList.remove("deck-empty");
  dragCard.classList.remove("red", "black");
  clearPokemonTypeClasses(dragCard);
  dragCard.classList.add(nextCard.color);

  if (nextCard.kind === "pokemon") {
    dragCard.classList.add("pokemon-card", "pokemon-preview");
    dragCard.classList.add(getPokemonTypeClass(nextCard.pokemonType1));
    dragCard.innerHTML = `
      <img src="${nextCard.imageUrl}" alt="${nextCard.name}" />
      <span class="pokemon-name">${nextCard.name}</span>
      <span class="pokemon-dex">${formatDexLabel(nextCard)}</span>
    `;
    dragCard.setAttribute("aria-label", `Next pokemon ${nextCard.name}`);
    dragCard.title = `Next Pokemon: ${nextCard.name} ${formatDexLabel(nextCard)}.`;
    if (nextCardInfoEl) {
      nextCardInfoEl.textContent = `Next: ${nextCard.name}`;
    }
  } else {
    dragCard.classList.remove("pokemon-card", "pokemon-preview");
    dragCard.textContent = nextCard.suit;
    dragCard.setAttribute("aria-label", `Next card ${nextCard.suitName}`);
    dragCard.title = `Match by suit (active): ${nextCard.suitName}. Color (${nextCard.color}) is displayed but not used for matching.`;
    if (nextCardInfoEl) {
      const colorLabel = nextCard.color === "red" ? "Red" : "Black";
      nextCardInfoEl.textContent = `Next: ${nextCard.suitName[0].toUpperCase()}${nextCard.suitName.slice(1)} (${colorLabel})`;
    }
  }
  if (deckCountInfoEl) {
    if (currentMode === GAME_MODE.POKEDEX) {
      deckCountInfoEl.textContent = "∞ cards left";
    } else {
      const remaining = drawPile.length;
      deckCountInfoEl.textContent = `${remaining} ${remaining === 1 ? "card" : "cards"} left`;
    }
  }
}

function createBoardCardEl(card) {
  const cardEl = document.createElement("div");
  cardEl.className = "stacked-card";
  cardEl.classList.add(card.color);
  cardEl.classList.add(`card-type-${card.type}`);
  if (card.kind === "pokemon" && card.pokemonType1) {
    cardEl.classList.add(getPokemonTypeClass(card.pokemonType1));
  }

  if (card.kind === "pokemon" && card.type === "normal") {
    cardEl.classList.add("pokemon-card");
    cardEl.innerHTML = `
      <img src="${card.imageUrl}" alt="${card.name}" />
      <span class="pokemon-name">${card.name}</span>
      <span class="pokemon-dex">${formatDexLabel(card)}</span>
    `;
  } else if (card.type === "normal") {
    cardEl.textContent = formatCardFace(card);
  } else {
    const badgeMap = {
      suite: "SUITE!",
      super: "SUPER!",
      type: "TYPE!",
      evolved: "EVOLVED!"
    };
    const badge = badgeMap[card.type] || "SPECIAL!";
    cardEl.innerHTML = `
      <div class="special-card-top">${formatCardFace(card)}</div>
      <div class="special-card-label">${badge}</div>
      <div class="special-card-points">${card.value} pts</div>
    `;
  }

  const x = 8 + card.col * (CARD_WIDTH + CELL_GAP_X);
  const y = 8 + card.row * (CARD_HEIGHT + CELL_GAP_Y);
  cardEl.style.left = `${x}px`;
  cardEl.style.top = `${y}px`;

  return cardEl;
}

function redrawTower() {
  tower.innerHTML = "";

  getBoardCards()
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .forEach((card) => {
      tower.appendChild(createBoardCardEl(card));
    });

  updateStats();
}

function isInsideTowerZone(clientX, clientY) {
  const rect = towerZone.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function getGridCoordsFromPointer(clientX, clientY) {
  const rect = towerZone.getBoundingClientRect();
  const localX = clientX - rect.left - 8;
  const localY = clientY - rect.top - 8;
  const maxCol = getColumns() - 1;
  const maxRow = getRowsCapacity() - 1;
  const col = Math.max(0, Math.min(maxCol, Math.floor(localX / (CARD_WIDTH + CELL_GAP_X))));
  const row = Math.max(0, Math.min(maxRow, Math.floor(localY / (CARD_HEIGHT + CELL_GAP_Y))));
  return { col, row };
}

function findNearestOpenSlot(originCol, originRow) {
  const maxCols = getColumns();
  const maxRows = getRowsCapacity();

  if (originCol < 0 || originCol >= maxCols || originRow < 0 || originRow >= maxRows) {
    return null;
  }

  if (!getCardAt(originCol, originRow)) {
    return { col: originCol, row: originRow };
  }

  let bestSlot = null;
  let bestDistance = Infinity;

  for (let row = 0; row < maxRows; row += 1) {
    for (let col = 0; col < maxCols; col += 1) {
      if (getCardAt(col, row)) {
        continue;
      }

      const deltaCol = col - originCol;
      const deltaRow = row - originRow;
      const distance = Math.hypot(deltaCol, deltaRow);

      if (
        distance < bestDistance ||
        (distance === bestDistance && bestSlot && row > bestSlot.row)
      ) {
        bestDistance = distance;
        bestSlot = { col, row };
      }
    }
  }

  return bestSlot;
}

function findBottomMostOpenInColumn(col) {
  const maxRows = getRowsCapacity();
  for (let row = maxRows - 1; row >= 0; row -= 1) {
    if (!getCardAt(col, row)) {
      return row;
    }
  }
  return null;
}

function walkLine(startCol, startRow, deltaCol, deltaRow, predicate) {
  const result = [];
  let col = startCol + deltaCol;
  let row = startRow + deltaRow;
  while (true) {
    const card = getCardAt(col, row);
    if (!card || !predicate(card)) {
      break;
    }
    result.push({ ...card });
    col += deltaCol;
    row += deltaRow;
  }
  return result;
}

function buildContiguousGroups(cards, indexKey, contiguousKey, predicate) {
  const grouped = new Map();
  cards.forEach((card) => {
    const key = card[indexKey];
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(card);
  });

  const groups = [];
  grouped.forEach((lineCards) => {
    lineCards.sort((a, b) => a[contiguousKey] - b[contiguousKey]);
    let run = [lineCards[0]];

    for (let index = 1; index < lineCards.length; index += 1) {
      const previous = lineCards[index - 1];
      const current = lineCards[index];
      const isAdjacent = current[contiguousKey] === previous[contiguousKey] + 1;
      const isMatch = isAdjacent && predicate(previous, current, run[0]);

      if (isMatch) {
        run.push(current);
      } else {
        if (run.length >= 2) {
          groups.push([...run]);
        }
        run = [current];
      }
    }

    if (run.length >= 2) {
      groups.push([...run]);
    }
  });

  return groups;
}

function mergeOverlappingGroups(groups) {
  const merged = [];

  groups.forEach((group) => {
    const groupKeys = new Set(group.map((card) => keyFor(card.col, card.row)));
    const overlaps = [];

    for (let index = 0; index < merged.length; index += 1) {
      const existing = merged[index];
      const doesOverlap = Array.from(groupKeys).some((key) => existing.keys.has(key));
      if (doesOverlap) {
        overlaps.push(index);
      }
    }

    if (!overlaps.length) {
      merged.push({
        keys: groupKeys,
        cards: [...group]
      });
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

    merged.push({
      keys: combinedKeys,
      cards: combinedCards
    });
  });

  return merged.map((entry) => entry.cards);
}

function mergeAdjacentSuiteGroups(groups) {
  const merged = [];

  groups.forEach((group) => {
    const groupKeys = new Set(group.map((card) => keyFor(card.col, card.row)));
    const overlaps = [];

    for (let index = 0; index < merged.length; index += 1) {
      const existing = merged[index];
      const doesTouch = group.some((card) => {
        const neighbors = [
          keyFor(card.col + 1, card.row),
          keyFor(card.col - 1, card.row),
          keyFor(card.col, card.row + 1),
          keyFor(card.col, card.row - 1)
        ];
        return neighbors.some((neighbor) => existing.keys.has(neighbor)) || existing.keys.has(keyFor(card.col, card.row));
      });
      if (doesTouch) {
        overlaps.push(index);
      }
    }

    if (!overlaps.length) {
      merged.push({
        keys: groupKeys,
        cards: [...group]
      });
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

    merged.push({
      keys: combinedKeys,
      cards: combinedCards
    });
  });

  return merged.map((entry) => entry.cards);
}

function areGroupsAdjacent(groupA, groupB) {
  const keysB = new Set(groupB.cards.map((card) => keyFor(card.col, card.row)));
  return groupA.cards.some((card) => {
    const neighbors = [
      keyFor(card.col + 1, card.row),
      keyFor(card.col - 1, card.row),
      keyFor(card.col, card.row + 1),
      keyFor(card.col, card.row - 1)
    ];
    return neighbors.some((neighbor) => keysB.has(neighbor));
  });
}

function mergeComboDescriptors(groups) {
  const descriptors = groups.map((entry) => ({
    type: entry.type,
    bonus: entry.bonus,
    cards: [...entry.cards]
  }));

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < descriptors.length; i += 1) {
      for (let j = i + 1; j < descriptors.length; j += 1) {
        const left = descriptors[i];
        const right = descriptors[j];
        const suitMatch = left.cards[0]?.suit && right.cards[0]?.suit && left.cards[0].suit === right.cards[0].suit;
        if (!suitMatch) {
          continue;
        }

        const leftKeys = new Set(left.cards.map((card) => keyFor(card.col, card.row)));
        const overlaps = right.cards.some((card) => leftKeys.has(keyFor(card.col, card.row)));
        const adjacent = areGroupsAdjacent(left, right);

        if (!overlaps && !adjacent) {
          continue;
        }

        const mergedCards = [...left.cards];
        const mergedKeys = new Set(mergedCards.map((card) => keyFor(card.col, card.row)));
        right.cards.forEach((card) => {
          const key = keyFor(card.col, card.row);
          if (!mergedKeys.has(key)) {
            mergedKeys.add(key);
            mergedCards.push(card);
          }
        });

        descriptors[i] = {
          type: left.type === "super" || right.type === "super" ? "super" : "suite",
          bonus: left.bonus + right.bonus,
          cards: mergedCards
        };
        descriptors.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) {
        break;
      }
    }
  }

  return descriptors;
}

function mergeDescriptorCards(descriptors) {
  const mergedByKey = new Map();
  descriptors.forEach((descriptor) => {
    if (!mergedByKey.has(descriptor.comboKey)) {
      mergedByKey.set(descriptor.comboKey, { ...descriptor, cards: [...descriptor.cards] });
      return;
    }
    const existing = mergedByKey.get(descriptor.comboKey);
    const keys = new Set(existing.cards.map((card) => keyFor(card.col, card.row)));
    descriptor.cards.forEach((card) => {
      const cardKey = keyFor(card.col, card.row);
      if (!keys.has(cardKey)) {
        keys.add(cardKey);
        existing.cards.push(card);
      }
    });
  });
  return Array.from(mergedByKey.values());
}

function chooseNonOverlappingDescriptors(descriptors) {
  const chosen = [];
  const used = new Set();
  const priority = { evolved: 3, type: 2, super: 2, suite: 1 };
  descriptors
    .sort((left, right) => {
      const priorityDelta = (priority[right.type] || 0) - (priority[left.type] || 0);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return right.cards.length - left.cards.length;
    })
    .forEach((descriptor) => {
      const keys = descriptor.cards.map((card) => keyFor(card.col, card.row));
      const overlaps = keys.some((key) => used.has(key));
      if (overlaps) {
        return;
      }
      keys.forEach((key) => used.add(key));
      chosen.push(descriptor);
    });
  return chosen;
}

function resolveClassicCombos(cards) {
  const rawSuperGroups = buildContiguousGroups(
    cards,
    "col",
    "row",
    (left, right, anchor) =>
      left.suit === right.suit && left.color === right.color && right.suit === anchor.suit && right.color === anchor.color
  );
  const superGroups = mergeOverlappingGroups(rawSuperGroups).map((group) => ({
    type: "super",
    bonus: CARD_BASE_POINTS + 2 * group.length,
    cards: group
  }));

  const horizontalSuiteGroups = buildContiguousGroups(
    cards,
    "row",
    "col",
    (left, right, anchor) => left.suit === right.suit && right.suit === anchor.suit
  );
  const verticalSuiteGroups = buildContiguousGroups(
    cards,
    "col",
    "row",
    (left, right, anchor) => left.suit === right.suit && right.suit === anchor.suit
  );
  const rawSuiteGroups = [...horizontalSuiteGroups, ...verticalSuiteGroups];
  const suiteGroups = mergeAdjacentSuiteGroups(mergeOverlappingGroups(rawSuiteGroups)).map((group) => ({
    type: "suite",
    bonus: 2 * group.length,
    cards: group
  }));

  return mergeComboDescriptors([...superGroups, ...suiteGroups]);
}

function resolvePokedexCombos(cards) {
  const horizontalTypeGroups = buildContiguousGroups(
    cards,
    "row",
    "col",
    (left, right, anchor) => left.pokemonType1 === right.pokemonType1 && right.pokemonType1 === anchor.pokemonType1
  );
  const verticalTypeGroups = buildContiguousGroups(
    cards,
    "col",
    "row",
    (left, right, anchor) => left.pokemonType1 === right.pokemonType1 && right.pokemonType1 === anchor.pokemonType1
  );
  const typeDescriptors = mergeDescriptorCards(
    mergeOverlappingGroups([...horizontalTypeGroups, ...verticalTypeGroups])
      .filter((group) => group.length >= TYPE_COMBO_MIN_CARDS)
      .map((group) => ({
        type: "type",
        comboKey: `type:${group[0].pokemonType1}`,
        bonus: group.length * 3,
        cards: group
      }))
  );

  const horizontalEvolutionGroups = buildContiguousGroups(
    cards,
    "row",
    "col",
    (left, right, anchor) =>
      Boolean(left.evolutionChainId) &&
      left.evolutionChainId === right.evolutionChainId &&
      right.evolutionChainId === anchor.evolutionChainId
  );
  const verticalEvolutionGroups = buildContiguousGroups(
    cards,
    "col",
    "row",
    (left, right, anchor) =>
      Boolean(left.evolutionChainId) &&
      left.evolutionChainId === right.evolutionChainId &&
      right.evolutionChainId === anchor.evolutionChainId
  );
  const evolutionDescriptors = mergeDescriptorCards(
    mergeOverlappingGroups([...horizontalEvolutionGroups, ...verticalEvolutionGroups])
      .filter((group) => {
        const uniqueStages = new Set(group.map((card) => card.evolutionStage).filter((stage) => Number.isFinite(stage)));
        return group.length >= 2 && uniqueStages.size >= 2;
      })
      .map((group) => ({
        type: "evolved",
        comboKey: `evo:${group[0].evolutionChainId}`,
        bonus: group.length * 4,
        cards: group
      }))
  );

  return chooseNonOverlappingDescriptors([...evolutionDescriptors, ...typeDescriptors]);
}

function removeCardsForComboDescriptors(descriptors) {
  const removed = new Set();
  descriptors.forEach((descriptor) => {
    descriptor.cards.forEach((card) => {
      const key = keyFor(card.col, card.row);
      if (!removed.has(key)) {
        removed.add(key);
        removeCardAt(card.col, card.row);
      }
    });
  });
}

function createSpecialCardsFromDescriptors(descriptors) {
  descriptors.forEach((descriptor) => {
    const anchorCard = descriptor.cards[Math.floor(Math.random() * descriptor.cards.length)];
    const suit = anchorCard.suit;
    const suitName = anchorCard.suitName;
    const color = anchorCard.color;
    const stackedValue = descriptor.cards.reduce((sum, card) => sum + Number(card.value || CARD_BASE_POINTS), 0);
    const value = stackedValue + Number(descriptor.bonus || 0);
    const targetCol = descriptor.cards.reduce((sum, card) => sum + card.col, 0) / descriptor.cards.length;
    const nearestCol = Math.max(0, Math.min(getColumns() - 1, Math.round(targetCol)));
    const targetRow = findBottomMostOpenInColumn(nearestCol);

    if (targetRow === null) {
      triggerGameOver();
      return;
    }

    const specialCard = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-special`,
      type: descriptor.type,
      suit,
      suitName,
      color,
      value
    };

    if (anchorCard.kind === "pokemon") {
      const typeLabel = String(anchorCard.pokemonType1 || "unknown");
      if (descriptor.type === "evolved") {
        const finalDex = Number(anchorCard.evolutionFinalDex || anchorCard.dexNumber);
        specialCard.kind = "pokemon";
        specialCard.name = String(anchorCard.evolutionFinalName || anchorCard.name);
        specialCard.dexNumber = finalDex;
        specialCard.imageUrl = getPokemonImageUrl(finalDex);
        specialCard.pokemonType1 = typeLabel;
        specialCard.pokemonType2 = anchorCard.pokemonType2 || null;
      } else if (descriptor.type === "type") {
        specialCard.kind = "pokemon";
        specialCard.name = `${typeLabel.toUpperCase()} TYPE`;
        specialCard.dexNumber = anchorCard.dexNumber;
        specialCard.imageUrl = anchorCard.imageUrl;
        specialCard.pokemonType1 = typeLabel;
        specialCard.pokemonType2 = anchorCard.pokemonType2 || null;
      }
    }

    setCardAt(nearestCol, targetRow, specialCard);

    score += Number(descriptor.bonus || 0);
  });
}

function resolveAllCombos() {
  let loopGuard = 0;

  while (loopGuard < 30 && !isGameOver) {
    loopGuard += 1;
    const cards = getBoardCards();
    if (!cards.length) {
      break;
    }

    const comboDescriptors = currentMode === GAME_MODE.POKEDEX ? resolvePokedexCombos(cards) : resolveClassicCombos(cards);
    const hasAnyGroups = comboDescriptors.length > 0;

    if (!hasAnyGroups) {
      break;
    }

    removeCardsForComboDescriptors(comboDescriptors);
    createSpecialCardsFromDescriptors(comboDescriptors);
    redrawTower();
  }
}

function createGameOverUI() {
  if (gameOverBanner) {
    return;
  }

  gameOverBanner = document.createElement("div");
  gameOverBanner.className = "game-over-banner";
  gameOverBanner.textContent = "Game Over! Tower toppled!";
  towerZone.appendChild(gameOverBanner);
}

function triggerGameOver() {
  if (isGameOver || isDeckComplete) {
    return;
  }

  isGameOver = true;
  towerZone.classList.add("game-over");
  createGameOverUI();

  gameOverCard = document.createElement("div");
  gameOverCard.className = "stacked-card game-over-card";
  gameOverCard.textContent = "💥";
  tower.appendChild(gameOverCard);
}

function triggerDeckComplete() {
  if (isGameOver || isDeckComplete) {
    return;
  }

  isDeckComplete = true;
  towerZone.classList.add("game-complete");

  completeBanner = document.createElement("div");
  completeBanner.className = "game-complete-banner";
  completeBanner.textContent = "Deck clear! Save your score or start a new tower.";
  towerZone.appendChild(completeBanner);
}

function exceedsBounds(col, row) {
  return col < 0 || col >= getColumns() || row < 0 || row >= getRowsCapacity();
}

function isValidTowerPlacement(col, row) {
  const bottomRow = getRowsCapacity() - 1;

  if (row === bottomRow) {
    return true;
  }

  const supportCard = getCardAt(col, row + 1);
  if (!supportCard) {
    return false;
  }

  if (currentMode === GAME_MODE.POKEDEX && nextCard?.kind === "pokemon") {
    return supportCard.pokemonType1 === nextCard.pokemonType1;
  }

  return true;
}

function placeDrawnCard(clientX, clientY) {
  if (!nextCard || isGameOver || isDeckComplete) {
    return;
  }

  const { col: targetCol, row: targetRow } = getGridCoordsFromPointer(clientX, clientY);

  if (exceedsBounds(targetCol, targetRow)) {
    triggerGameOver();
    redrawTower();
    return;
  }

  if (getCardAt(targetCol, targetRow)) {
    triggerGameOver();
    redrawTower();
    return;
  }

  if (!isValidTowerPlacement(targetCol, targetRow)) {
    triggerGameOver();
    redrawTower();
    return;
  }

  setCardAt(targetCol, targetRow, nextCard);
  score += CARD_BASE_POINTS;
  redrawTower();

  resolveAllCombos();
  redrawTower();

  createNextCard();
  if (currentMode === GAME_MODE.CLASSIC && !nextCard) {
    triggerDeckComplete();
  }
}

function startDrag(clientX, clientY) {
  if (isDragging || isGameOver || isDeckComplete || !nextCard) {
    return;
  }

  isDragging = true;

  const rect = dragCard.getBoundingClientRect();
  pointerOffsetX = clientX - rect.left;
  pointerOffsetY = clientY - rect.top;

  activeDragClone = dragCard.cloneNode(true);
  activeDragClone.id = "";
  activeDragClone.classList.add("dragging");
  document.body.appendChild(activeDragClone);

  moveDrag(clientX, clientY);
}

function moveDrag(clientX, clientY) {
  if (!isDragging || !activeDragClone) {
    return;
  }

  activeDragClone.style.left = `${clientX - pointerOffsetX + CARD_WIDTH / 2}px`;
  activeDragClone.style.top = `${clientY - pointerOffsetY + CARD_HEIGHT / 2}px`;
  towerZone.classList.toggle("ready", isInsideTowerZone(clientX, clientY));
}

function cleanupDrag() {
  if (activeDragClone) {
    activeDragClone.remove();
  }
  activeDragClone = null;
  isDragging = false;
  towerZone.classList.remove("ready");
}

function endDrag(clientX, clientY) {
  if (!isDragging) {
    return;
  }

  if (isInsideTowerZone(clientX, clientY)) {
    placeDrawnCard(clientX, clientY);
  }

  cleanupDrag();
}

function cancelPendingTapPlacement() {
  pendingTapPlacement = null;
}

function shouldStartDragFromEvent(event) {
  if (event.pointerType === "mouse") {
    return event.button === 0;
  }
  return true;
}

async function loadPokedexPool(limit = INITIAL_POKEDEX_POOL_SIZE, { force = false } = {}) {
  const requestedLimit = Math.max(1, Math.min(FULL_POKEDEX_POOL_SIZE, Number(limit) || INITIAL_POKEDEX_POOL_SIZE));
  if (!force && pokedexPool.length >= requestedLimit) {
    return pokedexPool;
  }

  const now = Date.now();
  if (!force) {
    try {
      const rawCache = localStorage.getItem(POKEDEX_CACHE_KEY);
      if (rawCache) {
        const parsed = JSON.parse(rawCache);
        const cachedCards = Array.isArray(parsed.cards) ? parsed.cards : [];
        const cachedAt = Number(parsed.cachedAt || 0);
        const isFresh = now - cachedAt <= POKEDEX_CACHE_TTL_MS;
        if (isFresh && cachedCards.length >= requestedLimit) {
          pokedexPool = cachedCards;
          return pokedexPool;
        }
      }
    } catch {
      // Ignore cache read errors and fetch from the API.
    }
  }

  if (isLoadingPokedex) {
    return pokedexPool;
  }

  isLoadingPokedex = true;
  try {
    const response = await fetch(`/api/pokedex/deck?limit=${requestedLimit}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload) || !payload.length) {
      throw new Error("No pokedex data returned");
    }
    pokedexPool = payload;
    pokemonNameByDex.clear();
    pokedexPool.forEach((pokemon) => {
      pokemonNameByDex.set(Number(pokemon.dexNumber), String(pokemon.name));
    });
    evolutionByDex.clear();
    EVOLUTION_CHAINS.forEach((chain) => {
      const finalDex = chain[chain.length - 1];
      const finalName = pokemonNameByDex.get(finalDex) || `#${String(finalDex).padStart(3, "0")}`;
      chain.forEach((dexNumber, index) => {
        evolutionByDex.set(Number(dexNumber), {
          chainId: chain.join("-"),
          stage: index + 1,
          finalDex,
          finalName
        });
      });
    });
    try {
      localStorage.setItem(
        POKEDEX_CACHE_KEY,
        JSON.stringify({
          cachedAt: now,
          cards: payload
        })
      );
    } catch {
      // Ignore quota/storage errors.
    }
  } finally {
    isLoadingPokedex = false;
  }

  return pokedexPool;
}

function warmFullPokedexPool() {
  if (pokedexWarmPromise || pokedexPool.length >= FULL_POKEDEX_POOL_SIZE) {
    return;
  }

  pokedexWarmPromise = loadPokedexPool(FULL_POKEDEX_POOL_SIZE)
    .catch(() => {
      // Keep gameplay running even if warm-up fails.
    })
    .finally(() => {
      pokedexWarmPromise = null;
    });
}

async function resetGame() {
  board.clear();
  score = 0;
  isGameOver = false;
  isDeckComplete = false;
  updateModeUI();
  if (currentMode === GAME_MODE.POKEDEX) {
    try {
      await loadPokedexPool(INITIAL_POKEDEX_POOL_SIZE);
      drawPile = [];
      warmFullPokedexPool();
    } catch {
      alert("Could not load Pokedex deck. Switching to classic deck.");
      currentMode = GAME_MODE.CLASSIC;
      updateModeUI();
      drawPile = createShuffledDeck();
    }
  } else {
    drawPile = createShuffledDeck();
  }
  towerZone.classList.remove("game-over");
  towerZone.classList.remove("game-complete");
  if (gameOverBanner) {
    gameOverBanner.remove();
    gameOverBanner = null;
  }
  if (gameOverCard) {
    gameOverCard.remove();
    gameOverCard = null;
  }
  if (completeBanner) {
    completeBanner.remove();
    completeBanner = null;
  }
  createNextCard();
  redrawTower();
}

dragCard.addEventListener("pointerdown", (event) => {
  if (!shouldStartDragFromEvent(event)) {
    return;
  }
  event.preventDefault();
  try {
    dragCard.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture can fail on some touch devices.
  }
  startDrag(event.clientX, event.clientY);
});

dragCard.addEventListener("pointermove", (event) => {
  if (!isDragging) {
    return;
  }

  event.preventDefault();
  moveDrag(event.clientX, event.clientY);
});

dragCard.addEventListener("pointerup", (event) => {
  event.preventDefault();
  endDrag(event.clientX, event.clientY);
});

dragCard.addEventListener("pointercancel", (event) => {
  event.preventDefault();
  cleanupDrag();
});

towerZone.addEventListener("pointerdown", (event) => {
  if (isDragging || !nextCard || isGameOver || isDeckComplete) {
    cancelPendingTapPlacement();
    return;
  }
  pendingTapPlacement = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY
  };
});

towerZone.addEventListener("pointermove", (event) => {
  if (!pendingTapPlacement || pendingTapPlacement.pointerId !== event.pointerId) {
    return;
  }
  const movedX = Math.abs(event.clientX - pendingTapPlacement.startX);
  const movedY = Math.abs(event.clientY - pendingTapPlacement.startY);
  if (movedX > TAP_MOVE_THRESHOLD_PX || movedY > TAP_MOVE_THRESHOLD_PX) {
    cancelPendingTapPlacement();
  }
});

towerZone.addEventListener("pointerup", (event) => {
  if (!pendingTapPlacement || pendingTapPlacement.pointerId !== event.pointerId) {
    return;
  }
  cancelPendingTapPlacement();
  if (!isDragging && isInsideTowerZone(event.clientX, event.clientY)) {
    event.preventDefault();
    placeDrawnCard(event.clientX, event.clientY);
  }
});

towerZone.addEventListener("pointercancel", () => {
  cancelPendingTapPlacement();
});

window.addEventListener("pointermove", (event) => {
  if (!isDragging) {
    return;
  }
  event.preventDefault();
  moveDrag(event.clientX, event.clientY);
});

window.addEventListener("pointerup", (event) => {
  if (!isDragging) {
    return;
  }
  event.preventDefault();
  endDrag(event.clientX, event.clientY);
});

window.addEventListener("pointercancel", () => {
  if (!isDragging) {
    return;
  }
  cleanupDrag();
});

resetButton.addEventListener("click", () => {
  resetGame();
});

if (toggleModeButton) {
  toggleModeButton.addEventListener("click", () => {
    currentMode = currentMode === GAME_MODE.CLASSIC ? GAME_MODE.POKEDEX : GAME_MODE.CLASSIC;
    resetGame();
  });
}

saveButton.addEventListener("click", async () => {
  if (!board.size) {
    alert("Place at least one card first!");
    return;
  }

  const name = normalizePlayerName(playerNameInput ? playerNameInput.value : "");
  if (!name) {
    alert("Please enter your name before saving.");
    if (playerNameInput) {
      playerNameInput.focus();
    }
    return;
  }

  cachePlayerName(name);

  const scoreData = {
    name,
    score,
    cards: board.size,
    rows: getRowsUsed()
  };

  try {
    const response = await fetch("/api/highscores", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(scoreData)
    });

    const highscores = await response.json();
    renderHighscores(highscores);
  } catch {
    alert("Could not save the score.");
  }
});

async function loadHighscores() {
  try {
    const response = await fetch("/api/highscores");
    const highscores = await response.json();
    renderHighscores(highscores);
  } catch {
    highscoresEl.innerHTML = "<li>No scores yet</li>";
  }
}

function renderHighscores(highscores) {
  highscoresEl.innerHTML = "";

  if (!highscores.length) {
    highscoresEl.innerHTML = "<li>No scores yet</li>";
    return;
  }

  highscores.slice(0, 3).forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.name}: ${entry.score} points (${entry.cards} cards, ${entry.rows} rows)`;
    highscoresEl.appendChild(li);
  });
}

if (playerNameInput) {
  const savedName = getSavedPlayerName();
  if (savedName) {
    playerNameInput.value = savedName;
  }

  playerNameInput.addEventListener("input", () => {
    const normalized = normalizePlayerName(playerNameInput.value);
    if (playerNameInput.value !== normalized) {
      playerNameInput.value = normalized;
    }
    if (normalized) {
      cachePlayerName(normalized);
    }
  });
}

updateModeUI();
resetGame();
loadHighscores();
