const letters = ['A', 'B', 'C'];
const backboneIds = ['Krea_14B', 'LongLive_5B'];
const sampleCount = 10;
const clipName = /^clip-[a-f0-9]{24}\.mp4$/;
const storagePrefix = 'video-user-study.session.';
const clearedBeforeVersion = 6;
const localMediaBase = location.hostname === '127.0.0.1'
  ? new URL('./video/', location.href)
  : null;

const byId = (id) => document.getElementById(id);
const play = byId('play');
const replay = byId('replay');
const next = byId('next');
const cards = byId('cards');
const survey = byId('survey');
const expand = byId('expand');
const viewPicker = byId('view-picker');
const viewButtons = [...viewPicker.querySelectorAll('button')];
const pad = (number) => String(number).padStart(2, '0');

let config;
let trials;
let session;
let disposeQuestion = () => {};

function setView(view) {
  if (view === 'all') delete cards.dataset.view;
  else cards.dataset.view = view;
  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  for (const video of cards.querySelectorAll('video')) {
    video.toggleAttribute('inert', view !== 'all' && video.closest('.card').dataset.letter !== view);
  }
}

function isExpanded() {
  return document.fullscreenElement === survey || survey.classList.contains('viewport-expanded');
}

function updateExpand() {
  const expanded = isExpanded();
  expand.setAttribute('aria-pressed', String(expanded));
  byId('expand-label').textContent = expanded ? '退出全屏' : '全屏对比';
}

async function exitExpanded() {
  if (document.fullscreenElement === survey) await document.exitFullscreen();
  survey.classList.remove('viewport-expanded');
  updateExpand();
}

expand.addEventListener('click', async () => {
  if (isExpanded()) {
    await exitExpanded();
    return;
  }
  if (document.fullscreenEnabled) {
    try {
      await survey.requestFullscreen();
      return;
    } catch {
      // Embedded browsers can refuse fullscreen. Fill the available viewport.
    }
  }
  survey.classList.add('viewport-expanded');
  updateExpand();
});
document.addEventListener('fullscreenchange', updateExpand);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && survey.classList.contains('viewport-expanded')) exitExpanded();
});
viewPicker.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (button) setView(button.dataset.view);
});

function getTrials(settings) {
  if (!Number.isSafeInteger(settings.version) || settings.version < 1
      || !Array.isArray(settings.backbones) || settings.backbones.length !== backboneIds.length) {
    throw new Error('评测配置格式不正确。');
  }

  const clipNames = new Set();
  return settings.backbones.flatMap(({ id, duration, samples, releaseBase = settings.releaseBase }, group) => {
    if (id !== backboneIds[group] || !Array.isArray(samples) || samples.length !== sampleCount) {
      throw new Error('两个模型各需要配置 10 个视频编号。');
    }
    if (duration !== 7) throw new Error('视频时长配置不正确。');
    const ids = samples.map((sample) => sample.id);
    if (new Set(ids).size !== ids.length
        || ids.some((sample) => !Number.isInteger(sample) || sample < 1 || sample > 24)) {
      throw new Error('同一模型的视频编号必须是 1 至 24 之间的不同整数。');
    }

    return samples.map(({ id: sample, clips }) => {
      if (!Array.isArray(clips) || clips.length !== letters.length || new Set(clips).size !== clips.length
          || clips.some((name) => !clipName.test(name) || clipNames.has(name))) {
        throw new Error('每题必须包含三段不同的视频。');
      }
      for (const name of clips) clipNames.add(name);
      return { backbone: id, sample, duration, clips, releaseBase };
    });
  });
}

function shufflePositions() {
  const order = [0, 1, 2];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

function getSession() {
  const study = JSON.stringify({ version: config.version, trials });
  try {
    const saved = JSON.parse(localStorage.getItem(storagePrefix + config.version));
    if (saved?.study === study
        && saved.orders.length === trials.length
        && saved.orders.every((order) => [...order].sort().join(',') === '0,1,2')
        && saved.answers.length <= trials.length
        && saved.answers.every((answer) => Number.isInteger(answer.position)
          && answer.position >= 0 && answer.position < letters.length)) {
      return saved;
    }
  } catch {
    // A fresh session also works when browser storage is disabled.
  }

  return {
    study,
    participantId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    orders: trials.map(shufflePositions),
    answers: [],
  };
}

function clearOldSessions() {
  if (config.version < clearedBeforeVersion) return;
  try {
    localStorage.removeItem('video-user-study.session');
    for (let version = 1; version < clearedBeforeVersion; version++) {
      localStorage.removeItem(storagePrefix + version);
    }
  } catch {
    // Storage may be unavailable in this browser.
  }
}

function saveSession() {
  try {
    localStorage.setItem(storagePrefix + config.version, JSON.stringify(session));
  } catch {
    byId('storage-status').textContent = '浏览器无法保存进度，请保持本页打开，并在答完后下载记录。';
  }
}

function status(message, error = false) {
  const target = byId('media-status');
  if (target.textContent !== message) target.textContent = message;
  target.toggleAttribute('data-error', error);
}

function makeCards(order, trial) {
  const fragment = document.createDocumentFragment();
  const slots = letters.map((letter, position) => {
    const clone = byId('card').content.cloneNode(true);
    const video = clone.querySelector('video');
    const placeholder = clone.querySelector('.placeholder');
    const radio = clone.querySelector('input');
    clone.querySelector('.card').dataset.letter = letter;
    clone.querySelector('.letter').textContent = letter;
    clone.querySelector('.choice-caption').textContent = '选择 ' + letter;
    radio.value = String(position);
    radio.setAttribute('aria-label', '选择视频 ' + letter);
    video.setAttribute('aria-label', '视频 ' + letter);
    if (trial) video.src = new URL(trial.clips[order[position]], localMediaBase ?? trial.releaseBase).href;
    fragment.append(clone);
    return { video, placeholder, radio, letter };
  });
  cards.replaceChildren(fragment);
  return slots;
}

function renderQuestion() {
  disposeQuestion();
  const index = session.answers.length;
  if (index === trials.length) {
    if (isExpanded()) exitExpanded();
    survey.hidden = true;
    byId('complete-count').textContent = trials.length + ' / ' + trials.length;
    byId('complete').hidden = false;
    byId('complete-title').focus();
    return;
  }

  byId('question-number').textContent = '第 ' + pad(index + 1) + ' / ' + trials.length + ' 题';
  byId('progress-label').textContent = '已完成 ' + index + ' 题';
  byId('progress').value = index;
  byId('next-label').textContent = index === trials.length - 1 ? '完成评测' : '下一题';

  const order = session.orders[index];
  const trial = trials[index];
  const { duration } = trial;
  const slots = makeCards(order, trial);
  setView('all');
  cards.style.removeProperty('--video-ratio');
  const videos = slots.map(({ video }) => video);
  const controller = new AbortController();
  const { signal } = controller;
  const listen = (node, event, handler) => node.addEventListener(event, handler, { signal });
  let playing = false;
  let started = false;
  let watched = false;
  let selected = null;
  let mediaError = '';
  let playbackError = '';
  let playbackAttempt = 0;
  let lastCorrection = 0;

  disposeQuestion = () => {
    controller.abort();
    videos.forEach((video) => video.pause());
    cards.replaceChildren();
  };

  function ready() {
    return !mediaError && videos.every((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA);
  }

  function updateControls() {
    const playable = ready();
    play.disabled = !playable;
    replay.disabled = !playable || !started;
    next.disabled = !watched || selected === null;
    byId('play-label').textContent = playing ? '全部暂停' : '同步播放';
    byId('play-icon').setAttribute('d', playing ? 'M6 5h4v14H6z M14 5h4v14h-4z' : 'M8 5v14l11-7z');
    for (const { radio } of slots) radio.disabled = !watched;

    if (mediaError || playbackError) {
      status(mediaError || playbackError, true);
    } else if (!playable) {
      status('正在加载三段视频…');
    } else if (watched) {
      status('已看完三段视频。请选择一段，也可以从头重播。');
    } else if (playing) {
      status('正在同步播放。');
    } else {
      status(started ? '已暂停，点击同步播放可继续。' : '三段视频已就绪。');
    }
  }

  function updateTime() {
    const elapsed = videos.every((video) => video.ended)
      ? duration
      : Math.min(duration, ...videos.map((video) => video.currentTime));
    const label = elapsed.toFixed(1) + ' / ' + duration.toFixed(1) + ' 秒';
    if (byId('time').textContent !== label) byId('time').textContent = label;
  }

  function pausePlayback() {
    playbackAttempt++;
    playing = false;
    videos.forEach((video) => video.pause());
    updateControls();
  }

  async function startPlayback(fromBeginning = false) {
    if (!ready()) return;
    const elapsed = fromBeginning || videos.every((video) => video.ended)
      ? 0
      : Math.min(...videos.map((video) => video.currentTime));
    const attempt = ++playbackAttempt;
    playbackError = '';
    playing = true;
    started = true;
    for (const video of videos) {
      if (video.currentTime !== elapsed) video.currentTime = elapsed;
    }
    updateControls();

    try {
      await Promise.all(videos.map((video) => video.play()));
    } catch {
      if (signal.aborted || playbackAttempt !== attempt) return;
      playbackError = '同步播放失败，请再次点击播放。';
      pausePlayback();
    }
  }

  function syncPlayback() {
    updateTime();
    if (!playing || !videos.every((video) => !video.paused && !video.seeking)) return;
    const times = videos.map((video) => video.currentTime);
    const earliest = Math.min(...times);
    const now = performance.now();
    if (Math.max(...times) - earliest > 0.2 && now - lastCorrection > 500) {
      lastCorrection = now;
      videos.forEach((video) => {
        if (video.currentTime - earliest > 0.2) video.currentTime = earliest;
      });
    }
  }

  function checkMedia({ video, placeholder, letter }) {
    if (video.error || Math.abs(video.duration - duration) > 0.0625 || !Number.isFinite(video.duration)) {
      mediaError = video.error
        ? '视频 ' + letter + ' 无法加载，请联系研究人员。'
        : '视频 ' + letter + ' 的时长不符合 ' + duration + ' 秒要求，请联系研究人员。';
      pausePlayback();
      return;
    }
    cards.style.setProperty('--video-ratio', video.videoWidth / video.videoHeight);
    placeholder.hidden = true;
    video.hidden = false;
    updateControls();
  }

  for (const slot of slots) {
    const { video, radio } = slot;
    listen(video, 'loadedmetadata', () => checkMedia(slot));
    listen(video, 'error', () => checkMedia(slot));
    listen(video, 'timeupdate', syncPlayback);
    listen(video, 'ended', () => {
      updateTime();
      if (videos.every((clip) => clip.ended)) {
        watched = true;
        pausePlayback();
      }
    });
    listen(radio, 'change', () => {
      selected = Number(radio.value);
      updateControls();
    });
    if (video.error || video.readyState >= HTMLMediaElement.HAVE_METADATA) checkMedia(slot);
  }

  listen(play, 'click', () => {
    if (playing) pausePlayback();
    else startPlayback();
  });
  listen(replay, 'click', () => startPlayback(true));
  listen(next, 'click', () => {
    if (!watched || selected === null) return;
    const answeredAt = new Date().toISOString();
    session.answers.push({ position: selected, answeredAt });
    if (session.answers.length === trials.length) session.completedAt = answeredAt;
    saveSession();
    renderQuestion();
    if (session.answers.length < trials.length) {
      window.scrollTo(0, 0);
      survey.scrollTop = 0;
      byId('question').focus({ preventScroll: true });
    }
  });
  updateTime();
  updateControls();
}

byId('download').addEventListener('click', () => {
  const response = {
    studyVersion: config.version,
    participantId: session.participantId,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    answers: session.answers.map(({ position, answeredAt }, index) => {
      const { backbone, sample, duration, clips } = trials[index];
      const order = session.orders[index];
      return {
        question: index + 1,
        backbone,
        sample,
        duration,
        displayed: Object.fromEntries(letters.map((letter, slot) => [letter, clips[order[slot]]])),
        selectedOption: letters[position],
        selectedClip: clips[order[position]],
        answeredAt,
      };
    }),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'video-study-' + response.participantId + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  const response = await fetch('./study-7s.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取评测配置。');
  config = await response.json();
  trials = getTrials(config);
  byId('study-count').textContent = trials.length;
  byId('progress').max = trials.length;
  clearOldSessions();
  session = getSession();
  saveSession();
  renderQuestion();
} catch (error) {
  makeCards();
  status(error instanceof Error ? error.message : '无法载入评测。', true);
}
