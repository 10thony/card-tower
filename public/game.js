const dragCard = document.getElementById("dragCard");
const towerZone = document.getElementById("towerZone");
const tower = document.getElementById("tower");
const cardCountEl = document.getElementById("cardCount");
const rowCountEl = document.getElementById("rowCount");
const scoreEl = document.getElementById("score");
const resetButton = document.getElementById("resetButton");
const saveButton = document.getElementById("saveButton");
const highscoresEl = document.getElementById("highscores");

const CARD_WIDTH = 86;
const CARD_HEIGHT = 124;
const ROW_HEIGHT = 76;
const CARDS_PER_ROW = 5;

let cards = [];
let pointerOffsetX = 0;
let pointerOffsetY = 0;
let activeDragClone = null;
let isDragging = false;

function getRows() {
  return Math.ceil(cards.length / CARDS_PER_ROW);
}

function getScore() {
  return 5 * cards.length * getRows();
}

function updateStats() {
  cardCountEl.textContent = cards.length;
  rowCountEl.textContent = getRows();
  scoreEl.textContent = getScore();
}

function createCardSymbol(index) {
  const suits = ["♥", "♦", "♣", "♠"];
  return suits[index % suits.length];
}

function placeStackedCard(index) {
  const row = Math.floor(index / CARDS_PER_ROW);
  const positionInRow = index % CARDS_PER_ROW;
  const rowCount = Math.min(CARDS_PER_ROW, cards.length - row * CARDS_PER_ROW);

  const totalRowWidth = rowCount * CARD_WIDTH + (rowCount - 1) * 10;
  const startX = totalRowWidth / -2;

  const card = document.createElement("div");
  card.className = "stacked-card";
  card.textContent = createCardSymbol(index);

  const x = startX + positionInRow * (CARD_WIDTH + 10);
  const y = row * ROW_HEIGHT;

  const tilt = positionInRow % 2 === 0 ? -3 : 3;

  card.style.left = `calc(50% + ${x}px)`;
  card.style.bottom = `${y}px`;
  card.style.transform = `rotate(${tilt}deg)`;

  tower.appendChild(card);
}

function redrawTower() {
  tower.innerHTML = "";

  cards.forEach((_, index) => {
    placeStackedCard(index);
  });

  updateStats();
}

function addCardToTower() {
  cards.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    createdAt: Date.now()
  });

  redrawTower();
}

function isInsideTowerZone(clientX, clientY) {
  const rect = towerZone.getBoundingClientRect();

  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function startDrag(clientX, clientY) {
  if (isDragging) {
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

  if (isInsideTowerZone(clientX, clientY)) {
    towerZone.classList.add("ready");
  } else {
    towerZone.classList.remove("ready");
  }
}

function endDrag(clientX, clientY) {
  if (!isDragging) {
    return;
  }

  if (isInsideTowerZone(clientX, clientY)) {
    addCardToTower();
  }

  if (activeDragClone) {
    activeDragClone.remove();
  }

  activeDragClone = null;
  isDragging = false;
  towerZone.classList.remove("ready");
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

  if (activeDragClone) {
    activeDragClone.remove();
  }

  activeDragClone = null;
  isDragging = false;
  towerZone.classList.remove("ready");
});

resetButton.addEventListener("click", () => {
  cards = [];
  redrawTower();
});

saveButton.addEventListener("click", async () => {
  if (cards.length === 0) {
    alert("Stack at least one card first!");
    return;
  }

  const name = prompt("Name for the high score?", "Kiddo");

  if (name === null) {
    return;
  }

  const scoreData = {
    name,
    score: getScore(),
    cards: cards.length,
    rows: getRows()
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

  highscores.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.name}: ${entry.score} points (${entry.cards} cards, ${entry.rows} rows)`;
    highscoresEl.appendChild(li);
  });
}

redrawTower();
loadHighscores();
