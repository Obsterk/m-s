/* ---------- Config ---------- */
const WIN_SCORE = 8;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(pointer: fine)').matches;
const STATUS_IDLE = `First to ${WIN_SCORE} wins the prize`;
const FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2672"/><stop offset="1" stop-color="#8a2f6e"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/></svg>'
);

/* Background music volume levels (0 to 1).
   "game" is the quiet level used while the hockey game is running, so the sound effects sit on top of the song. */
const MUSIC_LEVELS = { normal: 0.5, game: 0.16, swell: 0.75 };

/* ---------- Elements (looked up by id; every use below is null-safe) ---------- */
const $ = (id) => document.getElementById(id);

const homeScreen = $('screen-home');
const gameScreen = $('screen-game');
const trophyScreen = $('screen-trophy');
const rewardScreen = $('screen-reward');
const allScreens = [homeScreen, gameScreen, trophyScreen, rewardScreen].filter(Boolean);

const startBtn = $('start-btn');
const trophyImg = $('trophy-img');
const unlockBtn = $('unlock-btn');
const confettiLayer = $('confetti-layer');
const gameStatusText = $('game-status-text');
const gameResultPanel = $('game-result-panel');
const retryBtn = $('retry-btn');
const pauseBtn = $('pause-btn');
const countdownEl = $('game-countdown');
const soundToggle = $('sound-toggle');
const bgMusic = $('bg-music');
const canvas = $('gameCanvas');
const scoreLeftEl = $('score-left');
const scoreRightEl = $('score-right');

/* ---------- State ---------- */
const noMessages = [
  'Are you sure?',
  'Try again',
  'That button seems broken',
  'Still no?',
  'I think the heart heard you'
];

const keyState = { up: false, down: false };
let inputAttached = false;
let soundOn = true;          // master switch for music and effects (music starts after her first tap)
let musicAvailable = true;   // becomes false if the song file can't be loaded
let musicLevel = 'normal';
let musicFadeTimer = null;
let resumeMusicOnVisible = false;
let levelResetTimer = null;
let audioContext = null;
let sfxBus = null;
let noAttempts = 0;
let currentGame = null;
let animationFrameId = null;
let countdownTimer = null;
let trophyBusy = false;

const boardImage = new Image();
boardImage.src = 'images/sp1.jpg';

/* Run each setup step on its own so one failure can never break the others */
function safely(fn) {
  try {
    fn();
  } catch (error) {
    console.error(`${fn.name} failed:`, error);
  }
}

/* ---------- Image fallback (a broken path shows a soft gradient instead of a broken icon) ---------- */
document.addEventListener('error', (event) => {
  const el = event.target;
  if (el && el.tagName === 'IMG' && el.src !== FALLBACK_IMG) {
    el.src = FALLBACK_IMG;
  }
}, true);

/* ---------- Screens ---------- */
function showScreen(targetScreen) {
  allScreens.forEach((screen) => {
    const isTarget = screen === targetScreen;
    screen.classList.toggle('active', isTarget);
    screen.classList.toggle('is-hidden', !isTarget);
    screen.setAttribute('aria-hidden', String(!isTarget));
  });
}

function scrollToScreen(screen) {
  if (!screen) return;
  requestAnimationFrame(() => {
    screen.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
  });
}

/* ---------- Home: soft drifting petals ---------- */
function setupHomeOrnaments() {
  const container = document.querySelector('.home-ornaments');
  if (!container || REDUCED_MOTION) return;

  for (let i = 0; i < 16; i += 1) {
    const petal = document.createElement('span');
    petal.className = 'spark';
    petal.style.setProperty('--left', `${Math.random() * 98}%`);
    petal.style.setProperty('--top', `${Math.random() * 85 + 8}%`);
    petal.style.setProperty('--size', `${Math.random() * 14 + 10}px`);
    petal.style.setProperty('--delay', `${Math.random() * 9}s`);
    petal.style.setProperty('--turn', `${Math.round(Math.random() * 120 - 60)}deg`);
    container.appendChild(petal);
  }
}

/* ---------- Scroll reveal ---------- */
function setupRevealObserver() {
  const nodes = document.querySelectorAll('.reveal');

  if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
    nodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const cards = Array.from(document.querySelectorAll('.gallery-card'));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const node = entry.target;
      const cardIndex = cards.indexOf(node);
      if (cardIndex > -1) {
        node.style.transitionDelay = `${(cardIndex % 4) * 120}ms`;
        setTimeout(() => { node.style.transitionDelay = ''; }, 1100);
      }
      node.classList.add('is-visible');
      observer.unobserve(node);
    });
  }, { threshold: 0.12 });

  nodes.forEach((node) => observer.observe(node));
}

/* ---------- "Things I love about you" flip cards ---------- */
function setupLoveCards() {
  document.querySelectorAll('.love-card').forEach((card) => {
    card.addEventListener('click', () => {
      const flipped = card.classList.toggle('is-flipped');
      card.setAttribute('aria-pressed', String(flipped));
      if (flipped) playTone({ frequency: 740, duration: 0.18, gain: 0.03, type: 'sine' });
    });
  });
}

/* ---------- Gallery lightbox ---------- */
function setupGalleryLightbox() {
  const galleryItems = Array.from(document.querySelectorAll('.gallery-card img'));
  const lightbox = $('gallery-lightbox');
  const image = $('lightbox-image');
  const closeButton = $('lightbox-close');
  const prevButton = $('lightbox-prev');
  const nextButton = $('lightbox-next');

  if (!lightbox || !image || !closeButton || !prevButton || !nextButton || !galleryItems.length) return;

  let currentIndex = 0;
  let lastFocusedElement = null;

  function openLightbox(index) {
    currentIndex = (index + galleryItems.length) % galleryItems.length;
    const item = galleryItems[currentIndex];
    if (lightbox.classList.contains('is-hidden')) {
      lastFocusedElement = document.activeElement;
    }
    image.src = item.dataset.full || item.src;
    image.alt = item.alt;
    lightbox.classList.remove('is-hidden');
    lightbox.setAttribute('aria-hidden', 'false');
    closeButton.focus();
  }

  function closeLightbox() {
    lightbox.classList.add('is-hidden');
    lightbox.setAttribute('aria-hidden', 'true');
    if (lastFocusedElement && lastFocusedElement.focus) lastFocusedElement.focus();
  }

  galleryItems.forEach((item, index) => {
    const card = item.parentElement;
    if (!card) return;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open photo ${index + 1}`);
    card.addEventListener('click', () => openLightbox(index));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(index);
      }
    });
  });

  closeButton.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  prevButton.addEventListener('click', () => openLightbox(currentIndex - 1));
  nextButton.addEventListener('click', () => openLightbox(currentIndex + 1));

  document.addEventListener('keydown', (event) => {
    if (lightbox.classList.contains('is-hidden')) return;

    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowRight') openLightbox(currentIndex + 1);
    if (event.key === 'ArrowLeft') openLightbox(currentIndex - 1);

    // Focus trap
    if (event.key === 'Tab') {
      const focusable = [closeButton, prevButton, nextButton];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!focusable.includes(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

/* ======================================================================
   Audio: background song + game sound effects
   - The song starts on her first tap or key press (browsers block autoplay before that).
   - While the game runs the song fades down so the effects sit on top of it,
     then swells back up on the win and on "Yes".
   - Effects are soft sine/triangle tones through a low-pass filter so they don't clash with the song.
   - The speaker button switches everything on or off.
   ====================================================================== */
function ensureAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;

  if (!audioContext) {
    audioContext = new AudioCtor();
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    sfxBus = audioContext.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(filter);
    filter.connect(audioContext.destination);
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function fadeMusicTo(target, ms = 1200, onDone) {
  if (!bgMusic) return;
  clearInterval(musicFadeTimer);

  const from = bgMusic.volume;
  const steps = Math.max(1, Math.round(ms / 40));
  let step = 0;

  musicFadeTimer = setInterval(() => {
    step += 1;
    const value = from + (target - from) * (step / steps);
    bgMusic.volume = Math.min(1, Math.max(0, value));
    if (step >= steps) {
      clearInterval(musicFadeTimer);
      if (onDone) onDone();
    }
  }, 40);
}

function setMusicLevel(level, ms = 1200) {
  musicLevel = level;
  if (!soundOn || !bgMusic || bgMusic.paused) return;
  fadeMusicTo(MUSIC_LEVELS[level], ms);
}

function startMusic() {
  if (!bgMusic || !musicAvailable || !soundOn || !bgMusic.paused) return;

  bgMusic.volume = 0;
  const attempt = bgMusic.play();
  if (attempt && attempt.then) {
    attempt
      .then(() => fadeMusicTo(MUSIC_LEVELS[musicLevel], 2200))
      .catch(() => { /* blocked until the next tap; the next gesture tries again */ });
  }
}

function stopMusic() {
  if (!bgMusic) return;
  fadeMusicTo(0, 350, () => {
    if (!soundOn) bgMusic.pause();
  });
}

function updateSoundToggle() {
  if (!soundToggle) return;
  soundToggle.setAttribute('aria-pressed', String(soundOn));
  soundToggle.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
}

function unlockAudio(event) {
  const target = event && event.target instanceof Element ? event.target : null;
  if (target && target.closest('#sound-toggle')) return;
  ensureAudioContext();
  startMusic();
}

function setupSound() {
  if (bgMusic) {
    bgMusic.volume = 0;
    bgMusic.addEventListener('error', () => {
      musicAvailable = false;
      console.warn('Background song not found. Put your file at audio/song.mp3 or update the src in index.html.');
    });
  }

  if (soundToggle) {
    updateSoundToggle();
    soundToggle.addEventListener('click', () => {
      soundOn = !soundOn;
      updateSoundToggle();
      if (soundOn) {
        ensureAudioContext();
        startMusic();
      } else {
        stopMusic();
      }
    });
  }

  document.addEventListener('pointerdown', unlockAudio, { capture: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });

  // Don't keep playing when the tab is in the background
  document.addEventListener('visibilitychange', () => {
    if (!bgMusic) return;
    if (document.visibilityState === 'hidden') {
      if (!bgMusic.paused) {
        resumeMusicOnVisible = true;
        bgMusic.pause();
      }
    } else if (resumeMusicOnVisible && soundOn) {
      resumeMusicOnVisible = false;
      bgMusic.play().catch(() => {});
    }
  });
}

function playTone({ frequency, duration, gain = 0.04, type = 'sine', delay = 0 } = {}) {
  if (!soundOn || !audioContext || !sfxBus) return;

  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(gain, start + 0.025);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gainNode);
  gainNode.connect(sfxBus);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

function playGoalSound() {
  playTone({ frequency: 330, duration: 0.16, gain: 0.05, type: 'triangle' });
  playTone({ frequency: 495, duration: 0.2, gain: 0.04, type: 'sine', delay: 0.07 });
}

function playWinSound() {
  [392, 494, 587, 784].forEach((frequency, i) => {
    playTone({ frequency, duration: 0.5, gain: 0.045, type: 'sine', delay: i * 0.12 });
  });
}

function playYesSound() {
  [440, 554, 659, 880].forEach((frequency, i) => {
    playTone({ frequency, duration: 0.55, gain: 0.045, type: 'sine', delay: i * 0.11 });
  });
}

/* Swell the song up for a moment, then settle back to its normal level */
function swellMusic(holdMs = 4500) {
  clearTimeout(levelResetTimer);
  setMusicLevel('swell', 700);
  levelResetTimer = setTimeout(() => {
    if (musicLevel === 'swell') setMusicLevel('normal', 2500);
  }, holdMs);
}

/* ---------- Confetti (fixed layer, falls from the top of the viewport) ---------- */
function launchConfetti({ count = 140, duration = 4000 } = {}) {
  if (!confettiLayer || REDUCED_MOTION) return;

  const colors = ['#ff4d6d', '#ffd93d', '#3ddc97', '#39c1ff', '#ff7fe9', '#8b7cff'];
  const fall = `${window.innerHeight + 60}px`;

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--left', `${Math.random() * 100}%`);
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
    piece.style.setProperty('--fall', fall);
    piece.style.setProperty('--rot', `${(Math.random() - 0.5) * 1000}deg`);
    piece.style.animationDuration = `${duration * (0.7 + Math.random() * 0.3)}ms`;
    piece.style.animationDelay = `${Math.random() * 600}ms`;
    piece.addEventListener('animationend', () => piece.remove());
    confettiLayer.appendChild(piece);
  }
}

/* ---------- Game input (attached once) ---------- */
function setPointerY(event) {
  const game = currentGame;
  if (!game || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  game.mouseY = (event.clientY - rect.top) * (game.height / rect.height);
}

function isGameActive() {
  return !!currentGame && currentGame.running && !currentGame.paused && !currentGame.over;
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  const isUp = key === 'arrowup' || key === 'w';
  const isDown = key === 'arrowdown' || key === 's';
  if (!isUp && !isDown) return;

  if (isGameActive()) event.preventDefault();
  if (isUp) keyState.up = true;
  if (isDown) keyState.down = true;
}

function handleKeyUp(event) {
  const key = event.key.toLowerCase();
  if (key === 'arrowup' || key === 'w') keyState.up = false;
  if (key === 'arrowdown' || key === 's') keyState.down = false;
}

function attachCanvasInput() {
  if (inputAttached || !canvas) return;
  inputAttached = true;

  // Pointer events cover mouse, touch and pen. touch-action: none on the canvas stops page scrolling while playing.
  canvas.addEventListener('pointermove', setPointerY);
  canvas.addEventListener('pointerdown', setPointerY);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', () => { keyState.up = false; keyState.down = false; });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') setPaused(true);
  });
}

/* ---------- Game logic ---------- */
function flashBoard() {
  const shell = document.querySelector('.game-shell');
  if (!shell) return;
  shell.classList.remove('hit-flash');
  void shell.offsetWidth;
  shell.classList.add('hit-flash');
  setTimeout(() => shell.classList.remove('hit-flash'), 200);
}

function popScore(side) {
  const el = side === 'left' ? scoreLeftEl : scoreRightEl;
  const target = el && el.parentElement;
  if (!target) return;
  target.classList.remove('score-pop');
  void target.offsetWidth;
  target.classList.add('score-pop');
  setTimeout(() => target.classList.remove('score-pop'), 450);
}

function speedForBounce(game) {
  return Math.min(7.6, 4.2 + (game.scores.left + game.scores.right) * 0.045);
}

function resetBall(game, direction) {
  game.ball.x = game.width / 2;
  game.ball.y = game.height / 2;
  game.ball.vx = direction * speedForBounce(game);
  game.ball.vy = (Math.random() * 4.2) - 2.1;
}

function updatePaddles(game) {
  const left = game.leftPaddle;
  const right = game.rightPaddle;

  if (keyState.up || keyState.down) {
    if (keyState.up) left.y -= left.speed;
    if (keyState.down) left.y += left.speed;
  } else {
    const diff = (game.mouseY - left.height / 2) - left.y;
    left.y += Math.sign(diff) * Math.min(Math.abs(diff), left.speed);
  }
  left.y = Math.max(0, Math.min(game.height - left.height, left.y));

  // Assist: after the CPU scores 3 in a row it reacts more slowly so the game stays winnable.
  const follow = game.cpuStreak >= 3 ? 0.014 : 0.025;
  right.y += ((game.ball.y - (right.y + right.height / 2)) * follow);
  right.y = Math.max(0, Math.min(game.height - right.height, right.y));
}

function handlePaddleCollision(game, paddle) {
  const ball = game.ball;
  const withinX = ball.x + ball.radius > paddle.x && ball.x - ball.radius < paddle.x + paddle.width;
  const withinY = ball.y + ball.radius > paddle.y && ball.y - ball.radius < paddle.y + paddle.height;
  if (!withinX || !withinY) return;

  flashBoard();

  if (paddle === game.leftPaddle) {
    ball.x = paddle.x + paddle.width + ball.radius;
    ball.vx = Math.min(11, Math.abs(ball.vx) + 0.28);
  } else {
    ball.x = paddle.x - ball.radius;
    ball.vx = -Math.min(11, Math.abs(ball.vx) + 0.28);
  }

  const hitFactor = (ball.y - (paddle.y + paddle.height / 2)) / (paddle.height / 2);
  ball.vy = hitFactor * 6.4;
}

function updateBall(game) {
  if (game.scoreCooldown > 0) {
    game.scoreCooldown -= 1;
    return;
  }

  const ball = game.ball;
  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.y - ball.radius <= 0 || ball.y + ball.radius >= game.height) {
    ball.vy *= -1;
    ball.y = Math.max(ball.radius, Math.min(game.height - ball.radius, ball.y));
  }

  handlePaddleCollision(game, game.leftPaddle);
  handlePaddleCollision(game, game.rightPaddle);

  if (ball.x < 0) {
    game.scores.right += 1;
    game.cpuStreak += 1;
    if (scoreRightEl) scoreRightEl.textContent = game.scores.right;
    popScore('right');
    flashBoard();
    playGoalSound();
    game.scoreCooldown = 32;
    resetBall(game, 1);
  } else if (ball.x > game.width) {
    game.scores.left += 1;
    game.cpuStreak = 0;
    if (scoreLeftEl) scoreLeftEl.textContent = game.scores.left;
    popScore('left');
    flashBoard();
    playGoalSound();
    game.scoreCooldown = 32;
    resetBall(game, -1);
  }

  const leftWon = game.scores.left >= WIN_SCORE;
  const rightWon = game.scores.right >= WIN_SCORE;
  if (leftWon || rightWon) {
    game.over = true;
    game.running = false;
    endMiniGame({ won: leftWon, scoreText: `${game.scores.left} - ${game.scores.right}` });
  }
}

function drawField(game) {
  const ctx = game.ctx;
  ctx.clearRect(0, 0, game.width, game.height);

  if (boardImage.complete && boardImage.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.drawImage(boardImage, 0, 0, game.width, game.height);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(18, 24, 70, 0.82)';
    ctx.fillRect(0, 0, game.width, game.height);
  }

  ctx.fillStyle = 'rgba(5, 10, 28, 0.32)';
  ctx.fillRect(0, 0, game.width, game.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(game.width / 2, 0);
  ctx.lineTo(game.width / 2, game.height);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(game.width / 2, game.height / 2, 70, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffd954';
  ctx.fillRect(game.leftPaddle.x, game.leftPaddle.y, game.leftPaddle.width, game.leftPaddle.height);
  ctx.fillStyle = '#ff89bf';
  ctx.fillRect(game.rightPaddle.x, game.rightPaddle.y, game.rightPaddle.width, game.rightPaddle.height);

  ctx.beginPath();
  ctx.fillStyle = '#7ff7ea';
  ctx.shadowColor = '#7ff7ea';
  ctx.shadowBlur = 15;
  ctx.arc(game.ball.x, game.ball.y, game.ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function scheduleFrame(game) {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(() => gameLoop(game));
}

function gameLoop(game) {
  animationFrameId = null;
  if (game !== currentGame || !game.running || game.paused || game.over) return;

  updatePaddles(game);
  updateBall(game);
  drawField(game);

  if (!game.over) scheduleFrame(game);
}

function runCountdown(game) {
  const steps = ['3', '2', '1', 'Go!'];
  let index = 0;

  function tick() {
    if (game !== currentGame) return;

    if (index >= steps.length) {
      if (countdownEl) countdownEl.classList.remove('visible');
      game.running = true;
      game.paused = false;
      scheduleFrame(game);
      return;
    }

    if (countdownEl) {
      countdownEl.textContent = steps[index];
      countdownEl.classList.add('visible');
    }
    playTone({ frequency: index === steps.length - 1 ? 660 : 440, duration: 0.2, gain: 0.035, type: 'sine' });
    index += 1;
    countdownTimer = window.setTimeout(tick, 700);
  }

  tick();
}

function setPaused(paused) {
  const game = currentGame;
  if (!game || game.over || !game.running || game.paused === paused) return;

  game.paused = paused;
  if (pauseBtn) pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  if (gameStatusText) gameStatusText.textContent = paused ? 'Paused' : STATUS_IDLE;
  setMusicLevel(paused ? 'normal' : 'game', 700);

  if (paused) {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else {
    scheduleFrame(game);
  }
}

function startMiniGame() {
  if (!canvas) return;

  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  attachCanvasInput();
  clearTimeout(levelResetTimer);
  setMusicLevel('game', 1500);

  const logicalWidth = 960;
  const logicalHeight = 480;
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');

  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const game = {
    width: logicalWidth,
    height: logicalHeight,
    ctx,
    leftPaddle: { x: 40, y: logicalHeight / 2 - 62, width: 18, height: 124, speed: 8 },
    rightPaddle: { x: logicalWidth - 58, y: logicalHeight / 2 - 62, width: 18, height: 124 },
    ball: { x: logicalWidth / 2, y: logicalHeight / 2, radius: 12, vx: 3.5, vy: 2.1 },
    scores: { left: 0, right: 0 },
    mouseY: logicalHeight / 2,
    scoreCooldown: 0,
    cpuStreak: 0,
    over: false,
    paused: false,
    running: false
  };

  currentGame = game;
  if (scoreLeftEl) scoreLeftEl.textContent = '0';
  if (scoreRightEl) scoreRightEl.textContent = '0';
  if (gameResultPanel) gameResultPanel.classList.add('is-hidden');
  if (gameStatusText) gameStatusText.textContent = STATUS_IDLE;
  if (pauseBtn) pauseBtn.textContent = 'Pause';
  if (countdownEl) countdownEl.classList.remove('visible');
  resetBall(game, -1);
  drawField(game);
  runCountdown(game);
}

function endMiniGame({ won, scoreText } = {}) {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }

  if (won) {
    if (gameResultPanel) gameResultPanel.classList.add('is-hidden');
    if (gameStatusText) gameStatusText.textContent = `You win ${scoreText}`;
    trophyBusy = false;
    showScreen(trophyScreen);
    playWinSound();
    swellMusic(5000);
    scrollToScreen(trophyScreen);
    return;
  }

  if (gameStatusText) gameStatusText.textContent = `The CPU takes it ${scoreText}`;
  if (gameResultPanel) gameResultPanel.classList.remove('is-hidden');
}

/* ---------- Trophy ---------- */
function revealRewardQuestion() {
  showScreen(rewardScreen);
  scrollToScreen(rewardScreen);
}

function onTrophyReveal() {
  if (trophyBusy) return;
  trophyBusy = true;

  if (trophyImg) {
    trophyImg.classList.remove('reveal-bounce');
    void trophyImg.offsetWidth;
    trophyImg.classList.add('reveal-bounce');
  }
  launchConfetti({ count: 50, duration: 2600 });

  // Let the bounce play before moving on
  setTimeout(revealRewardQuestion, REDUCED_MOTION ? 0 : 750);
}

/* ---------- Reward question (Yes / No) ----------
   These use one delegated click listener on the document, so they keep working
   no matter when the buttons are shown or hidden. */
function getRewardParts() {
  const yes = $('yes-btn');
  const no = $('no-btn');
  return {
    yes,
    no,
    title: $('reward-title'),
    sub: $('reward-sub'),
    row: $('answer-row') || (yes && yes.parentElement),
    message: $('invalid-message'),
    replay: $('replay-btn'),
    celebration: $('celebration')
  };
}

function show(el) { if (el) el.classList.remove('is-hidden'); }
function hide(el) { if (el) el.classList.add('is-hidden'); }

function resetRewardState() {
  const p = getRewardParts();
  noAttempts = 0;
  if (p.title) {
    p.title.textContent = 'Will you be my girlfriend?';
    p.title.classList.remove('is-script');
  }
  hide(p.sub);
  show(p.row);
  hide(p.replay);
  hide(p.message);
  hide(p.celebration);
  if (p.no) {
    p.no.disabled = false;
    p.no.classList.remove('is-fading');
    p.no.style.removeProperty('--no-scale');
    p.no.style.removeProperty('--no-x');
    p.no.style.removeProperty('--no-y');
  }
  if (p.yes) p.yes.style.removeProperty('--yes-scale');
}

function handleYes() {
  const p = getRewardParts();
  if (p.title) {
    p.title.textContent = 'You said yes!';
    p.title.classList.add('is-script');
  }
  if (p.sub) {
    p.sub.textContent = 'Best birthday surprise ever.';
    show(p.sub);
  }
  hide(p.row);
  hide(p.message);
  show(p.replay);
  show(p.celebration);
  launchConfetti({ count: 180, duration: 4000 });
  playYesSound();
  swellMusic(7000);
}

function handleNo() {
  const p = getRewardParts();
  if (!p.no) return;

  noAttempts += 1;
  if (p.message) {
    p.message.textContent = noMessages[(noAttempts - 1) % noMessages.length];
    show(p.message);
  }
  p.no.style.setProperty('--no-scale', String(Math.max(0.6, 1 - noAttempts * 0.08)));
  if (p.yes) p.yes.style.setProperty('--yes-scale', String(Math.min(1.6, 1 + noAttempts * 0.12)));

  if (noAttempts >= 5) {
    p.no.classList.add('is-fading');
    p.no.disabled = true;
    if (p.message) p.message.textContent = 'The answer is still yes.';
    return;
  }

  p.no.classList.remove('shake');
  void p.no.offsetWidth;
  p.no.classList.add('shake');
  setTimeout(() => p.no.classList.remove('shake'), 460);
}

function setupRewardButtons() {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('#yes-btn')) {
      handleYes();
    } else if (target.closest('#no-btn')) {
      handleNo();
    } else if (target.closest('#replay-btn')) {
      launchConfetti({ count: 180, duration: 4000 });
      playYesSound();
    }
  });

  // Playful dodge on desktop only; the offset is small so No always stays inside the panel.
  if (FINE_POINTER && !REDUCED_MOTION) {
    document.addEventListener('pointerover', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const noBtn = target && target.closest('#no-btn');
      if (!noBtn || noBtn.disabled) return;
      noBtn.style.setProperty('--no-x', `${((Math.random() * 2 - 1) * 26).toFixed(0)}px`);
      noBtn.style.setProperty('--no-y', `${((Math.random() * 2 - 1) * 14).toFixed(0)}px`);
    });
  }
}

/* ---------- Wiring ---------- */
function setupGameButtons() {
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      showScreen(gameScreen);
      scrollToScreen(gameScreen);
      startMiniGame();
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (gameResultPanel) gameResultPanel.classList.add('is-hidden');
      startMiniGame();
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (currentGame) setPaused(!currentGame.paused);
    });
  }

  if (trophyImg) trophyImg.addEventListener('click', onTrophyReveal);
  if (unlockBtn) unlockBtn.addEventListener('click', onTrophyReveal);
}

safely(setupHomeOrnaments);
safely(setupRevealObserver);
safely(setupLoveCards);
safely(setupGalleryLightbox);
safely(setupSound);
safely(setupRewardButtons);
safely(setupGameButtons);
safely(resetRewardState);
safely(() => showScreen(homeScreen));