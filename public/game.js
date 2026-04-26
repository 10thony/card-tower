const dragCard = document.getElementById("dragCard");
const towerZone = document.getElementById("towerZone");
const tower = document.getElementById("tower");
const cardCountEl = document.getElementById("cardCount");
const rowCountEl = document.getElementById("rowCount");
const scoreEl = document.getElementById("score");
const ruleTextEl = document.getElementById("ruleText");
const nextCardInfoEl = document.getElementById("nextCardInfo");
const deckCountInfoEl = document.getElementById("deckCountInfo");
const resetButton = document.getElementById("resetButton");
const saveButton = document.getElementById("saveButton");
const highscoresEl = document.getElementById("highscores");

const CARD_WIDTH = 86;
const CARD_HEIGHT = 124;
const CELL_GAP_X = 8;
const CELL_GAP_Y = 10;
const CARD_BASE_POINTS = 5;
const DECK_SIZE = 24;
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

function createNextCard() {
  nextCard = drawPile.pop() || null;
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
  return card.suit;
}

function updateDeckCard() {
  if (!nextCard) {
    dragCard.classList.remove("red", "black");
    dragCard.classList.add("deck-empty");
    dragCard.textContent = "✓";
    dragCard.setAttribute("aria-label", "Deck complete");
    dragCard.title = "Deck exhausted. Start a new tower to play another run.";
    if (nextCardInfoEl) {
      nextCardInfoEl.textContent = "Deck exhausted";
    }
    if (deckCountInfoEl) {
      deckCountInfoEl.textContent = "0 cards left";
    }
    return;
  }

  dragCard.classList.remove("deck-empty");
  dragCard.classList.remove("red", "black");
  dragCard.classList.add(nextCard.color);
  dragCard.textContent = nextCard.suit;
  dragCard.setAttribute("aria-label", `Next card ${nextCard.suitName}`);
  dragCard.title = `Match by suit (active): ${nextCard.suitName}. Color (${nextCard.color}) is displayed but not used for matching.`;
  if (nextCardInfoEl) {
    const colorLabel = nextCard.color === "red" ? "Red" : "Black";
    nextCardInfoEl.textContent = `Next: ${nextCard.suitName[0].toUpperCase()}${nextCard.suitName.slice(1)} (${colorLabel})`;
  }
  if (deckCountInfoEl) {
    const remaining = drawPile.length;
    deckCountInfoEl.textContent = `${remaining} ${remaining === 1 ? "card" : "cards"} left`;
  }
}

function createBoardCardEl(card) {
  const cardEl = document.createElement("div");
  cardEl.className = "stacked-card";
  cardEl.classList.add(card.color);
  cardEl.classList.add(`card-type-${card.type}`);

  if (card.type === "normal") {
    cardEl.textContent = formatCardFace(card);
  } else {
    const badge = card.type === "suite" ? "SUITE!" : "SUPER!";
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
    const suit = descriptor.cards[0].suit;
    const suitName = descriptor.cards[0].suitName;
    const color = descriptor.cards[0].color;
    const stackedValue = descriptor.cards.reduce((sum, card) => sum + Number(card.value || CARD_BASE_POINTS), 0);
    const value = stackedValue + Number(descriptor.bonus || 0);
    const targetCol = descriptor.cards.reduce((sum, card) => sum + card.col, 0) / descriptor.cards.length;
    const nearestCol = Math.max(0, Math.min(getColumns() - 1, Math.round(targetCol)));
    const targetRow = findBottomMostOpenInColumn(nearestCol);

    if (targetRow === null) {
      triggerGameOver();
      return;
    }

    setCardAt(nearestCol, targetRow, {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-special`,
      type: descriptor.type,
      suit,
      suitName,
      color,
      value
    });

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
    const comboDescriptors = mergeComboDescriptors([...superGroups, ...suiteGroups]);
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
  return Boolean(supportCard);
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
  if (!nextCard) {
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

function resetGame() {
  board.clear();
  score = 0;
  isGameOver = false;
  isDeckComplete = false;
  drawPile = createShuffledDeck();
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
  if (ruleTextEl) {
    ruleTextEl.textContent = "Suit Match";
  }
  redrawTower();
}

dragCard.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  dragCard.setPointerCapture(event.pointerId);
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

resetButton.addEventListener("click", resetGame);

saveButton.addEventListener("click", async () => {
  if (!board.size) {
    alert("Place at least one card first!");
    return;
  }

  const name = prompt("Name for the high score?", "Kiddo");
  if (name === null) {
    return;
  }

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

resetGame();
loadHighscores();
