// ==UserScript==
// @name         Sanity — инструменты Starter (зоны, баннеры, контентные страницы)
// @namespace    starterapp-sanity-tools
// @version      1.20261113.1807
// @description  Общий скрипт: управление зонами, менеджер баннеров и редактор контентных страниц. Каждый модуль включается на своей странице, как раньше. Состав: zones 7.18, banners 2.10.2, pages 0.6.3
// @updateURL    https://raw.githubusercontent.com/Gnomophile/sanity-tools/main/sanity-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/Gnomophile/sanity-tools/main/sanity-tools.user.js
// @match        https://my.starterapp.ru/*
// @icon         https://www.sanity.io/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

// Сгенерировано build.js — правки вносить в исходные скрипты и пересобирать.
(function () {
  'use strict';
  // С @grant скрипт работает в песочнице: настоящее окно страницы — unsafeWindow.
  const PAGE_WIN = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (PAGE_WIN.__STARTER_SANITY_TOOLS__) return; // защита от двойного запуска
  PAGE_WIN.__STARTER_SANITY_TOOLS__ = '1.20261113.1807';

  function runModule(name, fn) {
    try { fn(); }
    catch (e) { console.error('[Sanity-tools] модуль «' + name + '» не запустился:', e); }
  }
  // Аналог @run-at document-idle для модулей, которые раньше так и запускались
  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  // ===== Модуль: zones (sanity-zone/sanity-multitool.user.js, v7.18) — сразу, до загрузки страницы
  runModule('zones', function () {
    (function (window, console) {
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Определение Project ID.
  // ---------------------------------------------------------------------
  let cachedProjectId = null;
  let cachedWorkspace = null;

  const PROJECT_ID_LOG_RE = /SANITY PROJECT ID[\s>:=-]*([a-z0-9]{6,})/i;
  const origConsoleWarn = console.warn.bind(console);

  function currentWorkspace() {
    return window.location.pathname.split('/').filter(Boolean)[0] || null;
  }

  function setCachedProjectId(id) {
    cachedProjectId = id;
    cachedWorkspace  = currentWorkspace();
  }

  function tryCaptureFromArgs(args) {
    const combined = args
      .filter(a => typeof a === 'string' || typeof a === 'number')
      .join(' ');
    if (!combined.includes('SANITY PROJECT ID')) return;
    const m = combined.match(PROJECT_ID_LOG_RE);
    if (m) {
      setCachedProjectId(m[1]);
    } else {
      origConsoleWarn('[SZ] Нашёл "SANITY PROJECT ID" в логе, но не смог извлечь id из:', combined);
    }
  }

  for (const method of ['log', 'info', 'warn', 'debug']) {
    const orig = console[method].bind(console);
    console[method] = function (...args) {
      tryCaptureFromArgs(args);
      return orig(...args);
    };
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const m = url && url.match(/^https?:\/\/([a-z0-9]+)\.api\.sanity\.io/);
    if (m) setCachedProjectId(m[1]);
    return origFetch.call(this, input, init);
  };

  function getProjectId() {
    const ws = currentWorkspace();
    if (cachedProjectId && cachedWorkspace === ws) return cachedProjectId;
    if (cachedProjectId && cachedWorkspace !== ws) return null;
    const entries = performance.getEntriesByType('resource').map(e => e.name);
    const entry = entries.find(n => n.includes('.api.sanity.io'));
    const fromPerf = entry?.match(/^https?:\/\/([a-z0-9]+)\.api\.sanity\.io/)?.[1] || null;
    if (fromPerf) setCachedProjectId(fromPerf);
    return cachedProjectId;
  }

  function newKey() {
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function deepClone(zone) {
    const c = JSON.parse(JSON.stringify(zone));
    c._key = newKey();
    if (Array.isArray(c.deliveryTypePrices)) {
      c.deliveryTypePrices = c.deliveryTypePrices.map(d => {
        const dc = { ...d, _key: newKey() };
        if (Array.isArray(dc.deliveryPrice)) dc.deliveryPrice = dc.deliveryPrice.map(p => ({ ...p, _key: newKey() }));
        return dc;
      });
    }
    return c;
  }

  function getShopId() {
    return window.location.href.match(/shops-item;shops;([a-f0-9-]{36})/)?.[1] || null;
  }

  function getAuthHeaders(projectId) {
    const tokenData = JSON.parse(localStorage.getItem(`__studio_auth_token_${projectId}`) || 'null');
    if (tokenData?.token) return { 'Authorization': `Bearer ${tokenData.token}` };
    return {};
  }

  async function apiFetch(projectId, path, options = {}) {
    const base = `https://${projectId}.api.sanity.io/v2024-05-28`;
    const headers = { ...getAuthHeaders(projectId), ...(options.headers || {}) };
    return fetch(`${base}${path}`, { ...options, headers, credentials: 'include' });
  }

  async function getDoc(projectId, id) {
    const r = await apiFetch(projectId, `/data/doc/production/drafts.${id},${id}`);
    const { documents } = await r.json();
    return documents.find(d => d._id === `drafts.${id}`) || documents.find(d => d._id === id) || null;
  }

  // Запрос списка всех актуальных ресторанов текущего workspace (исключая архив),
  // вместе с их зонами доставки (_key + name), нужен для двухуровневого каталога
  // в массовом применении условий. У каждой зоны также подтягиваются её способы
  // получения (deliveryTypePrices, _key + название через дереференс ->) — нужны
  // для третьего уровня пикера на вкладке «Способы оплаты» (у каждого способа
  // получения свой список paymentTypes, поэтому переключать нужно уметь и
  // зону целиком, и конкретный способ получения внутри неё). Дереференс сразу
  // в этом же запросе, без отдельного resolveDeliveryTypeNames — GROQ отдаёт
  // имя одним походом за счёт deliveryType->name.ru.
  async function fetchAllShops(projectId) {
    const query = encodeURIComponent(
      `*[_type == "shop" && !(_id in path("drafts.**")) && isArchived != true] | order(name.ru asc) {
        _id, name, address,
        "zones": deliveryZones[]{
          _key, name,
          "types": deliveryTypePrices[]{_key, "name": deliveryType->name.ru}
        }
      }`
    );
    const r = await apiFetch(projectId, `/data/query/production?query=${query}`);
    if (!r.ok) throw new Error("Не удалось загрузить список ресторанов");
    const { result } = await r.json();
    return result;
  }

  async function resolveDeliveryTypeNames(projectId, refs) {
    if (!refs.length) return {};
    const r = await apiFetch(projectId, `/data/doc/production/${refs.join(',')}`);
    const { documents } = await r.json();
    const map = {};
    for (const d of documents) map[d._id] = d.name?.ru || d.title?.ru || d._id;
    return map;
  }

  // Находит документы каталога "способы получения" (deliveryType) по их
  // служебному коду (поле type: "pickup"/"indoor"/"courier" — фиксированный
  // enum схемы, одинаковый во всех проектах), а не по названию, так как
  // название редактируется руками и не гарантированно совпадает с ожидаемым.
  // Нужен для вкладки «Способы получения», где новый deliveryTypePrices
  // создаётся с нуля и требует ссылку на этот общий каталожный документ.
  async function fetchDeliveryTypeRefs(projectId, types) {
    const query = encodeURIComponent(
      `*[_type == "deliveryType" && type in [${types.map(t => JSON.stringify(t)).join(',')}]]{_id, type, "name": name.ru}`
    );
    const r = await apiFetch(projectId, `/data/query/production?query=${query}`);
    if (!r.ok) throw new Error('не удалось загрузить каталог способов получения');
    const { result } = await r.json();
    const map = {};
    for (const d of (result || [])) map[d.type] = { ref: d._id, name: d.name || d.type };
    return map;
  }

  // Резолвит названия блюд каталога (тип "meal") по их id — для отображения
  // человекочитаемого названия у уже выбранной "Позиции для доставки из POS-системы".
  async function resolveMealNames(projectId, refs) {
    if (!refs.length) return {};
    const r = await apiFetch(projectId, `/data/doc/production/${refs.join(',')}`);
    const { documents } = await r.json();
    const map = {};
    for (const d of documents) map[d._id] = d.name?.ru || d.iikoName || d._id;
    return map;
  }

  // Поиск блюд каталога по названию — используется в поиске "Позиции для доставки
  // из POS-системы" в модалке условий. Ищет и по обычному названию, и по названию
  // из POS (iikoName), так как у доставочных позиций часто заполнено только оно.
  async function searchMeals(projectId, term) {
    const raw = (term || '').trim();
    if (!raw) return [];
    const safe = raw.replace(/["\\]/g, '').slice(0, 60);
    if (!safe) return [];
    const query = encodeURIComponent(
      `*[_type == "meal" && (name.ru match "*${safe}*" || iikoName match "*${safe}*")] | order(name.ru asc) [0...25]{
        _id, "title": coalesce(name.ru, iikoName, _id), "code": code.current, status
      }`
    );
    const r = await apiFetch(projectId, `/data/query/production?query=${query}`);
    if (!r.ok) throw new Error('запрос к каталогу не удался');
    const { result } = await r.json();
    return result || [];
  }

  // Публикует черновик заведения: копирует содержимое drafts.{id} в опубликованный
  // документ {id} и удаляет черновик — то же самое, что кнопка «Опубликовать» в интерфейсе.
  // Если черновика нет (значит уже опубликовано/нет несохранённых правок) — просто выходим.
  // ---------------------------------------------------------------------
  // Отслеживание "своих" черновиков: после каждого успешного патча запоминаем
  // ревизию (_rev), которую сам оставил скрипт. Если при следующем запуске
  // ревизия черновика совпадает с сохранённой — значит, с момента нашего
  // последнего касания никто больше документ не трогал, и накопленные
  // изменения безопасно публиковать. Если ревизия другая (или записи нет) —
  // считаем черновик потенциально содержащим посторонние правки.
  // ---------------------------------------------------------------------
  function ownedDraftKey(projectId, shopId) {
    return `sz-owned-draft:${projectId}:${shopId}`;
  }
  function getOwnedDraftRev(projectId, shopId) {
    try {
      const raw = localStorage.getItem(ownedDraftKey(projectId, shopId));
      return raw ? (JSON.parse(raw)?.rev || null) : null;
    } catch (e) { return null; }
  }
  function setOwnedDraftRev(projectId, shopId, rev) {
    if (!rev) return;
    try { localStorage.setItem(ownedDraftKey(projectId, shopId), JSON.stringify({ rev, ts: Date.now() })); }
    catch (e) { /* localStorage недоступен/переполнен — не критично */ }
  }
  function clearOwnedDraftRev(projectId, shopId) {
    try { localStorage.removeItem(ownedDraftKey(projectId, shopId)); } catch (e) { /* ignore */ }
  }

  // Резервная узкая проверка перед публикацией — только для МАССОВОГО применения,
  // где нет доступа к отрисованной странице других ресторанов и, соответственно,
  // к результату валидации самой Studio. Ловит только то, что подтверждено на
  // практике (отсутствие города) — НЕ полноценная валидация и заведомо не покрывает
  // прочие кастомные правила схемы. Для одиночного применения используется
  // hasStudioValidationError() — она гораздо надёжнее, так как читает уже готовый
  // результат валидации, посчитанный самой Studio.
  function getKnownValidationBlockers(doc) {
    const blockers = [];
    if (!doc?.address?.cityRef?._ref) blockers.push('не выбран город (Адрес → Город)');
    return blockers;
  }

  // Проверяет, показывает ли САМА Studio ошибку валидации для документа,
  // который сейчас открыт на странице (кнопка "Валидация" в шапке документа
  // существует в DOM только когда есть хотя бы одна ошибка валидации любого
  // рода — какие бы кастомные правила ни были в схеме, achievable без
  // необходимости знать их заранее). Работает только для текущего открытого
  // документа — у других документов (не отрисованных на странице) этой
  // информации получить нельзя.
  function hasStudioValidationError() {
    const btn = document.querySelector('button[aria-label="Валидация"]');
    return !!btn?.querySelector('[data-sanity-icon="error-outline"]');
  }

  // Переключает Studio на документ ресторана через её собственный SPA-роутер
  // (pushState + popstate), НЕ перезагружая страницу — скрипт и все его переменные
  // остаются живы. Ждёт, пока URL и панель валидации реально обновятся.
  async function navigateToShopSpa(workspace, shopId, timeoutMs = 6000) {
    const targetPath = `/${workspace}/structure/shops-item;shops;${shopId}`;
    history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 250));
      if (location.pathname.includes(shopId)) break;
    }
    // доп. пауза, чтобы Studio успела пересчитать и отрисовать валидацию для нового документа
    await new Promise(r => setTimeout(r, 700));
  }

  // Предполётная проверка перед массовой публикацией: по очереди открывает каждый
  // выбранный ресторан через SPA-навигацию и читает у Studio реальный результат
  // валидации (какие бы кастомные правила ни были в схеме). В конце возвращает
  // Studio туда, откуда начали. Возвращает список ресторанов, не прошедших валидацию.
  async function checkShopsValidationBeforePublish(workspace, shopIds, originalPath, showProgress) {
    const invalidShops = [];
    for (let i = 0; i < shopIds.length; i++) {
      const shopId = shopIds[i];
      if (showProgress) showToast(`Проверка валидации: ${i + 1} из ${shopIds.length}...`, 'info', 2000);
      await navigateToShopSpa(workspace, shopId);
      if (hasStudioValidationError()) {
        const shopName = document.querySelector('h1')?.textContent?.trim() || shopId;
        invalidShops.push({ shopId, shopName });
      }
    }
    await navigateToShopSpa(workspace, originalPath.match(/shops;([a-f0-9-]{36})/)?.[1] || '');
    return invalidShops;
  }

  async function publishDoc(projectId, shopId) {
    const draftId = 'drafts.' + shopId;
    const { documents } = await (await apiFetch(projectId, `/data/doc/production/${draftId}`)).json();
    const draftDoc = documents?.[0];
    if (!draftDoc) return false;

    const blockers = getKnownValidationBlockers(draftDoc);
    if (blockers.length > 0) {
      throw new Error('не пройдена валидация — ' + blockers.join('; ') + '. Исправьте вручную в интерфейсе и опубликуйте оттуда.');
    }

    const publishedDoc = { ...draftDoc, _id: shopId };
    delete publishedDoc._rev;
    const mutations = [
      { createOrReplace: publishedDoc },
      { delete: { id: draftId } }
    ];
    const r = await apiFetch(projectId, `/data/mutate/production`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations })
    });
    if (!r.ok) {
      const result = await r.json();
      throw new Error('публикация не удалась: ' + JSON.stringify(result?.error || result));
    }
    return true;
  }

  function getAddress(doc) {
    const street = doc.address?.street?.ru || '';
    const house  = doc.address?.house?.ru  || '';
    if (street && house) return `${street}, ${house}`;
    return street || doc.name?.ru || doc._id;
  }

  // Формирует имя файла бэкапа с меткой времени: prefix_2026-08-11_14-32-07.json
  function backupFilename(prefix) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const safePrefix = String(prefix).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    return `${safePrefix}_${stamp}.json`;
  }

  // Скачивает объект как .json файл через скрытую ссылку — без сервера, чисто в браузере
  function downloadJson(filename, data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      showToast('Не удалось сохранить бэкап: ' + e.message, 'error');
    }
  }

  // ---------------------------------------------------------------------
  // Стили модалки (палитра из modal-style-guide) + переключатель темы.
  // Тема хранится в localStorage и применяется классом .smt-dark на корневой
  // элемент каждого всплывающего окна (оверлей/тост/confirm) — они не вложены
  // друг в друга, поэтому переменные темы нельзя унаследовать через один общий
  // корень, каждый корень получает класс отдельно при создании.
  // ---------------------------------------------------------------------
  const SZ_MODAL_STYLE_ID = 'sz-modal-styles';
  const SZ_THEME_KEY = 'sz-modal-theme';

  function ensureModalStyles() {
    if (document.getElementById(SZ_MODAL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SZ_MODAL_STYLE_ID;
    style.textContent = `
      :root {
        --smt-accent: #bd5b34;
        --smt-accent-hover: #9c4a29;
        --smt-accent-shadow: rgba(189, 91, 52, .35);
        --smt-accent-soft-bg: #f3e3da;
        --smt-accent-soft-border: #e0b89e;
        --smt-accent-soft-text: #7a3c1e;
        --smt-bg-page: #fbf9f5;
        --smt-bg-panel: #fffdfa;
        --smt-bg-subtle: #f2ede2;
        --smt-border: #e6dfd0;
        --smt-border-soft: #ece6d9;
        --smt-text-primary: #2b2620;
        --smt-text-secondary: #857e6f;
        --smt-text-tertiary: #a89f8c;
        --smt-warning-bg: #fff3cd;
        --smt-warning-border: #ffe08a;
        --smt-warning-text: #6b5416;
      }
      .smt-dark {
        --smt-accent: #d97a4f;
        --smt-accent-hover: #e8956d;
        --smt-accent-shadow: rgba(217, 122, 79, .4);
        --smt-accent-soft-bg: #4a2f22;
        --smt-accent-soft-border: #6b4530;
        --smt-accent-soft-text: #edb08a;
        --smt-bg-page: #211d17;
        --smt-bg-panel: #2b251d;
        --smt-bg-subtle: #332c22;
        --smt-border: #443b2d;
        --smt-border-soft: #3a3327;
        --smt-text-primary: #f1ece1;
        --smt-text-secondary: #b8ae9c;
        --smt-text-tertiary: #8f8672;
        --smt-warning-bg: #4a3c14;
        --smt-warning-border: #6b5a24;
        --smt-warning-text: #e8d9a8;
      }
      .sz-modal-ui button { margin: 0; padding: 0; font: inherit; }
      .sz-modal-ui, .sz-modal-ui * {
        transition: background-color .2s ease, border-color .2s ease, color .2s ease;
      }
      .sz-flat-btn {
        border: 1px solid var(--smt-border); background: var(--smt-bg-panel); border-radius: 8px;
        color: var(--smt-text-secondary); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .sz-flat-btn:hover { border-color: var(--smt-accent); }
      .smt-theme-switch {
        position: relative; display: inline-flex; align-items: center; cursor: pointer;
        -webkit-tap-highlight-color: transparent; user-select: none; flex-shrink: 0;
      }
      .smt-theme-switch .switch__input {
        margin: 0; width: 66px; height: 34px; background-color: var(--smt-bg-page);
        border: 1px solid var(--smt-border); border-radius: 8px;
        outline: none; box-shadow: none; -webkit-tap-highlight-color: transparent;
        -webkit-appearance: none; appearance: none; cursor: pointer;
        transition: background-color .2s ease, border-color .2s ease;
      }
      .smt-theme-switch .switch__input:checked { background-color: var(--smt-bg-subtle); }
      .smt-theme-switch .switch__input:focus-visible { box-shadow: 0 0 0 2px var(--smt-accent-shadow); }
      .smt-theme-switch .switch__icon {
        position: absolute; top: 50%; width: 12px; height: 12px; transform: translateY(-50%) rotate(0deg);
        pointer-events: none; z-index: 2; color: var(--smt-text-tertiary);
        transition: color .2s ease, transform .3s ease;
      }
      .smt-theme-switch .switch__icon--sun { left: 11px; }
      .smt-theme-switch .switch__icon--moon { right: 11px; }
      .smt-theme-switch .switch__input:not(:checked) ~ .switch__icon--sun {
        color: #fff; transform: translateY(-50%) rotate(360deg);
      }
      .smt-theme-switch .switch__input:checked ~ .switch__icon--moon {
        color: #fff; transform: translateY(-50%) rotate(360deg);
      }
      .smt-theme-switch .switch__knob {
        position: absolute; top: 3px; left: 3px; width: 28px; height: 28px; border-radius: 6px;
        background: var(--smt-accent); pointer-events: none; z-index: 1;
        transition: transform .25s cubic-bezier(0.65,0,0.35,1), background-color .2s ease;
      }
      .smt-theme-switch .switch__input:checked ~ .switch__knob { transform: translateX(32px); }
      .smt-theme-switch .switch__sr { overflow: hidden; position: absolute; width: 1px; height: 1px; }

      /* Сегментированный переключатель (N позиций, radio) — вкладки модалки и
         вкл/выкл способа оплаты. Заливка едет вертикально translateY, поэтому
         позиций может быть любое число без пересчёта геометрии. */
      .smt-tri {
        position: relative; display: inline-flex; height: 42px; border: 1px solid var(--smt-border);
        border-radius: 8px; overflow: hidden; flex-shrink: 0; box-sizing: border-box;
      }
      .smt-tri input { position: absolute; width: 0; height: 0; opacity: 0; }
      .smt-tri-opt {
        position: relative; overflow: hidden; height: 100%; box-sizing: border-box;
        display: inline-flex; align-items: center; justify-content: center;
        padding: 0 14px; font-size: 13px; font-weight: 600;
        cursor: pointer; color: var(--smt-text-secondary); white-space: nowrap; background: var(--smt-bg-panel);
      }
      .smt-tri-opt + .smt-tri-opt { border-left: 1px solid var(--smt-border); }
      .smt-tri-opt:hover .smt-tri-text { color: var(--smt-text-primary); }
      .smt-tri-fill {
        position: absolute; inset: 0; background: var(--smt-accent);
        transform: translateY(-100%);
        transition: transform .5s cubic-bezier(0.22, 1, 0.36, 1);
        z-index: 1;
      }
      .smt-tri-text { position: relative; z-index: 2; transition: color .15s ease; }
      .smt-tri input:checked + label .smt-tri-fill { transform: translateY(0); }
      .smt-tri input:checked + label .smt-tri-text { color: #fff; }

      /* Дерево ресторан→зоны, общее для всех вкладок-пикеров целей/источника. */
      .smt-shop-tree { max-height: 300px; overflow-y: auto; border: 1px solid var(--smt-border-soft); border-radius: 6px; padding: 10px; }
      .smt-shop-block { border: 1px solid var(--smt-border-soft); border-radius: 6px; margin-bottom: 6px; padding: 6px 10px; }
      .smt-shop-block summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; color: var(--smt-text-primary); }
      .smt-shop-block summary::-webkit-details-marker { display: none; }

      /* Кнопка вызова хаба в левом меню Studio — живёт вне .sz-modal-ui,
         поэтому сбрасывает свои UA-отступы сама (см. pitfalls.md, пункт 1). */
      #sz-nav-btn {
        margin: 0; box-sizing: border-box;
        display: inline-flex; align-items: center; gap: 6px; margin-left: 4px;
        background: var(--smt-accent); color: #fff; border: none; border-radius: 6px;
        padding: 0 14px; height: 33px; font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: inherit; white-space: nowrap;
      }
      #sz-nav-btn:hover { background: var(--smt-accent-hover); }
      #sz-fab {
        margin: 0; box-sizing: border-box;
        position: fixed; bottom: 22px; right: 22px; z-index: 999998;
        display: inline-flex; align-items: center; gap: 8px;
        background: var(--smt-accent); color: #fff; border: none; border-radius: 24px;
        padding: 11px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: inherit; white-space: nowrap;
        box-shadow: 0 6px 18px var(--smt-accent-shadow);
      }
      #sz-fab:hover { background: var(--smt-accent-hover); }
      .sz-icon { display: inline-flex; flex-shrink: 0; }
      .sz-icon svg { width: 14px; height: 14px; display: block; }
      .sz-icon--lg svg { width: 20px; height: 20px; }
    `;
    document.head.appendChild(style);
  }

  function getStoredTheme() {
    try { return localStorage.getItem(SZ_THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }
  function setStoredTheme(theme) {
    try { localStorage.setItem(SZ_THEME_KEY, theme); } catch (e) { /* localStorage недоступен — просто не запомним выбор */ }
  }
  function applyStoredTheme(el) {
    ensureModalStyles();
    el.classList.add('sz-modal-ui');
    el.classList.toggle('smt-dark', getStoredTheme() === 'dark');
  }

  // Свитч темы для шапки модалки. Иконки и шайба — прямые соседи input
  // (без оборачивающего <span>), иначе CSS ~-селекторы перестают матчить.
  function buildThemeSwitch(onToggle) {
    const label = document.createElement('label');
    label.className = 'smt-theme-switch';
    label.title = 'Переключить тему';
    label.innerHTML = `
      <span class="switch__sr">Тёмная тема</span>
      <input type="checkbox" class="switch__input" data-sz-theme-toggle>
      <svg class="switch__icon switch__icon--sun" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>
      <svg class="switch__icon switch__icon--moon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>
      <span class="switch__knob"></span>
    `;
    const input = label.querySelector('[data-sz-theme-toggle]');
    input.checked = getStoredTheme() === 'dark';
    input.addEventListener('change', () => {
      const next = input.checked ? 'dark' : 'light';
      setStoredTheme(next);
      if (onToggle) onToggle(next);
    });
    return label;
  }

  // Доп. подтверждение перед массовым применением — легко ошибиться, задев сразу
  // много ресторанов, а откат из бэкапа небыстрый. "Нет" просто закрывает окно
  // подтверждения и возвращает к прежним настройкам в модалке — ничего не сбрасывается.
  function showMassApplyConfirm(shopsCount, onConfirm) {
    const confirmOverlay = document.createElement('div');
    applyStoredTheme(confirmOverlay);
    confirmOverlay.style.cssText = `
      position:fixed;inset:0;z-index:9999999;
      background:rgba(23,20,14,.55);
      display:flex;align-items:center;justify-content:center;
      font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
      background:var(--smt-bg-panel);color:var(--smt-text-primary);border-radius:12px;padding:28px;
      width:420px;max-width:90vw;
      box-shadow:0 10px 40px rgba(0,0,0,0.35);
      text-align:center;
    `;
    const shopsLabel = shopsCount != null ? `${shopsCount} ${shopsCount === 1 ? 'ресторан' : 'ресторанов'}` : 'несколько ресторанов';
    box.innerHTML = `
      <div style="font-size:38px;margin-bottom:8px;">⚠️</div>
      <div style="font-size:19px;font-weight:700;color:var(--smt-text-primary);margin-bottom:10px;">Точно?</div>
      <div style="font-size:14px;color:var(--smt-text-secondary);margin-bottom:24px;line-height:1.55;">
        Изменения применятся сразу к ${shopsLabel}. Это действие нельзя откатить одним кликом —
        восстановление из бэкапа придётся делать вручную. Проверьте ещё раз список
        ресторанов и зон перед тем, как продолжить.
      </div>
      <div style="display:flex; gap:12px;">
        <button id="sz-confirm-no" style="flex:1;padding:12px;border:1px solid var(--smt-border);background:var(--smt-bg-panel);color:var(--smt-text-primary);border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">Нет, вернуться</button>
        <button id="sz-confirm-yes" style="flex:1;padding:12px;border:none;background:#d64236;color:#fff;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">Да, применить</button>
      </div>
    `;
    confirmOverlay.appendChild(box);
    document.body.appendChild(confirmOverlay);

    box.querySelector('#sz-confirm-no').addEventListener('click', () => confirmOverlay.remove());
    box.querySelector('#sz-confirm-yes').addEventListener('click', () => {
      confirmOverlay.remove();
      onConfirm();
    });
    confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) confirmOverlay.remove(); });
  }

  function showToast(message, type = 'info', duration = 5000) {
    const existing = document.getElementById('sz-toast');
    if (existing) existing.remove();
    const palette = {
      info:    { bg: '#eaf2fd', border: '#2f6fd1', text: '#173963' },
      success: { bg: '#eafaf1', border: '#1f9d55', text: '#0f4a28' },
      error:   { bg: '#fdecea', border: '#d64236', text: '#7a201a' },
      warning: { bg: '#fff6e0', border: '#e0900a', text: '#6b4600' }
    };
    const c = palette[type] || palette.info;
    const toast = document.createElement('div');
    toast.id = 'sz-toast';
    applyStoredTheme(toast);
    toast.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:999999;
      background:${c.bg}; color:${c.text};
      border-left:5px solid ${c.border};
      padding:14px 20px; border-radius:8px; font-size:14px; font-weight:500;
      box-shadow:0 6px 20px rgba(0,0,0,0.18); max-width:440px; max-height:70vh; overflow-y:auto;
      line-height:1.6; white-space:pre-line; transition:opacity 0.3s;
      font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
  }

  // Копирует набор зон (уже загруженных у ресторана-источника) в несколько
  // ресторанов-целей сразу — раньше это было двухшаговым действием через
  // глобальный clipboard (открыть источник → «Копировать», открыть цель →
  // «Вставить»); теперь источник и цели выбираются явно в одной модалке,
  // поэтому шаг сведён к одному проходу по списку целей.
  async function copyZonesToShops(projectId, sourceZones, sourceAddress, targetShopIds, opts) {
    opts = opts || {};
    const addedByShop = {};
    const skippedMsgs = [];
    const errors = [];
    for (const shopId of targetShopIds) {
      try {
        const targetDoc = await getDoc(projectId, shopId);
        if (!targetDoc) { errors.push(`${shopId}: заведение не найдено`); continue; }
        const targetZones = targetDoc.deliveryZones || [];
        const draftId  = 'drafts.' + shopId;
        const hasDraft = targetDoc._id.startsWith('drafts.');
        const zonesToAdd = [];
        const skippedHere = [];
        for (const zone of sourceZones) {
          const newName = opts.hideSource ? zone.name : `${zone.name} с ${sourceAddress}`;
          if (targetZones.find(z => z.name === newName)) { skippedHere.push(newName); continue; }
          const clone = deepClone(zone);
          clone.name = newName;
          zonesToAdd.push(clone);
        }
        if (skippedHere.length) skippedMsgs.push(`${targetDoc.name?.ru || shopId}: ${skippedHere.join(', ')} (уже есть)`);
        if (zonesToAdd.length === 0) continue;

        const mutations = [];
        if (!hasDraft) {
          const { documents } = await (await apiFetch(projectId, `/data/doc/production/${shopId}`)).json();
          mutations.push({ createIfNotExists: { ...documents[0], _id: draftId } });
        }
        mutations.push({
          patch: {
            id: draftId,
            setIfMissing: { deliveryZones: [] },
            insert: { after: 'deliveryZones[-1]', items: zonesToAdd }
          }
        });
        const r = await apiFetch(projectId, `/data/mutate/production?returnIds=true&returnDocuments=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutations })
        });
        if (!r.ok) {
          const result = await r.json();
          errors.push(`${targetDoc.name?.ru || shopId}: ошибка Sanity — ${JSON.stringify(result?.error || result)}`);
          continue;
        }
        const result = await r.json();
        const draftResult = result.results?.find(x => x.id === draftId);
        const ownedRev = hasDraft ? getOwnedDraftRev(projectId, shopId) : null;
        const isKnownOwned = !hasDraft || (ownedRev !== null && ownedRev === targetDoc._rev);
        const isForeignDraft = hasDraft && !isKnownOwned;
        if (isKnownOwned) setOwnedDraftRev(projectId, shopId, draftResult?.document?._rev || null);

        addedByShop[shopId] = { shopName: targetDoc.name?.ru || shopId, zoneNames: zonesToAdd.map(z => z.name), isForeignDraft };

        if (opts.autoPublish) {
          if (isForeignDraft && !opts.forcePublish) {
            addedByShop[shopId].publishSkipped = 'foreign';
          } else {
            try {
              await publishDoc(projectId, shopId);
              clearOwnedDraftRev(projectId, shopId);
              addedByShop[shopId].published = true;
            } catch (e) {
              addedByShop[shopId].publishError = e.message;
            }
          }
        }
      } catch (e) {
        errors.push(`${shopId}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { addedByShop, skippedMsgs, errors };
  }

  const PAYMENT_TYPES = [
    { value: 'card',          label: 'Банковская карта' },
    { value: 'cash',          label: 'Наличные' },
    { value: 'cardToCourier', label: 'Картой курьеру' },
    { value: 'cashToCourier', label: 'Наличными курьеру' },
    { value: 'sbp',           label: 'СБП' },
    { value: 'sberpay',       label: 'SberPay' },
    { value: 'bonus',         label: 'Бонусный счёт' },
    { value: 'apple',         label: 'Apple Pay' },
    { value: 'applePayWeb',   label: 'Apple Pay на странице оплаты' },
    { value: 'google',        label: 'Google Pay' }
  ];

  // Сетка чекбоксов способов оплаты — общая часть для вкладки «Условия»
  // (buildPaymentTypesEditor, с обёрткой «включить копирование поля») и
  // вкладки «Способы получения» (без обёртки, поле обязательно всегда).
  function buildPaymentTypesGrid(currentValues) {
    const grid = document.createElement('div');
    grid.setAttribute('data-sz-payment-grid', '1');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;';
    const known = new Set(currentValues || []);
    for (const pt of PAYMENT_TYPES) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-primary);cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-sz-payment-value', pt.value);
      cb.checked = known.has(pt.value);
      cb.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);';
      const span = document.createElement('span');
      span.textContent = pt.label;
      label.appendChild(cb);
      label.appendChild(span);
      grid.appendChild(label);
    }
    return grid;
  }

  function readPaymentTypesGrid(grid) {
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('input[data-sz-payment-value]'))
      .filter(cb => cb.checked)
      .map(cb => cb.getAttribute('data-sz-payment-value'));
  }

  function buildPaymentTypesEditor(currentValues) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-sz-payment-types', '1');
    wrap.style.cssText = 'margin-top:14px;';
    const title = document.createElement('label');
    title.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-secondary);margin-bottom:8px;cursor:pointer;';
    title.innerHTML = '<input type="checkbox" data-sz-include-payment style="width:15px;height:15px;cursor:pointer;accent-color:var(--smt-accent);"> Типы оплаты';
    wrap.appendChild(title);
    wrap.appendChild(buildPaymentTypesGrid(currentValues));
    return wrap;
  }

  function readPaymentTypes(container) {
    const wrap = container.querySelector('[data-sz-payment-types]');
    if (!wrap) return null;
    return readPaymentTypesGrid(wrap.querySelector('[data-sz-payment-grid]'));
  }

  const FULFILLMENT_METHODS = [
    { value: 'pickup', label: 'Самовывоз' },
    { value: 'indoor', label: 'В зале' }
  ];

  // Виджет выбора "Позиции для доставки из POS-системы" — обязательного блюда из
  // каталога, которое Sanity требует указывать, когда доставка платная (цена по
  // умолчанию или ступень градации != 0). Хранит выбор в data-атрибутах на самом
  // wrap-элементе (productRef/productTitle), чтобы его было легко прочитать при
  // сборе изменений и при проверке "не забыли ли выбрать блюдо".
  function buildProductPicker(projectId, opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.setAttribute('data-sz-product-picker', '1');
    wrap.dataset.productRef = opts.currentRef || '';
    wrap.dataset.productTitle = opts.currentTitle || '';
    wrap.style.cssText = 'margin-top:6px;';

    // opts.includeCheckbox — показать свою галочку «копировать позицию» в подписи.
    // Нужна для дефолтного пикера во вкладке «Условия»: раньше позицию можно было
    // скопировать только вместе с ценой, а сам пикер лежал внутри <label> цены,
    // из-за чего выбор блюда переключал галочку «Цена по умолчанию».
    const label = document.createElement(opts.includeCheckbox ? 'label' : 'div');
    label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--smt-text-tertiary);margin-bottom:4px;'
      + (opts.includeCheckbox ? 'cursor:pointer;' : '');
    if (opts.includeCheckbox) {
      const incCb = document.createElement('input');
      incCb.type = 'checkbox';
      incCb.setAttribute('data-sz-include-product', '1');
      incCb.style.cssText = 'width:15px;height:15px;cursor:pointer;accent-color:var(--smt-accent);';
      label.appendChild(incCb);
      label.appendChild(document.createTextNode('Позиция для доставки из POS-системы'));
    } else {
      label.textContent = 'Позиция для доставки из POS-системы';
    }
    wrap.appendChild(label);

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const chip = document.createElement('div');
    chip.style.cssText = 'flex:1;min-width:0;padding:7px 10px;border:1px solid var(--smt-border);border-radius:6px;font-size:13px;background:var(--smt-bg-panel);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.textContent = '🔍';
    searchBtn.title = 'Найти блюдо в каталоге Sanity';
    searchBtn.style.cssText = 'padding:7px 10px;border:1px solid var(--smt-accent);background:var(--smt-bg-panel);color:var(--smt-accent);border-radius:6px;cursor:pointer;font-size:13px;flex-shrink:0;';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Убрать выбранное блюдо';
    clearBtn.style.cssText = 'padding:7px 9px;border:1px solid #e74c3c;background:var(--smt-bg-panel);color:#e74c3c;border-radius:6px;cursor:pointer;font-size:13px;flex-shrink:0;';

    chipRow.appendChild(chip);
    chipRow.appendChild(searchBtn);
    chipRow.appendChild(clearBtn);
    wrap.appendChild(chipRow);

    const searchPanel = document.createElement('div');
    searchPanel.style.cssText = 'display:none;margin-top:6px;border:1px solid var(--smt-border);border-radius:6px;padding:8px;background:var(--smt-bg-subtle);';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Поиск блюда по названию...';
    searchInput.style.cssText = 'width:100%;padding:7px 9px;border:1px solid var(--smt-border);border-radius:6px;font-size:13px;box-sizing:border-box;font-family:inherit;background:var(--smt-bg-panel);color:var(--smt-text-primary);';
    const resultsList = document.createElement('div');
    resultsList.style.cssText = 'max-height:220px;overflow-y:auto;margin-top:6px;';
    searchPanel.appendChild(searchInput);
    searchPanel.appendChild(resultsList);
    wrap.appendChild(searchPanel);

    function render() {
      const ref = wrap.dataset.productRef;
      const title = wrap.dataset.productTitle;
      if (ref) {
        chip.textContent = title || ref;
        chip.style.color = 'var(--smt-text-primary)';
        clearBtn.style.display = '';
      } else {
        chip.textContent = 'Блюдо не выбрано';
        chip.style.color = 'var(--smt-text-tertiary)';
        clearBtn.style.display = 'none';
      }
    }
    render();

    function setSelection(id, title) {
      wrap.dataset.productRef = id || '';
      wrap.dataset.productTitle = title || '';
      render();
    }

    searchBtn.addEventListener('click', () => {
      const opening = searchPanel.style.display !== 'block';
      searchPanel.style.display = opening ? 'block' : 'none';
      if (opening) { searchInput.value = ''; resultsList.innerHTML = ''; searchInput.focus(); }
    });
    clearBtn.addEventListener('click', () => setSelection('', ''));

    let debTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debTimer);
      const term = searchInput.value.trim();
      if (!term) { resultsList.innerHTML = ''; return; }
      debTimer = setTimeout(async () => {
        resultsList.innerHTML = '<div style="padding:6px;color:var(--smt-text-tertiary);font-size:12px;">Ищем...</div>';
        try {
          const items = await searchMeals(projectId, term);
          resultsList.innerHTML = '';
          if (!items.length) {
            resultsList.innerHTML = '<div style="padding:6px;color:var(--smt-text-tertiary);font-size:12px;">Ничего не найдено</div>';
            return;
          }
          items.forEach(m => {
            const row = document.createElement('div');
            row.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:4px;font-size:13px;color:var(--smt-text-primary);';
            let text = m.title + (m.status === false ? ' (отключено)' : '');
            if (m.code) text += ' — ' + m.code;
            row.textContent = text;
            row.addEventListener('mouseenter', () => { row.style.background = 'var(--smt-accent-soft-bg)'; });
            row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
            row.addEventListener('click', () => {
              setSelection(m._id, m.title);
              searchPanel.style.display = 'none';
            });
            resultsList.appendChild(row);
          });
        } catch (e) {
          resultsList.innerHTML = '<div style="padding:6px;color:#e74c3c;font-size:12px;">Ошибка поиска: ' + e.message + '</div>';
        }
      }, 300);
    });

    return wrap;
  }

  function buildGradationEditor(rows, dynamicCalc, defaultCompType, projectId, mealNameMap) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:6px;';
    const table = document.createElement('div');
    table.setAttribute('data-sz-grad-table', '1');
    table.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

    function renderCompTypeSelect(rawValue) {
      const known = [
        { key: '0', raw: 'percent', label: 'В процентах' },
        { key: '1', raw: 'currency', label: 'В валюте' }
      ];
      const rawMap = { '': null };
      let optionsHtml = '<option value="">- тип -</option>';
      let matchedKey = '';
      for (const opt of known) {
        rawMap[opt.key] = opt.raw;
        const isMatch = rawValue !== undefined && rawValue !== null && String(rawValue) === String(opt.raw);
        if (isMatch) matchedKey = opt.key;
        optionsHtml += '<option value="' + opt.key + '"' + (isMatch ? ' selected' : '') + '>' + opt.label + '</option>';
      }
      if (rawValue !== undefined && rawValue !== null && !matchedKey) {
        rawMap['unknown'] = rawValue;
        optionsHtml += '<option value="unknown" selected>⚠ текущее значение (' + JSON.stringify(rawValue) + ')</option>';
        matchedKey = 'unknown';
      }
      const encodedMap = JSON.stringify(rawMap).replace(/"/g, '&quot;');
      return '<select style="padding:8px 10px;border:1px solid var(--smt-border);border-radius:6px;font-size:16px;font-family:inherit;background:var(--smt-bg-panel);color:var(--smt-text-primary);" ' +
        'data-sz-grad-comp-type data-sz-raw-map="' + encodedMap + '">' + optionsHtml + '</select>';
    }

    function addRow(basketPriceTo, price, compType, compValue, productRef, productTitle) {
      basketPriceTo = basketPriceTo ?? '';
      price = price ?? '';
      compValue = compValue ?? '';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:8px; border:1px solid var(--smt-border-soft); border-radius:8px; background:var(--smt-bg-panel);';
      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex; gap:10px; align-items:center; flex-wrap:wrap;';
      const inputStyle = 'padding:8px 10px;border:1px solid var(--smt-border);border-radius:6px;font-size:16px;font-family:inherit;background:var(--smt-bg-panel);color:var(--smt-text-primary);';
      if (dynamicCalc) {
        topRow.innerHTML =
          '<span style="font-size:14px;color:var(--smt-text-tertiary);white-space:nowrap;">до &#8381;</span>' +
          '<input type="number" placeholder="сумма корзины" value="' + basketPriceTo + '" ' +
            'style="width:130px;' + inputStyle + '" data-sz-grad-to>' +
          '<span style="font-size:14px;color:var(--smt-text-tertiary);">&rarr;</span>' +
          renderCompTypeSelect(compType) +
          '<input type="number" placeholder="значение" value="' + compValue + '" ' +
            'style="width:110px;' + inputStyle + '" data-sz-grad-comp-value>' +
          '<button type="button" style="padding:6px 12px;border:none;background:#e74c3c;color:#fff;border-radius:6px;cursor:pointer;font-size:15px;" data-sz-grad-del>&#10005;</button>';
      } else {
        topRow.innerHTML =
          '<span style="font-size:14px;color:var(--smt-text-tertiary);white-space:nowrap;">до &#8381;</span>' +
          '<input type="number" placeholder="сумма корзины" value="' + basketPriceTo + '" ' +
            'style="width:130px;' + inputStyle + '" data-sz-grad-to>' +
          '<span style="font-size:14px;color:var(--smt-text-tertiary);">&rarr; &#8381;</span>' +
          '<input type="number" placeholder="цена" value="' + price + '" ' +
            'style="width:110px;' + inputStyle + '" data-sz-grad-price>' +
          '<button type="button" style="padding:6px 12px;border:none;background:#e74c3c;color:#fff;border-radius:6px;cursor:pointer;font-size:15px;" data-sz-grad-del>&#10005;</button>';
      }
      topRow.querySelector('[data-sz-grad-del]').addEventListener('click', () => row.remove());
      row.appendChild(topRow);

      const productPicker = buildProductPicker(projectId, { currentRef: productRef, currentTitle: productTitle });
      productPicker.setAttribute('data-sz-grad-product-picker', '1');
      row.appendChild(productPicker);

      table.appendChild(row);
    }

    for (const r of rows) {
      const rowCompType = (r.compensation?.compensationType ?? defaultCompType);
      const productRef = r.deliveryProduct?._ref || '';
      const productTitle = productRef ? (mealNameMap?.[productRef] || productRef) : '';
      addRow(r.basketPriceTo, r.price, rowCompType, r.compensation?.compensationValue, productRef, productTitle);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ Добавить ступень';
    addBtn.style.cssText = 'margin-top:8px;padding:8px 14px;border:1px dashed var(--smt-accent);background:transparent;color:var(--smt-accent);border-radius:6px;cursor:pointer;font-size:14px;';
    addBtn.addEventListener('click', () => addRow(undefined, undefined, defaultCompType, undefined, '', ''));

    wrap.appendChild(table);
    wrap.appendChild(addBtn);
    return wrap;
  }

  function readGradation(container, dynamicCalc) {
    const rows = container.querySelectorAll('[data-sz-grad-table] > div');
    const result = [];
    for (const row of rows) {
      const to = parseFloat(row.querySelector('[data-sz-grad-to]')?.value);
      if (isNaN(to)) continue;
      const productRef = row.querySelector('[data-sz-grad-product-picker]')?.dataset.productRef || '';
      const deliveryProduct = productRef ? { _type: 'reference', _weak: true, _ref: productRef } : undefined;
      if (dynamicCalc) {
        const typeEl  = row.querySelector('[data-sz-grad-comp-type]');
        const valueEl = row.querySelector('[data-sz-grad-comp-value]');
        const selectedKey = typeEl ? typeEl.value : '';
        const value = parseFloat(valueEl?.value);
        if (selectedKey === '' || isNaN(value)) continue;
        let rawMap = {};
        try { rawMap = JSON.parse(typeEl.getAttribute('data-sz-raw-map') || '{}'); } catch (e) { /* ignore */ }
        const compensationType = rawMap[selectedKey];
        const item = {
          _key: newKey(),
          _type: 'deliveryPrice',
          basketPriceTo: to,
          compensation: { _type: 'compensation', compensationType, compensationValue: value }
        };
        if (deliveryProduct) item.deliveryProduct = deliveryProduct;
        result.push(item);
      } else {
        const price = parseFloat(row.querySelector('[data-sz-grad-price]')?.value);
        if (!isNaN(price)) {
          const item = { _key: newKey(), _type: 'deliveryPrice', basketPriceTo: to, price };
          if (deliveryProduct) item.deliveryProduct = deliveryProduct;
          result.push(item);
        }
      }
    }
    return result;
  }

  // Проверяет перед применением, что для каждой платной (!= 0) цены — что цены по
  // умолчанию, что ступени градации — выбрано блюдо из каталога ("Позиция для
  // доставки из POS-системы"). Sanity требует это для платной доставки, поэтому
  // блокируем применение целиком, если что-то пропущено, вместо того чтобы уйти
  // в Studio с ошибкой валидации уже после отправки.
  function collectMissingProductWarnings(modal, allTypeNames) {
    const missing = [];
    for (const typeName of allTypeNames) {
      const section = modal.querySelector(`[data-sz-section="${typeName}"]`);
      if (!section) continue;
      const dynamicCalc    = section.getAttribute('data-sz-dynamic-calc') === '1';
      const priceFieldName = section.getAttribute('data-sz-price-field') || 'defaultDeliveryPrice';

      const priceIncludeCb = section.querySelector(`[data-sz-include="${priceFieldName}"]`);
      if (priceIncludeCb?.checked) {
        const val = parseFloat(section.querySelector(`[data-sz-field="${priceFieldName}"]`)?.value);
        const ref = section.querySelector('[data-sz-default-product-picker]')?.dataset.productRef || '';
        if (!isNaN(val) && val > 0 && !ref) {
          missing.push(`${typeName} — «Цена по умолчанию» ${val}₽: не выбрано блюдо из каталога`);
        }
      }

      const includeGrad = section.querySelector('[data-sz-include-grad]')?.checked === true;
      if (includeGrad) {
        const rows = section.querySelectorAll('[data-sz-grad-table] > div');
        for (const row of rows) {
          const to = parseFloat(row.querySelector('[data-sz-grad-to]')?.value);
          if (isNaN(to)) continue;
          const val = dynamicCalc
            ? parseFloat(row.querySelector('[data-sz-grad-comp-value]')?.value)
            : parseFloat(row.querySelector('[data-sz-grad-price]')?.value);
          const ref = row.querySelector('[data-sz-grad-product-picker]')?.dataset.productRef || '';
          if (!isNaN(val) && val > 0 && !ref) {
            missing.push(`${typeName} — ступень до ${to}₽ (значение ${val}): не выбрано блюдо из каталога`);
          }
        }
      }
    }
    return missing;
  }

  // Переиспользуемое дерево «ресторан → зоны» с поиском, разворачиванием и
  // чекбоксами — общий пикер целей/источника для всех вкладок хаба. Раньше
  // этот код жил только внутри массового применения условий; теперь на нём
  // держится выбор ресторана(ов) вообще везде, так как модалка больше не
  // привязана к уже открытой странице ресторана.
  // opts:
  //   preselected: { shopId: [zoneKey, ...] } — что отметить и раскрыть сразу после загрузки
  //   allowSelectAllGlobal: показывать ли опасный чекбокс «применить ко всем зонам во всех ресторанах»
  //   shopLevelOnly: без уровня зон вообще — просто список ресторанов с чекбоксами;
  //     getSelection() тогда возвращает { shopId: true } (для операций, которые не
  //     затрагивают существующие зоны выборочно, например копирование — оно всегда
  //     добавляет новые зоны в ресторан целиком, выбор конкретных зон там бессмыслен)
  //   showDeliveryTypes: рисовать под зоной (если способов получения больше одного)
  //     чекбоксы по каждому способу получения; getSelection() тогда возвращает
  //     { shopId: { zoneKey: null | [dtpKey, ...] } } вместо плоского { shopId: [zoneKey, ...] }
  //   singleSelect: зоны — радиокнопки с общим именем на всё дерево (сразу
  //     во всех ресторанах), можно отметить не больше одной зоны за раз, без
  //     чекбокса «выбрать все зоны ресторана» (для источника значений в
  //     «Условиях» — там из нескольких отмеченных зон реально читалась бы
  //     только первая, что вводило в заблуждение; см. обсуждение)
  //   onChange: вызывается при любом изменении выбора
  function buildShopZoneTree(projectId, opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.setAttribute('data-sz-shop-tree', '1');
    const radioGroupName = 'sz-tree-radio-' + Math.random().toString(36).slice(2);

    let selectAllGlobalCb = null;
    if (opts.allowSelectAllGlobal) {
      const globalWrap = document.createElement('label');
      globalWrap.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:14px;color:var(--smt-warning-text);cursor:pointer;font-weight:600;background:var(--smt-warning-bg);border:1px solid var(--smt-warning-border);border-radius:6px;padding:8px 12px;margin-bottom:12px;';
      globalWrap.innerHTML = '<input type="checkbox" data-sz-select-all-global style="width:17px;height:17px;accent-color:#e67e22;cursor:pointer;"> 🌍 Применить ко всем зонам во всех ресторанах (кроме архивных)';
      wrap.appendChild(globalWrap);
      selectAllGlobalCb = globalWrap.querySelector('[data-sz-select-all-global]');
    }

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'sz-flat-btn';
    loadBtn.textContent = '🔄 Загрузить список ресторанов и зон';
    loadBtn.style.cssText = 'padding:10px 14px;width:auto;height:auto;font-size:13px;font-weight:600;border-color:var(--smt-accent);color:var(--smt-accent);';
    wrap.appendChild(loadBtn);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:13px;color:var(--smt-text-tertiary);margin-top:8px;';
    hint.textContent = opts.hint || 'У каждого ресторана могут быть зоны с разными названиями — раскройте ресторан (клик по стрелке ▸) и отметьте галочками нужные зоны. Рестораны без зон показаны в конце списка.';
    wrap.appendChild(hint);

    const container = document.createElement('div');
    container.style.cssText = 'display:none; margin-top:12px;';
    wrap.appendChild(container);

    let lastLoadedShops = null;

    function renderTree(shops) {
      container.innerHTML = '';
      if (shops.length === 0) {
        container.innerHTML = '<div style="color:var(--smt-text-tertiary);">Рестораны не найдены</div>';
        return;
      }
      const searchBox = document.createElement('input');
      searchBox.type = 'text';
      searchBox.placeholder = 'Поиск по названию или адресу...';
      searchBox.style.cssText = 'width:100%; padding:8px; margin-bottom:10px; border:1px solid var(--smt-border); border-radius:6px; box-sizing:border-box; font-family:inherit; background:var(--smt-bg-panel); color:var(--smt-text-primary);';
      container.appendChild(searchBox);

      // Разворачивать без уровня зон нечего — ссылка была бы рабочей, но
      // бессмысленной (нечего показывать), поэтому её не рисуем при
      // shopLevelOnly. "Выбрать все рестораны", наоборот, не рисуем только при
      // singleSelect — там на всё дерево разрешена ровно одна зона, "выбрать
      // все" там физически невозможно.
      const showExpandCollapse = !opts.shopLevelOnly;
      const showSelectAll = !opts.singleSelect;
      let globalActions = null;
      if (showExpandCollapse || showSelectAll) {
        globalActions = document.createElement('div');
        globalActions.style.cssText = 'display:flex; gap:14px; margin-bottom:8px; font-size:13px; flex-wrap:wrap;';
        globalActions.innerHTML =
          (showSelectAll ? `
            <a href="#" data-sz-select-all style="color:var(--smt-accent); text-decoration:none;">Выбрать все рестораны</a>
            <a href="#" data-sz-deselect-all style="color:var(--smt-accent); text-decoration:none;">Снять выбор</a>
          ` : '') +
          (showExpandCollapse ? `
            <a href="#" data-sz-expand-all style="color:var(--smt-accent); text-decoration:none;">Развернуть все</a>
            <a href="#" data-sz-collapse-all style="color:var(--smt-accent); text-decoration:none;">Свернуть все</a>
          ` : '');
        container.appendChild(globalActions);
      }

      const shopsList = document.createElement('div');
      shopsList.className = 'smt-shop-tree';

      for (const shop of shops) {
        const zones = shop.zones || [];
        const preselectedKeys = (opts.preselected && opts.preselected[shop._id]) || [];
        const addressStr = `${shop.address?.street?.ru || ''} ${shop.address?.house?.ru || ''}`.trim();
        const shopDetails = document.createElement('details');
        shopDetails.className = 'smt-shop-block';
        shopDetails.setAttribute('data-sz-shop-block', shop._id);
        // Ищем и по названию, и по адресу — у многих сетей все точки называются
        // одинаково («FRENCH BAKERY SeDelice ×20»), различаются только адресом,
        // без него найти нужную в списке практически невозможно.
        shopDetails.dataset.shopName = `${shop.name?.ru || ''} ${addressStr}`.toLowerCase();
        if (preselectedKeys.length > 0 || shop._id === opts.autoExpandShopId) shopDetails.open = true;

        const summary = document.createElement('summary');

        const isExpandable = !opts.shopLevelOnly && zones.length > 0;
        const chevron = document.createElement('span');
        chevron.textContent = isExpandable ? '▸' : '';
        chevron.title = isExpandable ? 'Развернуть/свернуть зоны' : '';
        chevron.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; width:18px; flex-shrink:0; color:var(--smt-text-secondary); font-size:18px; font-weight:700; transition:transform 0.15s ease;' + (shopDetails.open ? ' transform:rotate(90deg);' : '');

        // При singleSelect чекбокса «выбрать все зоны ресторана» нет вообще —
        // он бы позволял отметить сразу несколько зон одного ресторана, а
        // singleSelect как раз про то, что во всём дереве может быть отмечена
        // только одна зона (см. комментарий у opts выше).
        let shopAllCb = null;
        if (!opts.singleSelect) {
          shopAllCb = document.createElement('input');
          shopAllCb.type = 'checkbox';
          shopAllCb.setAttribute('data-sz-shop-all', shop._id);
          shopAllCb.style.cssText = 'width:16px;height:16px;cursor:pointer;flex-shrink:0;accent-color:var(--smt-accent);';
          if (opts.shopLevelOnly) {
            // Нет уровня зон вообще — выбор всегда «ресторан целиком» (копирование
            // добавляет новые зоны, а не трогает существующие, поэтому неважно,
            // сколько зон уже есть — хоть ноль).
            shopAllCb.setAttribute('data-sz-shop-select', shop._id);
            shopAllCb.disabled = false;
            shopAllCb.addEventListener('change', () => { if (opts.onChange) opts.onChange(); });
          } else {
            shopAllCb.disabled = zones.length === 0;
          }
          shopAllCb.addEventListener('click', e => e.stopPropagation());
        }

        const labelSpan = document.createElement('span');
        labelSpan.textContent = `${shop.name?.ru || shop._id}${addressStr ? ' (' + addressStr + ')' : ''} — ${zones.length} ${zones.length === 1 ? 'зона' : 'зон'}`;
        labelSpan.style.cssText = (zones.length === 0 && !opts.shopLevelOnly) ? 'color:var(--smt-text-tertiary);' : '';

        summary.appendChild(chevron);
        if (shopAllCb) summary.appendChild(shopAllCb);
        summary.appendChild(labelSpan);
        shopDetails.appendChild(summary);

        // Клик по любому месту строки (не только по самому чекбоксу) отмечает
        // ресторан — раскрытие/сворачивание зон переехало на отдельную стрелку
        // ▸, чтобы эти два действия не мешали друг другу на одном клике.
        if (shopAllCb) {
          summary.addEventListener('click', e => {
            if (shopAllCb.disabled) return;
            e.preventDefault();
            shopAllCb.checked = !shopAllCb.checked;
            shopAllCb.dispatchEvent(new Event('change'));
          });
        }

        if (isExpandable) {
          chevron.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            shopDetails.open = !shopDetails.open;
          });
          shopDetails.addEventListener('toggle', () => {
            chevron.style.transform = shopDetails.open ? 'rotate(90deg)' : 'rotate(0deg)';
          });
          const zonesWrap = document.createElement('div');
          zonesWrap.style.cssText = 'margin-top:8px; padding-left:26px; display:flex; flex-direction:column; gap:5px;';

          for (const zone of zones) {
            // Третий уровень — способы получения внутри зоны (у каждого свой
            // paymentTypes, поэтому «Способы оплаты» должна уметь целиться не
            // только в зону целиком, но и в конкретный способ получения).
            // Нужен только там, где явно запрошен (opts.showDeliveryTypes).
            // Показываем список всегда, если он не пуст (даже один способ) —
            // иначе непонятно, есть там вообще способы получения или нет —
            // но сворачиваем в <details>, чтобы не раздувать список зон,
            // когда способ всего один и сужать выбор обычно незачем.
            const types = zone.types || [];
            const zoneIsPreselected = preselectedKeys.includes(zone._key);

            if (opts.showDeliveryTypes && types.length > 0) {
              const zoneDetails = document.createElement('details');
              zoneDetails.style.cssText = 'margin-bottom:2px;';
              zoneDetails.open = zoneIsPreselected;

              const zSummary = document.createElement('summary');
              zSummary.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer; list-style:none;';

              const zChevron = document.createElement('span');
              zChevron.textContent = '▸';
              zChevron.title = 'Показать способы получения в этой зоне';
              zChevron.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; width:14px; flex-shrink:0; color:var(--smt-text-tertiary); font-size:14px; font-weight:700; transition:transform 0.15s ease;' + (zoneDetails.open ? ' transform:rotate(90deg);' : '');

              const zCb = document.createElement('input');
              zCb.type = 'checkbox';
              zCb.setAttribute('data-sz-shop-id', shop._id);
              zCb.setAttribute('data-sz-zone-key', zone._key);
              zCb.checked = zoneIsPreselected;
              zCb.style.cssText = 'width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:var(--smt-accent);';
              zCb.addEventListener('click', e => e.stopPropagation());

              const zSpan = document.createElement('span');
              zSpan.style.cssText = 'font-size:14px; color:var(--smt-text-primary);';
              zSpan.textContent = zone.name || '(без названия)';

              zSummary.appendChild(zChevron);
              zSummary.appendChild(zCb);
              zSummary.appendChild(zSpan);
              zoneDetails.appendChild(zSummary);

              // Тот же приём, что и у строки ресторана выше: клик по строке
              // отмечает зону, раскрытие способов получения — только по стрелке.
              zChevron.addEventListener('click', e => {
                e.stopPropagation();
                e.preventDefault();
                zoneDetails.open = !zoneDetails.open;
              });
              zSummary.addEventListener('click', e => {
                e.preventDefault();
                zCb.checked = !zCb.checked;
                zCb.dispatchEvent(new Event('change'));
              });
              zoneDetails.addEventListener('toggle', () => {
                zChevron.style.transform = zoneDetails.open ? 'rotate(90deg)' : 'rotate(0deg)';
              });

              const typesWrap = document.createElement('div');
              typesWrap.style.cssText = 'margin-top:4px; margin-bottom:4px; padding-left:22px; display:flex; flex-direction:column; gap:3px;';
              for (const t of types) {
                const tLabel = document.createElement('label');
                tLabel.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:13px; color:var(--smt-text-secondary); cursor:pointer;';
                const tCb = document.createElement('input');
                tCb.type = 'checkbox';
                tCb.checked = zCb.checked;
                tCb.setAttribute('data-sz-shop-id', shop._id);
                tCb.setAttribute('data-sz-for-zone-key', zone._key);
                tCb.setAttribute('data-sz-type-key', t._key);
                tCb.style.cssText = 'width:13px;height:13px;cursor:pointer;flex-shrink:0;accent-color:var(--smt-accent);';
                const tSpan = document.createElement('span');
                tSpan.textContent = t.name || '(без названия)';
                tLabel.appendChild(tCb);
                tLabel.appendChild(tSpan);
                typesWrap.appendChild(tLabel);
              }
              zoneDetails.appendChild(typesWrap);
              zonesWrap.appendChild(zoneDetails);

              // Каскад зона ↔ её способы получения — тот же паттерн, что
              // ресторан ↔ зоны выше, на один уровень глубже.
              zCb.addEventListener('change', () => {
                typesWrap.querySelectorAll('input[data-sz-type-key]').forEach(cb => { cb.checked = zCb.checked; });
              });
              typesWrap.addEventListener('change', () => {
                const allTypes     = typesWrap.querySelectorAll('input[data-sz-type-key]');
                const checkedTypes = typesWrap.querySelectorAll('input[data-sz-type-key]:checked');
                zCb.checked       = checkedTypes.length > 0;
                zCb.indeterminate = checkedTypes.length > 0 && checkedTypes.length < allTypes.length;
              });
            } else {
              const zLabel = document.createElement('label');
              zLabel.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:14px; color:var(--smt-text-primary); cursor:pointer;';
              const zCb = document.createElement('input');
              zCb.type = opts.singleSelect ? 'radio' : 'checkbox';
              if (opts.singleSelect) zCb.name = radioGroupName;
              zCb.setAttribute('data-sz-shop-id', shop._id);
              zCb.setAttribute('data-sz-zone-key', zone._key);
              zCb.checked = zoneIsPreselected;
              zCb.style.cssText = 'width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:var(--smt-accent);';
              if (opts.singleSelect) zCb.addEventListener('change', () => { if (opts.onChange) opts.onChange(); });
              const zSpan = document.createElement('span');
              zSpan.textContent = zone.name || '(без названия)';
              zLabel.appendChild(zCb);
              zLabel.appendChild(zSpan);
              zonesWrap.appendChild(zLabel);
            }
          }

          if (shopAllCb) {
            shopAllCb.addEventListener('change', () => {
              // Прямое присваивание .checked не триггерит 'change' у самих зон,
              // поэтому каскад зона→способы получения (см. выше) сам не сработает —
              // синхронизируем оба уровня явно здесь же.
              zonesWrap.querySelectorAll('input[data-sz-zone-key]').forEach(cb => { cb.checked = shopAllCb.checked; cb.indeterminate = false; });
              zonesWrap.querySelectorAll('input[data-sz-type-key]').forEach(cb => { cb.checked = shopAllCb.checked; });
              if (opts.onChange) opts.onChange();
            });
            zonesWrap.addEventListener('change', () => {
              const all     = zonesWrap.querySelectorAll('input[data-sz-zone-key]');
              const checked = zonesWrap.querySelectorAll('input[data-sz-zone-key]:checked');
              shopAllCb.checked       = all.length > 0 && checked.length === all.length;
              shopAllCb.indeterminate = checked.length > 0 && checked.length < all.length;
              if (opts.onChange) opts.onChange();
            });
            zonesWrap.dispatchEvent(new Event('change'));
          }

          shopDetails.appendChild(zonesWrap);
        }

        shopsList.appendChild(shopDetails);
      }

      container.appendChild(shopsList);

      searchBox.addEventListener('input', () => {
        const term = searchBox.value.toLowerCase();
        shopsList.querySelectorAll('details[data-sz-shop-block]').forEach(d => {
          d.style.display = (d.dataset.shopName || '').includes(term) ? '' : 'none';
        });
      });
      if (globalActions) {
        const expandAllLink   = globalActions.querySelector('[data-sz-expand-all]');
        const collapseAllLink = globalActions.querySelector('[data-sz-collapse-all]');
        if (expandAllLink) expandAllLink.addEventListener('click', e => {
          e.preventDefault();
          shopsList.querySelectorAll('details[data-sz-shop-block]').forEach(d => { d.open = true; });
        });
        if (collapseAllLink) collapseAllLink.addEventListener('click', e => {
          e.preventDefault();
          shopsList.querySelectorAll('details[data-sz-shop-block]').forEach(d => { d.open = false; });
        });

        // Затрагивает только рестораны, видимые сейчас (после поиска) — иначе
        // «выбрать все» незаметно отметило бы и то, что скрыто фильтром.
        function setAllVisibleShopsChecked(checked) {
          shopsList.querySelectorAll('details[data-sz-shop-block]').forEach(d => {
            if (d.style.display === 'none') return;
            const cb = d.querySelector('input[data-sz-shop-all]');
            if (!cb || cb.disabled || cb.checked === checked) return;
            cb.checked = checked;
            cb.dispatchEvent(new Event('change'));
          });
        }
        const selectAllLink   = globalActions.querySelector('[data-sz-select-all]');
        const deselectAllLink = globalActions.querySelector('[data-sz-deselect-all]');
        if (selectAllLink) selectAllLink.addEventListener('click', e => { e.preventDefault(); setAllVisibleShopsChecked(true); });
        if (deselectAllLink) deselectAllLink.addEventListener('click', e => { e.preventDefault(); setAllVisibleShopsChecked(false); });
      }
    }

    async function load() {
      loadBtn.textContent = '⏳ Загрузка...';
      loadBtn.disabled = true;
      try {
        const shops = await fetchAllShops(projectId);
        shops.sort((a, b) => {
          const aEmpty = (a.zones || []).length === 0;
          const bEmpty = (b.zones || []).length === 0;
          if (aEmpty === bEmpty) return 0;
          return aEmpty ? 1 : -1;
        });
        lastLoadedShops = shops;
        renderTree(shops);
        container.style.display = 'block';
        if (selectAllGlobalCb?.checked) {
          container.style.opacity = '0.4';
          container.style.pointerEvents = 'none';
        }
      } catch (e) {
        showToast('Ошибка загрузки списка: ' + e.message, 'error');
      } finally {
        loadBtn.textContent = '🔄 Обновить список ресторанов и зон';
        loadBtn.disabled = false;
      }
    }

    if (selectAllGlobalCb) {
      selectAllGlobalCb.addEventListener('change', () => {
        if (selectAllGlobalCb.checked) {
          if (!lastLoadedShops) load();
          container.style.opacity = '0.4';
          container.style.pointerEvents = 'none';
        } else {
          container.style.opacity = '1';
          container.style.pointerEvents = 'auto';
        }
        if (opts.onChange) opts.onChange();
      });
    }

    // Без opts.showDeliveryTypes возвращает { shopId: [zoneKey, ...] } — как
    // раньше, для вкладок «Условия» и «Копирование зон», которым способы
    // получения ни к чему. С opts.showDeliveryTypes (вкладка «Способы оплаты»)
    // возвращает { shopId: { zoneKey: null | [dtpKey, ...] } }, где null —
    // «вся зона целиком» (способы получения не сужены, либо их там всего
    // один, либо это выбор-всё через глобальный чекбокс), а массив —
    // «только эти способы получения внутри зоны».
    function getSelection() {
      if (selectAllGlobalCb?.checked) {
        const map = {};
        for (const shop of (lastLoadedShops || [])) {
          const zones = shop.zones || [];
          if (zones.length === 0) continue;
          if (opts.showDeliveryTypes) {
            map[shop._id] = {};
            for (const z of zones) map[shop._id][z._key] = null;
          } else {
            map[shop._id] = zones.map(z => z._key);
          }
        }
        return map;
      }

      if (opts.shopLevelOnly) {
        const map = {};
        container.querySelectorAll('input[data-sz-shop-select]:checked').forEach(cb => {
          map[cb.getAttribute('data-sz-shop-select')] = true;
        });
        return map;
      }

      if (!opts.showDeliveryTypes) {
        const map = {};
        container.querySelectorAll('input[data-sz-zone-key]:checked').forEach(cb => {
          const shopId  = cb.getAttribute('data-sz-shop-id');
          const zoneKey = cb.getAttribute('data-sz-zone-key');
          (map[shopId] ||= []).push(zoneKey);
        });
        return map;
      }

      const map = {};
      container.querySelectorAll('input[data-sz-zone-key]:checked').forEach(cb => {
        const shopId  = cb.getAttribute('data-sz-shop-id');
        const zoneKey = cb.getAttribute('data-sz-zone-key');
        const typeCbs = container.querySelectorAll(
          `input[data-sz-for-zone-key="${CSS.escape(zoneKey)}"][data-sz-shop-id="${CSS.escape(shopId)}"]`
        );
        let typeSelection = null;
        if (typeCbs.length > 0) {
          const checkedTypes = Array.from(typeCbs).filter(t => t.checked).map(t => t.getAttribute('data-sz-type-key'));
          typeSelection = checkedTypes.length < typeCbs.length ? checkedTypes : null;
        }
        (map[shopId] ||= {})[zoneKey] = typeSelection;
      });
      return map;
    }

    loadBtn.addEventListener('click', load);

    return { el: wrap, load, getSelection, getShopsData: () => lastLoadedShops || [] };
  }

  function buildDeliveryTypeSection(label, dtpData, isCollapsed, projectId, mealNameMap) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:10px;';
    const dynamicCalc  = dtpData?.dynamicCalc === true;
    const timeFieldName = dynamicCalc ? 'dynamicDeliveryTime' : 'deliveryTime';
    const priceFieldName = dynamicCalc ? 'defaultDynamicDeliveryPrice' : 'defaultDeliveryPrice';
    const existingTime = dtpData?.[timeFieldName]  ?? '';
    const existingMin  = dtpData?.minBasketPrice ?? '';
    const existingDef  = dtpData?.[priceFieldName] ?? '';
    const existingGrad = dtpData?.deliveryPrice || [];

    const content = document.createElement('div');
    content.setAttribute('data-sz-section', label);
    content.setAttribute('data-sz-dynamic-calc', dynamicCalc ? '1' : '0');
    content.setAttribute('data-sz-price-field', priceFieldName);
    content.style.cssText = 'padding:16px;background:var(--smt-bg-subtle);border-radius:8px;border:1px solid var(--smt-border);';
    content.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--smt-accent-soft-text);cursor:pointer;background:var(--smt-accent-soft-bg);border:1px solid var(--smt-accent-soft-border);border-radius:6px;padding:8px 12px;margin-bottom:14px;">
        <input type="checkbox" data-sz-select-all-fields style="width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);">
        <span>Выбрать все условия этого типа доставки</span>
      </label>
      <div style="font-size:13px;color:var(--smt-text-tertiary);margin-bottom:10px;">
        Отметьте галочкой только те условия, которые нужно скопировать/применить. Невыбранные условия останутся в каждой зоне как есть.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px;">
        <label style="font-size:14px;color:var(--smt-text-secondary);">
          <span style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <input type="checkbox" data-sz-include="${timeFieldName}" style="width:15px;height:15px;cursor:pointer;accent-color:var(--smt-accent);">
            ${dynamicCalc ? 'Время динамической доставки (мин)' : 'Время доставки (мин)'}
          </span>
          <input type="number" placeholder="значение" value="${existingTime}"
            style="display:block;width:100%;padding:9px 10px;border:1px solid var(--smt-border);border-radius:6px;font-size:16px;box-sizing:border-box;font-family:inherit;background:var(--smt-bg-panel);color:var(--smt-text-primary);"
            data-sz-field="${timeFieldName}">
        </label>
        <label style="font-size:14px;color:var(--smt-text-secondary);">
          <span style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <input type="checkbox" data-sz-include="minBasketPrice" style="width:15px;height:15px;cursor:pointer;accent-color:var(--smt-accent);">
            Мин. сумма корзины
          </span>
          <input type="number" placeholder="значение" value="${existingMin}"
            style="display:block;width:100%;padding:9px 10px;border:1px solid var(--smt-border);border-radius:6px;font-size:16px;box-sizing:border-box;font-family:inherit;background:var(--smt-bg-panel);color:var(--smt-text-primary);"
            data-sz-field="minBasketPrice">
        </label>
        <label style="font-size:14px;color:var(--smt-text-secondary);">
          <span style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <input type="checkbox" data-sz-include="${priceFieldName}" style="width:15px;height:15px;cursor:pointer;accent-color:var(--smt-accent);">
            ${dynamicCalc ? 'Цена динамической доставки по умолчанию' : 'Цена по умолчанию'}
          </span>
          <input type="number" placeholder="значение" value="${existingDef}"
            style="display:block;width:100%;padding:9px 10px;border:1px solid var(--smt-border);border-radius:6px;font-size:16px;box-sizing:border-box;font-family:inherit;background:var(--smt-bg-panel);color:var(--smt-text-primary);"
            data-sz-field="${priceFieldName}">
        </label>
      </div>
      ${dynamicCalc ? `
      <div style="font-size:13px;color:#8e44ad;background:#f4ecfb;border:1px solid #e3d3f5;border-radius:6px;padding:8px 12px;margin-bottom:12px;">
        ⚡ Активирован динамический расчёт — ступени градации задаются компенсацией (тип и значение), а не фиксированной ценой.
      </div>` : ''}
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-secondary);margin-bottom:8px;cursor:pointer;">
        <input type="checkbox" data-sz-include-grad style="width:15px;height:15px;cursor:pointer;accent-color:var(--smt-accent);">
        <span>Градация цен <span style="color:var(--smt-text-tertiary);">(пустая таблица при включённой галочке = очистить градацию)</span></span>
      </label>
    `;

    const priceInputEl = content.querySelector(`[data-sz-field="${priceFieldName}"]`);
    const priceLabelEl = priceInputEl?.closest('label');
    if (priceLabelEl) {
      const defaultProductRef   = dtpData?.deliveryProduct?._ref || '';
      const defaultProductTitle = defaultProductRef ? (mealNameMap?.[defaultProductRef] || defaultProductRef) : '';
      const defaultProductPicker = buildProductPicker(projectId, { currentRef: defaultProductRef, currentTitle: defaultProductTitle, includeCheckbox: true });
      defaultProductPicker.setAttribute('data-sz-default-product-picker', '1');
      // Не внутрь <label> цены, а отдельной строкой под ней — иначе клики по
      // пикеру переключают галочку «Цена по умолчанию».
      defaultProductPicker.style.gridColumn = '1 / -1';
      priceLabelEl.after(defaultProductPicker);
    }

    const gradWrap = document.createElement('div');
    gradWrap.setAttribute('data-sz-grad-wrap', '1');
    gradWrap.appendChild(buildGradationEditor(existingGrad, dynamicCalc, dtpData?.compensation?.compensationType, projectId, mealNameMap));
    content.appendChild(gradWrap);

    content.appendChild(buildPaymentTypesEditor(dtpData?.paymentTypes));

    const selectAllFieldsCb = content.querySelector('[data-sz-select-all-fields]');
    selectAllFieldsCb.addEventListener('change', () => {
      content.querySelectorAll('[data-sz-include], [data-sz-include-grad], [data-sz-include-payment], [data-sz-include-product]').forEach(cb => {
        cb.checked = selectAllFieldsCb.checked;
      });
    });

    if (isCollapsed) {
      const details = document.createElement('details');
      details.style.cssText = 'margin-top:14px;';
      const summary = document.createElement('summary');
      summary.style.cssText = 'cursor:pointer;font-size:16px;font-weight:600;color:var(--smt-text-secondary);user-select:none;padding:4px 0;';
      summary.textContent = label;
      details.appendChild(summary);
      details.appendChild(content);
      section.appendChild(details);
    } else {
      const titleEl = document.createElement('div');
      titleEl.style.cssText = 'font-size:16px;font-weight:700;color:var(--smt-text-primary);margin-bottom:8px;';
      titleEl.textContent = label;
      section.appendChild(titleEl);
      section.appendChild(content);
    }
    return section;
  }

  // Собирает { changes, typeMeta } из отрисованных секций buildDeliveryTypeSection
  // внутри container — то же самое, что раньше делалось инлайново в начале
  // applyConditions, вынесено отдельно, чтобы использовать и до открытия
  // подтверждения (для проверки "нет изменений"), и в самом применении.
  function collectConditionChanges(container, allTypeNames) {
    const changes  = {};
    const typeMeta = {};
    for (const typeName of allTypeNames) {
      const section = container.querySelector(`[data-sz-section="${typeName}"]`);
      if (!section) continue;
      const dynamicCalc    = section.getAttribute('data-sz-dynamic-calc') === '1';
      const priceFieldName = section.getAttribute('data-sz-price-field') || 'defaultDeliveryPrice';
      typeMeta[typeName] = { dynamicCalc, priceFieldName };

      const entry = {};
      section.querySelectorAll('[data-sz-field]').forEach(input => {
        const fieldName = input.getAttribute('data-sz-field');
        const includeCb = section.querySelector(`[data-sz-include="${fieldName}"]`);
        if (!includeCb?.checked) return;
        const val = input.value.trim();
        entry[fieldName] = val === '' ? undefined : parseFloat(val);
      });
      for (const key of Object.keys(entry)) {
        if (entry[key] === undefined || isNaN(entry[key])) delete entry[key];
      }

      const priceIncludeCb   = section.querySelector(`[data-sz-include="${priceFieldName}"]`);
      const productIncludeCb = section.querySelector('[data-sz-include-product]');
      if (priceIncludeCb?.checked || productIncludeCb?.checked) {
        const productRef = section.querySelector('[data-sz-default-product-picker]')?.dataset.productRef || '';
        entry.deliveryProduct = productRef ? { _type: 'reference', _weak: true, _ref: productRef } : null;
      }

      const includeGrad = section.querySelector('[data-sz-include-grad]')?.checked === true;
      if (includeGrad) {
        const gradWrap = section.querySelector('[data-sz-grad-wrap]');
        if (gradWrap) entry.deliveryPrice = readGradation(gradWrap, dynamicCalc);
      }

      const includePayment = section.querySelector('[data-sz-include-payment]')?.checked === true;
      if (includePayment) {
        const paymentTypes = readPaymentTypes(section);
        if (paymentTypes) entry.paymentTypes = paymentTypes;
      }

      if (Object.keys(entry).length > 0) changes[typeName] = entry;
    }
    return { changes, typeMeta };
  }

  // Общий низ модалки для всех трёх вкладок хаба: бэкап/публикация/предполётная
  // проверка + баннер риска, который сам показывается, когда выбрано больше
  // одного ресторана (opts.getShopCount) — раньше это был отдельный чекбокс
  // «применить к нескольким ресторанам», теперь риск считается по факту выбора
  // в дереве, а не по галочке, которую легко забыть поставить/снять.
  function buildApplyOptionsFooter(opts) {
    const wrap = document.createElement('div');

    const dangerBanner = document.createElement('div');
    dangerBanner.style.cssText = 'margin-top:14px; padding:12px 16px; background:#fef2f2; border:2px solid #f3b6b6; border-radius:8px; font-size:13px; color:#a13a34; display:none;';
    dangerBanner.innerHTML = '⚠️ <b>Выбрано несколько ресторанов — будь внимателен!</b><br>Эту операцию не откатить одним кликом — восстановление из бэкапа придётся делать вручную. Дважды проверьте выбор перед тем, как жать «Применить».';
    wrap.appendChild(dangerBanner);

    const backupWrap = document.createElement('label');
    backupWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-secondary);margin-top:14px;cursor:pointer;';
    backupWrap.innerHTML = `
      <input type="checkbox" checked style="width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);" data-sz-backup-before>
      <span>Скачать бэкап зон в JSON перед применением <span style="color:var(--smt-text-tertiary);">(снимок состояния затронутых зон до изменений — пригодится для отката вручную)</span></span>
    `;
    wrap.appendChild(backupWrap);

    const publishWrap = document.createElement('label');
    publishWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-secondary);margin-top:14px;cursor:pointer;';
    publishWrap.innerHTML = `
      <input type="checkbox" style="width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);" data-sz-auto-publish>
      <span>Опубликовать сразу после применения <span style="color:var(--smt-text-tertiary);">(иначе изменения останутся черновиком. Скрипт запоминает свои же правки — если черновик с прошлого раза никто, кроме скрипта, не трогал, публикация пройдёт автоматически; если в нём есть посторонние изменения — она пропускается)</span></span>
    `;
    wrap.appendChild(publishWrap);

    const forcePublishWrap = document.createElement('label');
    forcePublishWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:#a15c00;margin-top:8px;margin-left:26px;cursor:pointer;';
    forcePublishWrap.innerHTML = `
      <input type="checkbox" style="width:15px;height:15px;cursor:pointer;" data-sz-force-publish>
      <span>🔓 Разрешить публикацию, даже если в ресторане есть посторонние неопубликованные изменения <span style="color:#c98a3a;">(они тоже уйдут в публикацию вместе с вашими — используйте, только если уверены, что ничего чужого не потеряется)</span></span>
    `;
    wrap.appendChild(forcePublishWrap);

    const preflightWrap = document.createElement('label');
    preflightWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--smt-text-secondary);margin-top:8px;margin-left:26px;cursor:pointer;';
    preflightWrap.innerHTML = `
      <input type="checkbox" checked style="width:15px;height:15px;cursor:pointer;accent-color:var(--smt-accent);" data-sz-preflight-validation>
      <span>🛡️ Перед публикацией проверить валидацию во всех выбранных ресторанах <span style="color:var(--smt-text-tertiary);">(медленнее — скрипт по очереди открывает каждый ресторан, ~1–2 сек на ресторан. Если хотя бы у одного не заполнены обязательные поля — публикация блокируется целиком)</span></span>
    `;
    wrap.appendChild(preflightWrap);

    const reloadWrap = document.createElement('label');
    reloadWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-secondary);margin-top:14px;cursor:pointer;';
    reloadWrap.innerHTML = `
      <input type="checkbox" style="width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);" data-sz-reload-after>
      <span>Обновить страницу после применения <span style="color:var(--smt-text-tertiary);">(список «Все заведения» иногда не пересчитывает порядок сам)</span></span>
    `;
    wrap.appendChild(reloadWrap);

    const applyBtn = document.createElement('button');
    applyBtn.textContent = opts.applyLabel || '✅ Применить';
    applyBtn.style.cssText = `
      margin-top:14px;width:100%;padding:15px;
      background:var(--smt-accent);color:#fff;border:none;border-radius:8px;
      font-size:16px;font-weight:700;cursor:pointer;
    `;
    applyBtn.addEventListener('mouseenter', () => { applyBtn.style.background = 'var(--smt-accent-hover)'; });
    applyBtn.addEventListener('mouseleave', () => { applyBtn.style.background = 'var(--smt-accent)'; });
    wrap.appendChild(applyBtn);

    const backupBeforeCb        = backupWrap.querySelector('[data-sz-backup-before]');
    const autoPublishCb         = publishWrap.querySelector('[data-sz-auto-publish]');
    const forcePublishCb        = forcePublishWrap.querySelector('[data-sz-force-publish]');
    const preflightValidationCb = preflightWrap.querySelector('[data-sz-preflight-validation]');
    const reloadAfterCb         = reloadWrap.querySelector('[data-sz-reload-after]');

    function syncDangerBanner() {
      const count = opts.getShopCount ? opts.getShopCount() : 0;
      dangerBanner.style.display = count > 1 ? 'block' : 'none';
    }

    applyBtn.addEventListener('click', () => {
      const shopCount = opts.getShopCount ? opts.getShopCount() : 0;
      if (shopCount === 0) {
        showToast('Ничего не выбрано — отметьте хотя бы одну зону в списке', 'warning');
        return;
      }
      if (opts.beforeApply && opts.beforeApply() === false) return;
      const state = {
        autoPublish: autoPublishCb.checked,
        forcePublish: forcePublishCb.checked,
        reloadAfter: reloadAfterCb.checked,
        backupBefore: backupBeforeCb.checked,
        preflightValidation: preflightValidationCb.checked
      };
      const proceed = () => opts.onApply(state);
      if (shopCount > 1) {
        showMassApplyConfirm(shopCount, proceed);
      } else {
        proceed();
      }
    });

    return { el: wrap, syncDangerBanner };
  }

  // Вкладка «Условия»: подставить текущие значения полей из зоны(зон)
  // ресторана-источника, отредактировать, применить к выбранным зонам —
  // в одном ресторане или сразу в нескольких (риск-баннер сам появляется,
  // когда выбрано больше одного).
  function buildConditionsTab(projectId, initialShopId, overlay) {
    const el = document.createElement('div');

    const sourceHeading = document.createElement('div');
    sourceHeading.style.cssText = 'font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-bottom:6px;';
    sourceHeading.textContent = 'Ресторан-источник (откуда взять текущие условия)';
    el.appendChild(sourceHeading);

    const sourceTree = buildShopZoneTree(projectId, {
      singleSelect: true,
      hint: 'Отметьте одну зону — её текущие условия подставятся в поля ниже (радиокнопка, а не чекбокс: у разных зон могут быть разные условия, поэтому источник всегда ровно один).',
      autoExpandShopId: initialShopId || undefined
    });
    el.appendChild(sourceTree.el);
    if (initialShopId) sourceTree.load();

    const loadSourceBtn = document.createElement('button');
    loadSourceBtn.type = 'button';
    loadSourceBtn.textContent = '⬇️ Подставить условия из отмеченной зоны';
    loadSourceBtn.style.cssText = 'margin-top:10px; padding:9px 14px; border:1px solid var(--smt-accent); background:var(--smt-accent); color:#fff; border-radius:6px; cursor:pointer; font-weight:600; font-size:13px;';
    el.appendChild(loadSourceBtn);

    const sectionsWrap = document.createElement('div');
    sectionsWrap.style.cssText = 'margin-top:20px;';
    sectionsWrap.innerHTML = '<div style="padding:16px;text-align:center;color:var(--smt-text-tertiary);font-size:14px;">Выберите зону-источник выше и нажмите «Подставить условия», чтобы увидеть поля для редактирования.</div>';
    el.appendChild(sectionsWrap);

    const targetHeading = document.createElement('div');
    targetHeading.style.cssText = 'font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-top:22px;margin-bottom:6px;display:none;';
    targetHeading.textContent = 'Куда применить';
    el.appendChild(targetHeading);

    const targetTreeOpts = { allowSelectAllGlobal: true, onChange: () => footer.syncDangerBanner() };
    const targetTree = buildShopZoneTree(projectId, targetTreeOpts);
    targetTree.el.style.display = 'none';
    el.appendChild(targetTree.el);

    let currentSourceState = null; // { allTypeNames }

    loadSourceBtn.addEventListener('click', async () => {
      const selection = sourceTree.getSelection();
      const shopIds = Object.keys(selection);
      if (shopIds.length === 0) { showToast('Сначала отметьте зону-источник в дереве выше', 'warning'); return; }
      const sourceShopId = shopIds[0];
      const zoneKeys = selection[sourceShopId];
      loadSourceBtn.textContent = '⏳ Загрузка...';
      loadSourceBtn.disabled = true;
      try {
        const doc = await getDoc(projectId, sourceShopId);
        if (!doc) { showToast('Заведение-источник не найдено', 'error'); return; }
        const allRefs = new Set();
        for (const zone of (doc.deliveryZones || []))
          for (const dtp of (zone.deliveryTypePrices || []))
            if (dtp.deliveryType?._ref) allRefs.add(dtp.deliveryType._ref);
        const typeNameMap = await resolveDeliveryTypeNames(projectId, [...allRefs]);

        const sourceZones = (doc.deliveryZones || []).filter(z => zoneKeys.includes(z._key));
        if (sourceZones.length === 0) { showToast('Отмеченные зоны не найдены', 'error'); return; }

        const firstZone = sourceZones[0];
        const dtpByName = {};
        for (const dtp of (firstZone.deliveryTypePrices || [])) {
          const name = typeNameMap[dtp.deliveryType?._ref];
          if (name) dtpByName[name] = dtp;
        }

        const mealRefs = new Set();
        for (const dtp of Object.values(dtpByName)) {
          if (dtp.deliveryProduct?._ref) mealRefs.add(dtp.deliveryProduct._ref);
          for (const gradation of (dtp.deliveryPrice || [])) {
            if (gradation.deliveryProduct?._ref) mealRefs.add(gradation.deliveryProduct._ref);
          }
        }
        let mealNameMap = {};
        try { mealNameMap = await resolveMealNames(projectId, [...mealRefs]); }
        catch (e) { /* не критично — просто покажем id вместо названия блюда */ }

        const allTypeNames = [...new Set(Object.values(typeNameMap))].sort((a, b) => {
          if (a === 'Доставка') return -1;
          if (b === 'Доставка') return 1;
          return a.localeCompare(b, 'ru');
        });

        sectionsWrap.innerHTML = '';
        for (const typeName of allTypeNames) {
          sectionsWrap.appendChild(buildDeliveryTypeSection(typeName, dtpByName[typeName] || null, typeName !== 'Доставка', projectId, mealNameMap));
        }
        currentSourceState = { allTypeNames };

        targetHeading.style.display = 'block';
        targetTree.el.style.display = 'block';
        footer.el.style.display = 'block';
        // Цель по умолчанию = тот же ресторан и те же зоны, что источник — но
        // только при первой подстановке, чтобы не сбрасывать выбор пользователя,
        // если он уже донабрал другие рестораны в дереве целей вручную.
        if (targetTree.getShopsData().length === 0) {
          targetTreeOpts.preselected = { [sourceShopId]: zoneKeys };
          targetTree.load().then(() => footer.syncDangerBanner());
        }
        showToast(`Условия подставлены из «${doc.name?.ru || sourceShopId}», зоны: ${sourceZones.map(z => z.name).join(', ')}`, 'success', 4000);
      } catch (e) {
        showToast('Ошибка загрузки: ' + e.message, 'error');
      } finally {
        loadSourceBtn.textContent = '⬇️ Подставить условия из отмеченной зоны';
        loadSourceBtn.disabled = false;
      }
    });

    const footer = buildApplyOptionsFooter({
      applyLabel: '✅ Применить условия',
      getShopCount: () => Object.keys(targetTree.getSelection()).length,
      beforeApply: () => {
        if (!currentSourceState) { showToast('Сначала подставьте условия из ресторана-источника', 'warning'); return false; }
        const missingProducts = collectMissingProductWarnings(sectionsWrap, currentSourceState.allTypeNames);
        if (missingProducts.length > 0) {
          showToast(
            '⛔ Нельзя применить — для платной доставки обязательно нужно указать блюдо из каталога:\n' +
            missingProducts.map(w => `• ${w}`).join('\n') +
            '\n\nОткройте 🔍 у соответствующего поля и выберите блюдо.',
            'error', 15000
          );
          return false;
        }
        return true;
      },
      onApply: (state) => {
        const { changes, typeMeta } = collectConditionChanges(sectionsWrap, currentSourceState.allTypeNames);
        if (Object.keys(changes).length === 0) { showToast('Нет изменений для применения', 'warning'); return; }
        const selectedShopZones = targetTree.getSelection();
        overlay.remove();
        applyConditionsToTargets(projectId, selectedShopZones, changes, typeMeta, state);
      }
    });
    footer.el.style.display = 'none';
    el.appendChild(footer.el);

    return { el };
  }

  // Вкладка «Копирование зон»: то же, что раньше «Копировать/Вставить» через
  // глобальный clipboard, но источник и цели выбираются явно в одной форме.
  function buildCopyZonesTab(projectId, initialShopId, overlay) {
    const el = document.createElement('div');

    const sourceHeading = document.createElement('div');
    sourceHeading.style.cssText = 'font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-bottom:6px;';
    sourceHeading.textContent = 'Откуда копировать';
    el.appendChild(sourceHeading);

    const sourceTree = buildShopZoneTree(projectId, {
      hint: 'Отметьте зону(ы) для копирования РОВНО в одном ресторане-источнике.',
      autoExpandShopId: initialShopId || undefined
    });
    el.appendChild(sourceTree.el);
    if (initialShopId) sourceTree.load();

    const targetHeading = document.createElement('div');
    targetHeading.style.cssText = 'font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-top:22px;margin-bottom:6px;';
    targetHeading.textContent = 'Куда скопировать';
    el.appendChild(targetHeading);

    const targetTree = buildShopZoneTree(projectId, {
      shopLevelOnly: true,
      hint: 'Копирование добавляет зоны из источника к уже существующим в ресторане — ничего не удаляется и не переписывается, поэтому выбор здесь только на уровне ресторана.',
      onChange: () => footer.syncDangerBanner()
    });
    el.appendChild(targetTree.el);

    const hideSourceWrap = document.createElement('label');
    hideSourceWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-secondary);margin-top:14px;cursor:pointer;';
    hideSourceWrap.innerHTML = `
      <input type="checkbox" style="width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);" data-sz-hide-source>
      <span>Не указывать зону-источник в названии <span style="color:var(--smt-text-tertiary);">(иначе к названию добавляется «с адрес-источника». Если в ресторане-цели уже есть зона с таким же названием — она будет пропущена)</span></span>
    `;
    el.appendChild(hideSourceWrap);
    const hideSourceCb = hideSourceWrap.querySelector('[data-sz-hide-source]');

    const footer = buildApplyOptionsFooter({
      applyLabel: '📋 Скопировать зоны',
      getShopCount: () => Object.keys(targetTree.getSelection()).length,
      onApply: async (state) => {
        const sourceSelection = sourceTree.getSelection();
        const sourceShopIds = Object.keys(sourceSelection);
        if (sourceShopIds.length === 0) { showToast('Отметьте зону(ы)-источник', 'warning'); return; }
        if (sourceShopIds.length > 1) showToast('Источник должен быть только в одном ресторане — взят первый из отмеченных', 'warning');
        const sourceShopId = sourceShopIds[0];
        const sourceZoneKeys = sourceSelection[sourceShopId];

        const targetShopIds = Object.keys(targetTree.getSelection()).filter(id => id !== sourceShopId);
        if (targetShopIds.length === 0) { showToast('Отметьте хотя бы один ресторан-цель (не совпадающий с источником)', 'warning'); return; }

        overlay.remove();
        showToast('Загружаем зоны источника...', 'info');
        try {
          const sourceDoc = await getDoc(projectId, sourceShopId);
          if (!sourceDoc) { showToast('Ресторан-источник не найден', 'error'); return; }
          const sourceZones = (sourceDoc.deliveryZones || []).filter(z => sourceZoneKeys.includes(z._key));
          if (sourceZones.length === 0) { showToast('Отмеченные зоны источника не найдены', 'error'); return; }
          const sourceAddress = getAddress(sourceDoc);

          if (state.backupBefore) {
            downloadJson(backupFilename(`sanity-backup_copy-zones_${sourceDoc.name?.ru || sourceShopId}`), {
              createdAt: new Date().toISOString(), projectId, operation: 'copy-zones',
              sourceShopId, sourceShopName: sourceDoc.name?.ru || null, zones: sourceZones
            });
          }

          showToast(`Копируем ${sourceZones.length} зон(ы) в ${targetShopIds.length} ресторан(ов)...`, 'info', 3000);
          const result = await copyZonesToShops(projectId, sourceZones, sourceAddress, targetShopIds, {
            autoPublish: state.autoPublish, forcePublish: state.forcePublish, hideSource: hideSourceCb.checked
          });

          const addedEntries = Object.values(result.addedByShop);
          let msg = `✅ Скопировано в ${addedEntries.length} из ${targetShopIds.length} ресторан(ов):\n`
            + addedEntries.slice(0, 20).map(a => `• ${a.shopName}: ${a.zoneNames.join(', ')}`).join('\n');
          let toastType = 'success';
          const skippedPublish = addedEntries.filter(a => a.publishSkipped);
          if (skippedPublish.length > 0) {
            msg += `\n\n⏸ Публикация пропущена (${skippedPublish.length}) — есть посторонние неопубликованные изменения`;
            toastType = 'warning';
          }
          if (result.skippedMsgs.length > 0) {
            msg += `\n\n⚠️ Уже существовали, пропущено:\n` + result.skippedMsgs.slice(0, 20).join('\n');
            toastType = 'warning';
          }
          if (result.errors.length > 0) {
            msg += `\n\n⛔ Ошибки (${result.errors.length}):\n` + result.errors.slice(0, 20).join('\n');
            toastType = 'error';
          }
          if (!state.autoPublish && addedEntries.length > 0) msg += '\n\nНажмите «Опубликовать» в интерфейсах изменённых ресторанов.';
          const duration = toastType === 'success' ? 8000 : 15000;
          showToast(msg, toastType, duration);
          if (state.reloadAfter) setTimeout(() => location.reload(), duration + 500);
        } catch (e) {
          showToast('Ошибка: ' + e.message, 'error');
        }
      }
    });
    el.appendChild(footer.el);

    return { el };
  }

  // Вкладка «Способы оплаты»: включить/выключить один способ оплаты в выбранных
  // зонах — точечная операция (добавить/убрать значение из массива paymentTypes
  // каждого затронутого типа доставки), а не замена всего списка целиком, как
  // раньше делала галочка «Типы оплаты» в общем редакторе условий.
  function buildPaymentToggleTab(projectId, initialShopId, overlay) {
    const el = document.createElement('div');

    const controlsWrap = document.createElement('div');
    controlsWrap.style.cssText = 'display:flex; gap:20px; align-items:flex-end; flex-wrap:wrap; margin-bottom:20px;';

    const methodWrap = document.createElement('div');
    methodWrap.style.cssText = 'flex:1; min-width:220px;';
    methodWrap.innerHTML = `
      <div style="font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-bottom:6px;">Способ оплаты</div>
      <select style="width:100%;height:42px;box-sizing:border-box;padding:0 10px;border:1px solid var(--smt-border);border-radius:6px;font-size:15px;font-family:inherit;background:var(--smt-bg-panel);color:var(--smt-text-primary);" data-sz-payment-method>
        ${PAYMENT_TYPES.map(pt => `<option value="${pt.value}">${pt.label}</option>`).join('')}
      </select>
    `;
    controlsWrap.appendChild(methodWrap);

    const actionWrap = document.createElement('div');
    actionWrap.innerHTML = `
      <div style="font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-bottom:6px;">Действие</div>
      <div class="smt-tri">
        <input type="radio" name="sz-payment-action" id="sz-payment-action-on" checked>
        <label for="sz-payment-action-on" class="smt-tri-opt"><span class="smt-tri-fill"></span><span class="smt-tri-text">Включить</span></label>
        <input type="radio" name="sz-payment-action" id="sz-payment-action-off">
        <label for="sz-payment-action-off" class="smt-tri-opt"><span class="smt-tri-fill"></span><span class="smt-tri-text">Выключить</span></label>
      </div>
    `;
    controlsWrap.appendChild(actionWrap);
    el.appendChild(controlsWrap);

    const targetHeading = document.createElement('div');
    targetHeading.style.cssText = 'font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-bottom:6px;';
    targetHeading.textContent = 'В каких зонах';
    el.appendChild(targetHeading);

    const targetTree = buildShopZoneTree(projectId, {
      allowSelectAllGlobal: true,
      autoExpandShopId: initialShopId || undefined,
      showDeliveryTypes: true,
      hint: 'У зоны может быть несколько способов получения (доставка, самовывоз...), и у каждого свой набор способов оплаты — если под зоной есть отдельный список способов получения, отметьте только нужные, иначе применится ко всей зоне.',
      onChange: () => footer.syncDangerBanner()
    });
    el.appendChild(targetTree.el);
    if (initialShopId) targetTree.load();

    const footer = buildApplyOptionsFooter({
      applyLabel: '💳 Применить к способу оплаты',
      getShopCount: () => Object.keys(targetTree.getSelection()).length,
      onApply: async (state) => {
        const method = el.querySelector('[data-sz-payment-method]').value;
        const enable = el.querySelector('#sz-payment-action-on').checked;
        const selectedShopZones = targetTree.getSelection();
        overlay.remove();
        await applyPaymentToggle(projectId, selectedShopZones, method, enable, state);
      }
    });
    el.appendChild(footer.el);

    return { el };
  }

  // Секция одного способа получения (самовывоз/в зале) на вкладке «Способы
  // получения»: чекбокс «добавлять» раскрывает активность + типы оплаты.
  // Оба поля без дефолта по требованию — Sanity не задаёт разумного значения
  // ни для того, ни для другого, поэтому вместо угадывания оставляем их
  // невыбранными до тех пор, пока их не проставят вручную.
  function buildFulfillmentMethodSection(method) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-sz-fulfillment-method', method.value);
    wrap.style.cssText = 'margin-top:14px;padding:16px;background:var(--smt-bg-subtle);border-radius:8px;border:1px solid var(--smt-border);';

    const headLabel = document.createElement('label');
    headLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:var(--smt-text-primary);cursor:pointer;';
    headLabel.innerHTML = `<input type="checkbox" data-sz-fulfillment-include style="width:17px;height:17px;cursor:pointer;accent-color:var(--smt-accent);"> ${method.label}`;
    wrap.appendChild(headLabel);

    const body = document.createElement('div');
    body.setAttribute('data-sz-fulfillment-body', '1');
    body.style.cssText = 'margin-top:12px;display:none;';

    const activeLabel = document.createElement('label');
    activeLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-primary);margin-bottom:14px;cursor:pointer;';
    activeLabel.innerHTML = '<input type="checkbox" data-sz-fulfillment-active style="width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);"> Активен сразу после добавления';
    body.appendChild(activeLabel);

    const paymentTitle = document.createElement('div');
    paymentTitle.style.cssText = 'font-size:14px;color:var(--smt-text-secondary);margin-bottom:8px;';
    paymentTitle.textContent = 'Типы оплаты';
    body.appendChild(paymentTitle);

    // Для «В зале»: типы оплаты почти всегда совпадают с самовывозом, но сам
    // самовывоз в разных ресторанах настроен по-разному — поэтому вместо
    // общего списка берём типы оплаты самовывоза каждой конкретной зоны.
    let copyCb = null;
    if (method.value === 'indoor') {
      const copyLabel = document.createElement('label');
      copyLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--smt-text-primary);margin-bottom:10px;cursor:pointer;';
      copyLabel.innerHTML = '<input type="checkbox" data-sz-payment-copy-pickup style="width:16px;height:16px;cursor:pointer;accent-color:var(--smt-accent);"> Скопировать с самовывоза (в каждом ресторане — свои)';
      body.appendChild(copyLabel);
      copyCb = copyLabel.querySelector('input');
    }

    const grid = buildPaymentTypesGrid([]);
    body.appendChild(grid);
    if (copyCb) copyCb.addEventListener('change', () => { grid.style.display = copyCb.checked ? 'none' : ''; });

    wrap.appendChild(body);

    headLabel.querySelector('[data-sz-fulfillment-include]').addEventListener('change', e => {
      body.style.display = e.target.checked ? 'block' : 'none';
    });

    return wrap;
  }

  // Вкладка «Способы получения»: добавляет самовывоз и/или приём в зале как
  // НОВЫЕ способы получения (deliveryTypePrices) — не редактирует уже
  // существующие. Добавляет только в первую по списку зону ресторана и в
  // первую АКТИВНУЮ зону (иногда это одна и та же зона, тогда добавление
  // одно, а не два) — остальные зоны эти способы получения не затрагивает.
  // Время доставки, мин. сумма корзины и цена по умолчанию всегда 0;
  // активность и типы оплаты каждого способа задаются вручную в модалке
  // перед массовой вставкой (см. buildFulfillmentMethodSection).
  function buildFulfillmentTab(projectId, initialShopId, overlay) {
    const el = document.createElement('div');

    const methodsHeading = document.createElement('div');
    methodsHeading.style.cssText = 'font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-bottom:6px;';
    methodsHeading.textContent = 'Какие способы получения добавить';
    el.appendChild(methodsHeading);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:13px;color:var(--smt-text-tertiary);margin-bottom:10px;';
    hint.textContent = 'Добавляются как новые — если такой способ получения в зоне уже есть, она пропускается. Затрагивает только первую по списку зону и первую активную зону ресторана (иногда это одна и та же зона).';
    el.appendChild(hint);

    const sections = {};
    for (const m of FULFILLMENT_METHODS) {
      const section = buildFulfillmentMethodSection(m);
      sections[m.value] = section;
      el.appendChild(section);
    }

    const targetHeading = document.createElement('div');
    targetHeading.style.cssText = 'font-size:14px;font-weight:600;color:var(--smt-text-primary);margin-top:22px;margin-bottom:6px;';
    targetHeading.textContent = 'В каких ресторанах';
    el.appendChild(targetHeading);

    const targetTree = buildShopZoneTree(projectId, {
      shopLevelOnly: true,
      autoExpandShopId: initialShopId || undefined,
      hint: 'Зона выбирается автоматически (первая по списку и первая активная) — здесь отмечайте только рестораны.',
      onChange: () => footer.syncDangerBanner()
    });
    el.appendChild(targetTree.el);
    if (initialShopId) targetTree.load();

    function readSelectedMethods() {
      return FULFILLMENT_METHODS
        .filter(m => sections[m.value].querySelector('[data-sz-fulfillment-include]').checked)
        .map(m => ({
          value: m.value,
          label: m.label,
          active: sections[m.value].querySelector('[data-sz-fulfillment-active]').checked,
          paymentTypes: readPaymentTypesGrid(sections[m.value].querySelector('[data-sz-payment-grid]')),
          copyPaymentFrom: sections[m.value].querySelector('[data-sz-payment-copy-pickup]')?.checked ? 'pickup' : null
        }));
    }

    const footer = buildApplyOptionsFooter({
      applyLabel: '🚗 Добавить способы получения',
      getShopCount: () => Object.keys(targetTree.getSelection()).length,
      beforeApply: () => {
        if (readSelectedMethods().length === 0) {
          showToast('Отметьте хотя бы один способ получения для добавления', 'warning');
          return false;
        }
        return true;
      },
      onApply: (state) => {
        const selectedMethods = readSelectedMethods();
        const targetShopIds = Object.keys(targetTree.getSelection());
        overlay.remove();
        applyFulfillmentMethods(projectId, targetShopIds, selectedMethods, state);
      }
    });
    el.appendChild(footer.el);

    return { el };
  }

  // Хаб-модалка «Управление зонами» — единая точка входа вместо трёх отдельных
  // кнопок в шапке ресторана. Ресторан(ы)/зоны выбираются внутри самой модалки
  // (переиспользуемым деревом buildShopZoneTree), а не через уже открытую
  // страницу — кнопка вызова теперь глобальная и не требует, чтобы ресторан
  // был открыт. Если ресторан всё же открыт — initialShopId подставляется как
  // удобный дефолт (разворачивается в дереве источника), но его всегда можно
  // сменить на любой другой.
  function openZonesHub(initialShopId) {
    const projectId = getProjectId();
    if (!projectId) { showToast('Не удалось определить Project ID. Обновите страницу.', 'error'); return; }

    const overlay = document.createElement('div');
    overlay.id = 'sz-edit-modal';
    applyStoredTheme(overlay);
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:999998;
      background:rgba(23,20,14,.5);
      display:flex;align-items:center;justify-content:center;
      font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    `;
    const modal = document.createElement('div');
    modal.style.cssText = `
      background:var(--smt-bg-panel);color:var(--smt-text-primary);border-radius:12px;padding:32px;
      width:820px;max-width:96vw;max-height:90vh;
      overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.25);
      position:relative;
      font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    `;
    const title = document.createElement('div');
    title.style.cssText = 'font-size:22px;font-weight:700;margin-bottom:6px;color:var(--smt-text-primary);padding-right:140px;display:flex;align-items:center;gap:8px;';
    title.innerHTML = `<span class="sz-icon sz-icon--lg" style="color:var(--smt-accent);">${NAV_ICON_SVG}</span> Управление зонами`;
    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:15px;color:var(--smt-text-tertiary);margin-bottom:18px;';
    subtitle.textContent = 'Условия доставки, копирование зон между ресторанами, способы оплаты и получения';

    const headerControls = document.createElement('div');
    headerControls.style.cssText = 'position:absolute;top:20px;right:22px;display:flex;align-items:center;gap:10px;';
    const themeSwitch = buildThemeSwitch(next => {
      overlay.classList.toggle('smt-dark', next === 'dark');
    });
    headerControls.appendChild(themeSwitch);
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'sz-flat-btn';
    closeBtn.style.cssText = 'width:34px;height:34px;font-size:16px;';
    closeBtn.addEventListener('click', () => overlay.remove());
    headerControls.appendChild(closeBtn);

    const modes = [
      { key: 'conditions',   label: 'Условия' },
      { key: 'copy',         label: 'Копирование зон' },
      { key: 'payments',     label: 'Способы оплаты' },
      { key: 'fulfillment',  label: 'Способы получения' }
    ];
    const triWrap = document.createElement('div');
    triWrap.className = 'smt-tri';
    triWrap.style.cssText = 'margin-bottom:20px;';
    modes.forEach((m, i) => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'sz-hub-mode';
      input.id = `sz-hub-mode-${m.key}`;
      if (i === 0) input.checked = true;
      const label = document.createElement('label');
      label.setAttribute('for', `sz-hub-mode-${m.key}`);
      label.className = 'smt-tri-opt';
      label.innerHTML = `<span class="smt-tri-fill"></span><span class="smt-tri-text">${m.label}</span>`;
      triWrap.appendChild(input);
      triWrap.appendChild(label);
    });

    // body — внешний контейнер, чью высоту анимируем (overflow:hidden, ей
    // управляет ResizeObserver ниже). bodyInner — настоящий контент, всегда
    // на естественной высоте (height не трогаем никогда) — именно за ним
    // следит ResizeObserver, поэтому колбэк реагирует только на реальные
    // изменения контента и никогда на анимацию самого body (иначе было бы
    // зацикливание: body меняется → наблюдатель видит своё же изменение).
    // Так анимируется ЛЮБОЕ изменение высоты — не только смена вкладки, но и
    // разворачивание ресторана/зоны, догрузка списка ресторанов, появление
    // блока условий после «Подставить условия» и т.п. — без необходимости
    // вручную дёргать анимацию из каждого места, где меняется контент.
    const body = document.createElement('div');
    body.style.cssText = 'overflow:hidden;';
    const bodyInner = document.createElement('div');
    body.appendChild(bodyInner);

    modal.appendChild(headerControls);
    modal.appendChild(title);
    modal.appendChild(subtitle);
    modal.appendChild(triWrap);
    modal.appendChild(body);
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const HEIGHT_ANIM_MS = 280;
    let lastBodyHeight = 0;
    let heightResetTimer = null;
    const heightObserver = new ResizeObserver(() => {
      const newHeight = bodyInner.offsetHeight;
      if (newHeight === lastBodyHeight) return;
      body.style.transition = 'none';
      body.style.height = lastBodyHeight + 'px';
      body.offsetHeight; // форсируем layout, чтобы старая высота зафиксировалась до смены на новую
      requestAnimationFrame(() => {
        body.style.transition = `height ${HEIGHT_ANIM_MS}ms ease`;
        body.style.height = newHeight + 'px';
      });
      lastBodyHeight = newHeight;
      clearTimeout(heightResetTimer);
      // возвращаем на 'auto' после анимации — иначе контент, который вырастет
      // позже (например, поля условий после «Подставить условия»), обрежется
      // зафиксированной высотой вместо того, чтобы просто раздвинуть модалку
      heightResetTimer = setTimeout(() => { body.style.height = 'auto'; }, HEIGHT_ANIM_MS + 40);
    });
    heightObserver.observe(bodyInner);
    // overlay.remove() дёргается из многих мест (крестик, клик по фону, все
    // три onApply в самих вкладках) — проще один раз подменить сам метод,
    // чем тащить disconnect() во все точки вызова.
    const closeOverlay = overlay.remove.bind(overlay);
    overlay.remove = () => { heightObserver.disconnect(); closeOverlay(); };

    // Вкладки строятся лениво — при первом переключении на них, а не все три
    // сразу при открытии модалки, чтобы не гонять fetchAllShops() впустую.
    const built = {};
    function showMode(key) {
      bodyInner.innerHTML = '';
      if (!built[key]) {
        if (key === 'conditions')       built[key] = buildConditionsTab(projectId, initialShopId, overlay);
        else if (key === 'copy')        built[key] = buildCopyZonesTab(projectId, initialShopId, overlay);
        else if (key === 'payments')    built[key] = buildPaymentToggleTab(projectId, initialShopId, overlay);
        else                            built[key] = buildFulfillmentTab(projectId, initialShopId, overlay);
      }
      bodyInner.appendChild(built[key].el);
    }
    modes.forEach(m => {
      triWrap.querySelector(`#sz-hub-mode-${m.key}`).addEventListener('change', () => showMode(m.key));
    });
    showMode('conditions');
  }

  function gradRowValue(row, dynamicCalc) {
    if (!row) return 0;
    const v = dynamicCalc ? row.compensation?.compensationValue : row.price;
    return (typeof v === 'number' && !isNaN(v)) ? v : 0;
  }

  function gradRowsToMap(rows, dynamicCalc) {
    const map = {};
    for (const r of (rows || [])) {
      if (r?.basketPriceTo === undefined || r?.basketPriceTo === null) continue;
      map[r.basketPriceTo] = gradRowValue(r, dynamicCalc);
    }
    return map;
  }

  function collectPriceWarnings(zoneName, typeName, dtp, change, priceFieldName, dynamicCalc) {
    const warnings = [];
    const oldDefault = (typeof dtp?.[priceFieldName] === 'number') ? dtp[priceFieldName] : 0;
    const newDefault = (priceFieldName in change) ? change[priceFieldName] : oldDefault;
    if (newDefault !== oldDefault && (newDefault > 0 || oldDefault > 0)) {
      warnings.push(`${zoneName} — ${typeName}: цена ${oldDefault}₽ → ${newDefault}₽`);
    }
    const oldGradMap = gradRowsToMap(dtp?.deliveryPrice, dynamicCalc);
    const newGradMap = ('deliveryPrice' in change) ? gradRowsToMap(change.deliveryPrice, dynamicCalc) : oldGradMap;
    const allKeys = new Set([...Object.keys(oldGradMap), ...Object.keys(newGradMap)]);
    for (const key of allKeys) {
      const oldVal = oldGradMap[key] ?? 0;
      const newVal = newGradMap[key] ?? 0;
      if (oldVal !== newVal && (newVal > 0 || oldVal > 0)) {
        warnings.push(`${zoneName} — ${typeName}: ступень до ${key}₽: ${oldVal} → ${newVal}`);
      }
    }
    return warnings;
  }

  // Единая функция применения условий — раньше было два отдельных пути
  // ("одиночное" на уже загрученном currentDoc и "массовое" с повторным
  // fetch по каждому ресторану). Теперь источник и цель всегда выбираются
  // явно в модалке, поэтому один ресторан — это просто selectedShopZones
  // из одной пары {shopId: [zoneKey,...]}, код для 1 и N ресторанов общий.
  async function applyConditionsToTargets(projectId, selectedShopZones, changes, typeMeta, state) {
    const shopIds = Object.keys(selectedShopZones);
    if (shopIds.length === 0) { showToast('Нет выбранных зон', 'warning'); return; }

    // Предполётная проверка: если публикуем автоматически, сначала убеждаемся,
    // что ВСЕ выбранные рестораны проходят валидацию Studio (через SPA-переход
    // по каждому и чтение её собственной панели «Валидация» — надёжнее любой
    // самописной проверки, так как учитывает вообще все кастомные правила схемы).
    if (state.autoPublish && state.preflightValidation) {
      const workspace    = currentWorkspace();
      const originalPath = location.pathname;
      showToast(`Проверяем валидацию ${shopIds.length} ресторан(ов) перед публикацией...`, 'info', 3000);
      let invalidShops;
      try {
        invalidShops = await checkShopsValidationBeforePublish(workspace, shopIds, originalPath, true);
      } catch (e) {
        showToast('Не удалось проверить валидацию: ' + e.message + '. Публикация отменена — попробуйте ещё раз или снимите галочку предполётной проверки.', 'error', 15000);
        return;
      }
      if (invalidShops.length > 0) {
        const list = invalidShops.map(s => `• ${s.shopName}`).join('\n');
        showToast(
          `⛔ Публикация заблокирована.\n\n` +
          `У ${invalidShops.length} из ${shopIds.length} ресторан(ов) не заполнены обязательные поля ` +
          `(валидация Studio не пройдена):\n${list}\n\n` +
          `Сначала заполните обязательные поля в этих ресторанах вручную в интерфейсе, ` +
          `и только потом повторите применение. Ни один ресторан не был изменён.`,
          'error', 25000
        );
        return;
      }
      showToast('Валидация пройдена во всех ресторанах, продолжаем...', 'success', 2000);
    }

    let progress = 0;
    const total = shopIds.length;
    const allWarnings = [];
    const priceWarnings = [];
    const publishSkippedWarnings = [];
    const backups = [];

    for (const shopId of shopIds) {
      progress++;
      showToast(`Применяем условия: ${progress} из ${total}...`, 'info', 2000);
      const zoneKeys = selectedShopZones[shopId] || [];
      if (zoneKeys.length === 0) continue;
      try {
        const doc = await getDoc(projectId, shopId);
        if (!doc) { allWarnings.push(`${shopId}: заведение не найдено.`); continue; }

        const allRefs = new Set();
        for (const zone of (doc.deliveryZones || []))
          for (const dtp of (zone.deliveryTypePrices || []))
            if (dtp.deliveryType?._ref) allRefs.add(dtp.deliveryType._ref);
        const typeNameMap = await resolveDeliveryTypeNames(projectId, [...allRefs]);

        // Матчим зоны по _key, а не по имени — так надёжно работает,
        // даже если в ресторане другое число зон или другие названия.
        const targetZones = (doc.deliveryZones || []).filter(z => zoneKeys.includes(z._key));
        if (targetZones.length === 0) {
          allWarnings.push(`${doc.name?.ru || shopId}: выбранные зоны не найдены (возможно, были изменены после загрузки списка — обновите список и попробуйте снова).`);
          continue;
        }

        if (state.backupBefore) backups.push({ shopId, shopName: doc.name?.ru || null, zones: targetZones });

        const draftId  = 'drafts.' + shopId;
        const hasDraft = doc._id.startsWith('drafts.');
        // "Свой" черновик — это либо новый (мы его сейчас создаём), либо уже существующий,
        // но с ревизией, совпадающей с той, что скрипт сам оставил в прошлый раз.
        const ownedRev       = hasDraft ? getOwnedDraftRev(projectId, shopId) : null;
        const isKnownOwned   = !hasDraft || (ownedRev !== null && ownedRev === doc._rev);
        const isForeignDraft = hasDraft && !isKnownOwned;
        const mutations = [];
        if (!hasDraft) {
          const { documents } = await (await apiFetch(projectId, `/data/doc/production/${shopId}`)).json();
          mutations.push({ createIfNotExists: { ...documents[0], _id: draftId } });
        }

        const appliedTypes = new Set();
        for (const zone of targetZones) {
          for (const dtp of (zone.deliveryTypePrices || [])) {
            const typeName = typeNameMap[dtp.deliveryType?._ref];
            const change   = changes[typeName];
            if (!change) continue;
            appliedTypes.add(typeName);
            const path = `deliveryZones[_key=="${zone._key}"].deliveryTypePrices[_key=="${dtp._key}"]`;
            const setFields = {};
            const unsetPaths = [];
            for (const key of Object.keys(change)) {
              if (change[key] === null) unsetPaths.push(`${path}.${key}`);
              else setFields[`${path}.${key}`] = change[key];
            }
            const dtpPatch = {};
            if (Object.keys(setFields).length > 0) dtpPatch.set = setFields;
            if (unsetPaths.length > 0) dtpPatch.unset = unsetPaths;
            if (dtpPatch.set || dtpPatch.unset) mutations.push({ patch: { id: draftId, ...dtpPatch } });

            const meta = typeMeta[typeName];
            if (meta) priceWarnings.push(...collectPriceWarnings(zone.name, typeName, dtp, change, meta.priceFieldName, meta.dynamicCalc));
          }
        }
        for (const typeName of Object.keys(changes)) {
          if (!appliedTypes.has(typeName)) {
            allWarnings.push(`${doc.name?.ru || shopId}: в выбранных зонах нет типа "${typeName}"`);
          }
        }

        if (mutations.length === 0) continue;

        const r = await apiFetch(projectId, `/data/mutate/production?returnIds=true&returnDocuments=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutations })
        });
        if (!r.ok) {
          const result = await r.json();
          allWarnings.push(`${doc.name?.ru || shopId}: ошибка Sanity - ${JSON.stringify(result?.error || result)}`);
          continue;
        }
        const result = await r.json();
        const draftResult = result.results?.find(x => x.id === draftId);
        const newRev = draftResult?.document?._rev || null;
        if (isKnownOwned) setOwnedDraftRev(projectId, shopId, newRev);

        if (state.autoPublish) {
          if (isForeignDraft && !state.forcePublish) {
            publishSkippedWarnings.push(`${doc.name?.ru || shopId}: есть другие неопубликованные изменения — публикация пропущена`);
          } else {
            try {
              await publishDoc(projectId, shopId);
              clearOwnedDraftRev(projectId, shopId);
            }
            catch (e) { allWarnings.push(`${doc.name?.ru || shopId}: изменения сохранены, но публикация не удалась - ${e.message}`); }
          }
        }
      } catch (e) {
        allWarnings.push(`${shopId}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (state.backupBefore && backups.length > 0) {
      downloadJson(backupFilename('sanity-backup_apply-conditions'), {
        createdAt: new Date().toISOString(),
        projectId,
        operation: 'apply-conditions',
        typesChanged: Object.keys(changes),
        shopsCount: backups.length,
        shops: backups
      });
    }

    let msg = state.autoPublish
      ? `✅ Условия применены (${total} ресторан(ов)).`
      : `✅ Условия применены (${total} ресторан(ов)).\nНажмите «Опубликовать» в интерфейсах изменённых ресторанов.`;
    let toastType = 'success';
    if (publishSkippedWarnings.length > 0) {
      msg += `\n\n⏸ Публикация пропущена (${publishSkippedWarnings.length}) — в этих ресторанах уже были другие неопубликованные изменения:\n`
        + publishSkippedWarnings.slice(0, 30).join('\n');
      toastType = 'warning';
    }
    if (priceWarnings.length > 0) {
      msg += '\n\n⚠️ Проверьте «Позицию для доставки»:\n' + priceWarnings.slice(0, 30).map(w => `• ${w}`).join('\n');
      toastType = 'warning';
    }
    if (allWarnings.length > 0) {
      msg += `\n\n⚠️ Предупреждения (${allWarnings.length}):\n` + allWarnings.slice(0, 30).join('\n');
      toastType = 'warning';
    }
    const duration = toastType === 'warning' ? 15000 : 6000;
    showToast(msg, toastType, duration);
    if (state.reloadAfter) setTimeout(() => location.reload(), duration + 500);
  }

  // Точечное включение/выключение одного способа оплаты в выбранных зонах —
  // добавляет/убирает значение из paymentTypes каждого затронутого типа
  // доставки, читая ТЕКУЩИЙ массив перед записью (а не заменяя его целиком),
  // чтобы не затереть другие способы оплаты, уже настроенные в этой зоне.
  // Если paymentTypes вообще не задан (undefined) — зона пропускается с
  // предупреждением, а не молча получает угаданный список: см. обсуждение
  // в чате — на реальных данных таких записей не нашлось, но гадать в
  // сторону "разрешить всё" или "запретить всё" одинаково рискованно.
  async function applyPaymentToggle(projectId, selectedShopZones, method, enable, state) {
    const shopIds = Object.keys(selectedShopZones);
    if (shopIds.length === 0) { showToast('Нет выбранных зон', 'warning'); return; }
    const methodLabel = PAYMENT_TYPES.find(p => p.value === method)?.label || method;

    if (state.autoPublish && state.preflightValidation) {
      const workspace    = currentWorkspace();
      const originalPath = location.pathname;
      showToast(`Проверяем валидацию ${shopIds.length} ресторан(ов) перед публикацией...`, 'info', 3000);
      let invalidShops;
      try {
        invalidShops = await checkShopsValidationBeforePublish(workspace, shopIds, originalPath, true);
      } catch (e) {
        showToast('Не удалось проверить валидацию: ' + e.message + '. Публикация отменена.', 'error', 15000);
        return;
      }
      if (invalidShops.length > 0) {
        const list = invalidShops.map(s => `• ${s.shopName}`).join('\n');
        showToast(`⛔ Публикация заблокирована — не пройдена валидация у:\n${list}\n\nНи один ресторан не был изменён.`, 'error', 20000);
        return;
      }
    }

    let progress = 0;
    const total = shopIds.length;
    const changedShops = [];
    const skippedUndefined = [];
    const allWarnings = [];
    const backups = [];

    for (const shopId of shopIds) {
      progress++;
      showToast(`${enable ? 'Включаем' : 'Выключаем'} «${methodLabel}»: ${progress} из ${total}...`, 'info', 2000);
      const zoneMap  = selectedShopZones[shopId] || {};
      const zoneKeys = Object.keys(zoneMap);
      if (zoneKeys.length === 0) continue;
      try {
        const doc = await getDoc(projectId, shopId);
        if (!doc) { allWarnings.push(`${shopId}: заведение не найдено`); continue; }
        const targetZones = (doc.deliveryZones || []).filter(z => zoneKeys.includes(z._key));
        if (targetZones.length === 0) { allWarnings.push(`${doc.name?.ru || shopId}: выбранные зоны не найдены`); continue; }

        if (state.backupBefore) backups.push({ shopId, shopName: doc.name?.ru || null, zones: targetZones });

        const draftId  = 'drafts.' + shopId;
        const hasDraft = doc._id.startsWith('drafts.');
        const ownedRev       = hasDraft ? getOwnedDraftRev(projectId, shopId) : null;
        const isKnownOwned   = !hasDraft || (ownedRev !== null && ownedRev === doc._rev);
        const isForeignDraft = hasDraft && !isKnownOwned;
        const mutations = [];
        if (!hasDraft) {
          const { documents } = await (await apiFetch(projectId, `/data/doc/production/${shopId}`)).json();
          mutations.push({ createIfNotExists: { ...documents[0], _id: draftId } });
        }

        let touchedCount = 0;
        for (const zone of targetZones) {
          // null/отсутствие записи — вся зона, всё способы получения; массив —
          // только перечисленные _key способов получения внутри этой зоны.
          const typeFilter = zoneMap[zone._key];
          for (const dtp of (zone.deliveryTypePrices || [])) {
            if (Array.isArray(typeFilter) && !typeFilter.includes(dtp._key)) continue;
            const current = dtp.paymentTypes;
            if (current === undefined) {
              skippedUndefined.push(`${doc.name?.ru || shopId} — ${zone.name}: список способов оплаты не задан вообще — пропущено, настройте вручную`);
              continue;
            }
            const has = current.includes(method);
            if (enable === has) continue; // уже в нужном состоянии
            const next = enable ? [...current, method] : current.filter(m => m !== method);
            const path = `deliveryZones[_key=="${zone._key}"].deliveryTypePrices[_key=="${dtp._key}"].paymentTypes`;
            mutations.push({ patch: { id: draftId, set: { [path]: next } } });
            touchedCount++;
          }
        }
        if (touchedCount === 0) continue;

        const r = await apiFetch(projectId, `/data/mutate/production?returnIds=true&returnDocuments=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutations })
        });
        if (!r.ok) {
          const result = await r.json();
          allWarnings.push(`${doc.name?.ru || shopId}: ошибка Sanity — ${JSON.stringify(result?.error || result)}`);
          continue;
        }
        const result = await r.json();
        const draftResult = result.results?.find(x => x.id === draftId);
        if (isKnownOwned) setOwnedDraftRev(projectId, shopId, draftResult?.document?._rev || null);
        changedShops.push(doc.name?.ru || shopId);

        if (state.autoPublish) {
          if (isForeignDraft && !state.forcePublish) {
            allWarnings.push(`${doc.name?.ru || shopId}: публикация пропущена — есть посторонние неопубликованные изменения`);
          } else {
            try { await publishDoc(projectId, shopId); clearOwnedDraftRev(projectId, shopId); }
            catch (e) { allWarnings.push(`${doc.name?.ru || shopId}: изменения сохранены, но публикация не удалась — ${e.message}`); }
          }
        }
      } catch (e) {
        allWarnings.push(`${shopId}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (state.backupBefore && backups.length > 0) {
      downloadJson(backupFilename(`sanity-backup_payment-${method}`), {
        createdAt: new Date().toISOString(),
        projectId,
        operation: 'payment-toggle',
        method, enable,
        shopsCount: backups.length,
        shops: backups
      });
    }

    let msg = `${enable ? '✅ Включено' : '✅ Выключено'} «${methodLabel}» в ${changedShops.length} из ${total} ресторан(ов).`;
    let toastType = 'success';
    if (skippedUndefined.length > 0) {
      msg += `\n\n⚠️ Пропущено без изменений (${skippedUndefined.length}) — список способов оплаты не настроен вообще, решение неоднозначно:\n` + skippedUndefined.slice(0, 20).join('\n');
      toastType = 'warning';
    }
    if (allWarnings.length > 0) {
      msg += `\n\n⚠️ Предупреждения (${allWarnings.length}):\n` + allWarnings.slice(0, 20).join('\n');
      toastType = 'warning';
    }
    const duration = toastType === 'warning' ? 15000 : 6000;
    showToast(msg, toastType, duration);
    if (state.reloadAfter) setTimeout(() => location.reload(), duration + 500);
  }

  // Добавляет новые способы получения (deliveryTypePrices) в первую по списку
  // и первую активную зону каждого выбранного ресторана. "Первая активная" —
  // первая зона в deliveryZones, у которой zone.status === true (то же поле,
  // что переключает тумблер «Активна» в редакторе зоны в Studio); если это та
  // же зона, что и первая по списку, добавление в неё происходит один раз, а
  // не дважды. Способ, который в целевой зоне уже есть (совпадает
  // deliveryType._ref), пропускается — не редактируется и не дублируется.
  // Общий с applyPaymentToggle/copyZonesToShops скелет (owned-draft, бэкап,
  // публикация, предполётная проверка валидации).
  async function applyFulfillmentMethods(projectId, shopIds, methods, state) {
    if (shopIds.length === 0) { showToast('Нет выбранных ресторанов', 'warning'); return; }

    let typeRefs;
    try {
      const neededTypes = new Set(methods.map(m => m.value));
      for (const m of methods) if (m.copyPaymentFrom) neededTypes.add(m.copyPaymentFrom);
      typeRefs = await fetchDeliveryTypeRefs(projectId, [...neededTypes]);
    } catch (e) {
      showToast('Ошибка загрузки каталога способов получения: ' + e.message, 'error');
      return;
    }
    const missingCatalog = methods.filter(m => !typeRefs[m.value] || (m.copyPaymentFrom && !typeRefs[m.copyPaymentFrom]));
    if (missingCatalog.length > 0) {
      showToast(
        '⛔ В каталоге «Способы получения» не найдено: ' + missingCatalog.map(m => m.copyPaymentFrom && !typeRefs[m.copyPaymentFrom] ? 'Самовывоз' : m.label).join(', ') +
        '. Создайте способ получения в Studio (раздел «Способы получения») и повторите.',
        'error', 12000
      );
      return;
    }

    if (state.autoPublish && state.preflightValidation) {
      const workspace    = currentWorkspace();
      const originalPath = location.pathname;
      showToast(`Проверяем валидацию ${shopIds.length} ресторан(ов) перед публикацией...`, 'info', 3000);
      let invalidShops;
      try {
        invalidShops = await checkShopsValidationBeforePublish(workspace, shopIds, originalPath, true);
      } catch (e) {
        showToast('Не удалось проверить валидацию: ' + e.message + '. Публикация отменена.', 'error', 15000);
        return;
      }
      if (invalidShops.length > 0) {
        const list = invalidShops.map(s => `• ${s.shopName}`).join('\n');
        showToast(`⛔ Публикация заблокирована — не пройдена валидация у:\n${list}\n\nНи один ресторан не был изменён.`, 'error', 20000);
        return;
      }
    }

    let progress = 0;
    const total = shopIds.length;
    const addedByShop = {};
    const alreadyExists = [];
    const allWarnings = [];
    const backups = [];

    for (const shopId of shopIds) {
      progress++;
      showToast(`Добавляем способы получения: ${progress} из ${total}...`, 'info', 2000);
      try {
        const doc = await getDoc(projectId, shopId);
        if (!doc) { allWarnings.push(`${shopId}: заведение не найдено`); continue; }
        const shopName = doc.name?.ru || shopId;
        const zones = doc.deliveryZones || [];
        if (zones.length === 0) { allWarnings.push(`${shopName}: в ресторане нет зон доставки`); continue; }

        const zoneFirst   = zones[0];
        const zoneActive  = zones.find(z => z.status === true) || null;
        const targetZones = (zoneActive && zoneActive._key !== zoneFirst._key) ? [zoneFirst, zoneActive] : [zoneFirst];

        if (state.backupBefore) backups.push({ shopId, shopName: doc.name?.ru || null, zones: targetZones });

        const draftId  = 'drafts.' + shopId;
        const hasDraft = doc._id.startsWith('drafts.');
        const ownedRev       = hasDraft ? getOwnedDraftRev(projectId, shopId) : null;
        const isKnownOwned   = !hasDraft || (ownedRev !== null && ownedRev === doc._rev);
        const isForeignDraft = hasDraft && !isKnownOwned;
        const mutations = [];
        if (!hasDraft) {
          const { documents } = await (await apiFetch(projectId, `/data/doc/production/${shopId}`)).json();
          mutations.push({ createIfNotExists: { ...documents[0], _id: draftId } });
        }

        // Типы оплаты источника (самовывоза) для «скопировать с самовывоза»:
        // сначала из этой же зоны (уже существующий или добавленный этим же
        // запуском), иначе — из любой другой зоны ресторана, где он есть.
        const findSourcePayments = (zone, sourceValue, addedInZone) => {
          const srcRef = typeRefs[sourceValue].ref;
          const pick = z => (z.deliveryTypePrices || []).find(d => d.deliveryType?._ref === srcRef && Array.isArray(d.paymentTypes) && d.paymentTypes.length > 0);
          const own = pick(zone);
          if (own) return { paymentTypes: own.paymentTypes, fromZone: null };
          if (addedInZone[sourceValue]?.length > 0) return { paymentTypes: addedInZone[sourceValue], fromZone: null };
          for (const z of zones) {
            const other = pick(z);
            if (other) return { paymentTypes: other.paymentTypes, fromZone: z.name || '(без названия)' };
          }
          return null;
        };

        const added = [];
        for (const zone of targetZones) {
          const addedInZone = {};
          for (const method of methods) {
            const ref = typeRefs[method.value].ref;
            const already = (zone.deliveryTypePrices || []).some(d => d.deliveryType?._ref === ref);
            if (already) {
              alreadyExists.push({ shopName, zoneName: zone.name || '(без названия)', methodLabel: method.label });
              continue;
            }
            let paymentTypes = method.paymentTypes;
            let note = '';
            if (method.copyPaymentFrom) {
              const src = findSourcePayments(zone, method.copyPaymentFrom, addedInZone);
              if (!src) {
                allWarnings.push(`${shopName} — «${zone.name || '(без названия)'}»: ${method.label} не добавлен — в ресторане нет самовывоза с типами оплаты, копировать неоткуда`);
                continue;
              }
              paymentTypes = [...src.paymentTypes];
              note = src.fromZone ? ` (оплата как у самовывоза зоны «${src.fromZone}»)` : ' (оплата как у самовывоза)';
            }
            addedInZone[method.value] = paymentTypes;
            const newDtp = {
              _key: newKey(), _type: 'deliveryTypePrice',
              deliveryType: { _type: 'reference', _ref: ref },
              deliveryTime: 0, minBasketPrice: 0, defaultDeliveryPrice: 0,
              dynamicCalc: false, deliveryPrice: [],
              paymentTypes,
              status: method.active
            };
            const path = `deliveryZones[_key=="${zone._key}"].deliveryTypePrices`;
            mutations.push({
              patch: {
                id: draftId,
                setIfMissing: { [path]: [] },
                insert: { after: `${path}[-1]`, items: [newDtp] }
              }
            });
            added.push(`${method.label} → «${zone.name}»${note}`);
          }
        }

        if (added.length === 0) continue;

        const r = await apiFetch(projectId, `/data/mutate/production?returnIds=true&returnDocuments=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutations })
        });
        if (!r.ok) {
          const result = await r.json();
          allWarnings.push(`${shopName}: ошибка Sanity — ${JSON.stringify(result?.error || result)}`);
          continue;
        }
        const result = await r.json();
        const draftResult = result.results?.find(x => x.id === draftId);
        if (isKnownOwned) setOwnedDraftRev(projectId, shopId, draftResult?.document?._rev || null);

        addedByShop[shopId] = { shopName, added, isForeignDraft };

        if (state.autoPublish) {
          if (isForeignDraft && !state.forcePublish) {
            addedByShop[shopId].publishSkipped = 'foreign';
          } else {
            try {
              await publishDoc(projectId, shopId);
              clearOwnedDraftRev(projectId, shopId);
              addedByShop[shopId].published = true;
            } catch (e) {
              addedByShop[shopId].publishError = e.message;
            }
          }
        }
      } catch (e) {
        allWarnings.push(`${shopId}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (state.backupBefore && backups.length > 0) {
      downloadJson(backupFilename('sanity-backup_fulfillment-methods'), {
        createdAt: new Date().toISOString(),
        projectId,
        operation: 'add-fulfillment-methods',
        methods: methods.map(m => m.value),
        shopsCount: backups.length,
        shops: backups
      });
    }

    const addedEntries = Object.values(addedByShop);
    let msg, toastType;
    if (addedEntries.length > 0) {
      msg = `✅ Добавлено в ${addedEntries.length} из ${total} ресторан(ов):\n`
        + addedEntries.slice(0, 20).map(a => `• ${a.shopName}: ${a.added.join(', ')}`).join('\n');
      toastType = 'success';
    } else {
      msg = 'Нечего добавлять — способ(ы) получения уже были во всех целевых зонах.';
      toastType = 'warning';
    }
    const skippedPublish = addedEntries.filter(a => a.publishSkipped);
    if (skippedPublish.length > 0) {
      msg += `\n\n⏸ Публикация пропущена (${skippedPublish.length}) — есть посторонние неопубликованные изменения`;
      toastType = 'warning';
    }
    // Список зон, где способ получения уже был — по всем ресторанам сразу
    // (не только по тем, где что-то ещё и добавилось), чтобы сразу было видно,
    // где ничего дублировать не стали.
    if (alreadyExists.length > 0) {
      msg += `\n\nℹ️ Уже было (${alreadyExists.length}) — не дублировали:\n`
        + alreadyExists.slice(0, 30).map(a => `• ${a.shopName} — «${a.zoneName}»: ${a.methodLabel}`).join('\n');
      toastType = 'warning';
    }
    if (allWarnings.length > 0) {
      msg += `\n\n⚠️ Предупреждения (${allWarnings.length}):\n` + allWarnings.slice(0, 20).join('\n');
      toastType = 'warning';
    }
    if (!state.autoPublish && addedEntries.length > 0) msg += '\n\nНажмите «Опубликовать» в интерфейсах изменённых ресторанов.';
    const duration = toastType === 'success' ? 8000 : 15000;
    showToast(msg, toastType, duration);
    if (state.reloadAfter) setTimeout(() => location.reload(), duration + 500);
  }

  // ---------------------------------------------------------------------
  // Кнопка вызова хаба в левом меню Studio — там же, где кнопка баннеров
  // в sanity-banners-manager.user.js: ищем пункт меню «Schedules» и вставляем
  // свою кнопку туда же (тот же приём, тот же сайт — оба скрипта работают
  // с одним и тем же левым меню). В отличие от старых кнопок в шапке
  // карточки ресторана, эта не привязана к открытому документу — работает
  // на любой странице, ресторан(ы)/зоны выбираются внутри самой модалки.
  // ---------------------------------------------------------------------
  function findNavContainer() {
    const link = Array.from(document.querySelectorAll('a')).find(
      a => a.textContent.trim() === 'Schedules'
    );
    return link ? link.parentElement : null;
  }

  // Кнопка нужна только на странице списка заведений и на страницах отдельных
  // заведений (и глубже) — не на каждой странице Studio. parts[2] у списка —
  // "shops-item;shops", у конкретного заведения — "shops-item;shops;{id}".
  function isZonesRoute() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length < 3) return false;
    if (parts[1] !== 'structure') return false;
    return parts[2].startsWith('shops-item;shops');
  }

  // Иконка кнопки — currentColor, viewBox обрезан вплотную к фигуре (у
  // исходника был 1px пустого поля сверху/снизу в 16×16, здесь срезано до
  // фактических границ 16×14, см. modal-style-guide/icons.md про то, почему
  // это важно на мелком масштабе).
  const NAV_ICON_SVG = '<svg viewBox="0 1 16 14" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 2L0 1V14L4 15V2Z" fill="currentColor"/><path d="M16 2L12 1V14L16 15V2Z" fill="currentColor"/><path d="M10 1L6 2V15L10 14V1Z" fill="currentColor"/></svg>';

  function createNavButton() {
    const btn = document.createElement('button');
    btn.id = 'sz-nav-btn';
    btn.type = 'button';
    btn.innerHTML = `<span class="sz-icon">${NAV_ICON_SVG}</span> Управление зонами`;
    btn.addEventListener('click', () => openZonesHub(getShopId()));
    return btn;
  }

  function createFallbackFab() {
    const btn = document.createElement('button');
    btn.id = 'sz-fab';
    btn.type = 'button';
    btn.innerHTML = `<span class="sz-icon">${NAV_ICON_SVG}</span> Управление зонами`;
    btn.addEventListener('click', () => openZonesHub(getShopId()));
    return btn;
  }

  // Даём левому меню время отрисоваться и только если оно так и не появилось
  // спустя разумное время — показываем плавающую кнопку внизу справа (тот же
  // приём, что в sanity-banners-manager.user.js, чтобы не было вспышки кнопки
  // при обычной загрузке страницы).
  const NAV_FALLBACK_GRACE_MS = 2500;
  let navButtonSince = null;

  function syncNavButton() {
    if (!document.body) return;
    const navBtn = document.getElementById('sz-nav-btn');
    const fab    = document.getElementById('sz-fab');

    if (!isZonesRoute()) {
      navButtonSince = null;
      if (navBtn) navBtn.remove();
      if (fab) fab.remove();
      return;
    }

    ensureModalStyles();
    if (navButtonSince === null) navButtonSince = Date.now();
    const container = findNavContainer();

    if (container) {
      if (fab) fab.remove();
      if (!navBtn || navBtn.parentElement !== container) {
        if (navBtn) navBtn.remove();
        container.appendChild(createNavButton());
      }
      return;
    }

    if (Date.now() - navButtonSince > NAV_FALLBACK_GRACE_MS && !fab) {
      document.body.appendChild(createFallbackFab());
    }
  }

  setInterval(syncNavButton, 250);
  if (document.body) {
    syncNavButton();
  } else {
    document.addEventListener('DOMContentLoaded', syncNavButton, { once: true });
  }

})();
    })(PAGE_WIN, PAGE_WIN.console);
  });

  // ===== Модуль: banners (sanity-banners/sanity-banners-manager.user.js, v2.10.2) — после загрузки DOM
  whenReady(function () {
    runModule('banners', function () {
(function () {
  'use strict';

  // ==================== НАСТРОЙКИ ====================
  const DATASET = 'production';
  const API_VERSION = 'v2024-05-28';
  const DOC_TYPE = 'banner';
  const SORT_STEP = 100; // отступ от края при перемещении в самое начало/конец списка (абсолютное число не важно — важен только порядок)

  // ==================== ОПРЕДЕЛЕНИЕ ПРОЕКТА (project id) ====================
  // URL вида https://my.starterapp.ru/<project-alias>/... не содержит настоящий
  // project id Sanity. Раньше он подсматривался через перехват fetch/XHR или
  // Resource Timing API — оба способа либо ненадёжны (некоторые браузеры не
  // отдают кросс-доменные записи ресурсов), либо (перехват fetch/XHR в связке
  // с document-start) реально ломали загрузку JS-чанков самой студии.
  //
  // Правильный способ проще и безопаснее: сама студия вшивает project id прямо
  // в HTML страницы — в инлайн-скрипте есть переменная SANITY_STUDIO_API_PROJECT_ID.
  // Это просто чтение уже готового DOM, без единого дополнительного запроса и
  // без вмешательства в чужой код.

  let detectedProjectId = null;
  const PROJECT_ID_KEY_PATTERN = /SANITY_STUDIO_API_PROJECT_ID["']?\s*[:=]\s*["']([a-z0-9]+)["']/i;

  function extractProjectIdFromPage() {
    const scripts = Array.from(document.scripts || []).filter((s) => !s.src);
    for (const s of scripts) {
      const m = s.textContent.match(PROJECT_ID_KEY_PATTERN);
      if (m) return m[1];
    }
    return null;
  }

  async function waitForProjectId(timeoutMs = 8000) {
    const start = Date.now();
    while (!detectedProjectId) {
      detectedProjectId = extractProjectIdFromPage();
      if (detectedProjectId) break;
      if (Date.now() - start > timeoutMs) {
        throw new Error('Не удалось определить проект Sanity — обновите страницу студии и попробуйте снова');
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return detectedProjectId;
  }

  function apiBase() {
    return `https://${detectedProjectId}.api.sanity.io/${API_VERSION}`;
  }

  // ==================== ОПРЕДЕЛЕНИЕ МАРШРУТА ====================
  // Кнопка нужна только на странице списка/карточки баннеров и глубже:
  // /<project>/structure/static-item;banners[...]

  function isBannersRoute() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length < 3) return false;
    if (parts[1] !== 'structure') return false;
    return parts[2].startsWith('static-item;banners');
  }

  // ==================== СЕТЕВЫЕ ЗАПРОСЫ ====================

  async function groqQuery(query) {
    await waitForProjectId();
    const url = `${apiBase()}/data/query/${DATASET}?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`GROQ ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.result;
  }

  async function mutate(mutations) {
    await waitForProjectId();
    const url = `${apiBase()}/data/mutate/${DATASET}`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations }),
    });
    if (!res.ok) throw new Error(`Mutate ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // Загружаем ВСЕ баннеры (и опубликованные, и черновики) одним запросом,
  // без необходимости скроллить список в интерфейсе Sanity.
  async function fetchBanners() {
    const query = `*[_type=="${DOC_TYPE}"]{
      _id,
      title,
      status,
      showInApplication,
      showInWeb,
      sortIndex,
      "thumbH": backgroundImage.asset->url,
      "thumbV": verticalBackgroundImage.asset->url,
      "cityIds": cities[]._ref,
      "cityNames": cities[]->name.ru,
      "shopIds": shops[]._ref,
      "venues": shops[]->{
        "city": address.city.ru,
        "street": address.street.ru,
        "house": address.house.ru
      }
    }`;
    const raw = await groqQuery(query);

    const byBase = new Map();
    for (const doc of raw) {
      const isDraft = doc._id.startsWith('drafts.');
      const baseId = isDraft ? doc._id.slice(7) : doc._id;
      const existing = byBase.get(baseId) || {};
      if (isDraft) existing.draft = doc;
      else existing.published = doc;
      byBase.set(baseId, existing);
    }

    const banners = [];
    for (const [baseId, { draft, published }] of byBase.entries()) {
      const current = draft || published;
      banners.push({
        baseId,
        editId: current._id, // именно этот _id надо патчить
        hasDraft: !!draft,
        title: current.title || '(без названия)',
        status: !!current.status,
        showInApplication: current.showInApplication !== false,
        showInWeb: current.showInWeb !== false,
        sortIndex: typeof current.sortIndex === 'number' ? current.sortIndex : 0,
        thumbH: current.thumbH || null,
        thumbV: current.thumbV || null,
        cityIds: current.cityIds || [],
        shopIds: current.shopIds || [],
        venues: formatVenues(current.cityNames, current.venues),
      });
    }
    banners.sort((a, b) => a.sortIndex - b.sortIndex);
    return banners;
  }

  // Пустые поля «Города» и «Заведения» в Sanity вместе означают «показывать
  // везде» — в этом случае ничего не выводим на превью, чтобы не загромождать
  // карточку. Если что-то указано — собираем города и адреса точек в короткие
  // читаемые строки (города — с пометкой, чтобы не путать с одиночной точкой).
  function formatVenues(rawCityNames, rawVenues) {
    const cities = (Array.isArray(rawCityNames) ? rawCityNames : [])
      .filter(Boolean)
      .map((name) => `${name} (город)`);
    const shops = (Array.isArray(rawVenues) ? rawVenues : [])
      .filter(Boolean)
      .map((v) => [v.city, v.street, v.house].filter(Boolean).map((s) => String(s).trim()).join(', '))
      .filter(Boolean);
    return [...cities, ...shops];
  }

  // Все изменения из этого инструмента пишутся ТОЛЬКО в черновик (drafts.<id>),
  // опубликованный документ никогда не патчится напрямую — так публикация
  // остаётся осознанным, ручным действием в самой студии («Опубликовать»),
  // а не происходит незаметно в момент клика по превью.
  //
  // Если черновика ещё нет, перед патчем клонируем туда ПОЛНЫЙ опубликованный
  // документ (createIfNotExists), чтобы не потерять остальные поля баннера —
  // и только затем применяем нужные изменения (set) к этому черновику.

  function cloneForDraft(fullDoc, draftId) {
    const clone = { ...fullDoc, _id: draftId };
    delete clone._rev;
    delete clone._createdAt;
    delete clone._updatedAt;
    return clone;
  }

  // Патч одного баннера (один или несколько полей).
  async function patchBanner(banner, fields) {
    if (banner.hasDraft) {
      await mutate([{ patch: { id: banner.editId, set: fields } }]);
      return;
    }
    const publishedId = banner.editId;
    const draftId = 'drafts.' + banner.baseId;
    const fullDoc = await groqQuery(`*[_id=="${publishedId}"][0]`);
    const mutations = [{ createIfNotExists: cloneForDraft(fullDoc, draftId) }, { patch: { id: draftId, set: fields } }];
    await mutate(mutations);
    banner.editId = draftId;
    banner.hasDraft = true;
  }

  // Вычисляет новое значение sortIndex для баннера, вставленного на позицию newIndex
  // в списке list (после того, как он уже переставлен в этой позиции).
  // Берётся середина между соседями — как «150 между 100 и 200» — поэтому
  // все ОСТАЛЬНЫЕ баннеры остаются с прежними значениями, какая бы схема
  // нумерации (1,2,3 / 10,20,30 / 100,200,300) ни была на проекте раньше.
  const MIN_SORT = 100; // минимальное допустимое значение сортировки на проекте

  // Возвращает целое число для вставки строго между соседями (например 150
  // между 100 и 200), либо null, если места для целого числа не осталось
  // (соседи равны, стоят впритык, или упираемся в минимум 100) — в этом
  // случае вызывающий код сделает полный пересчёт списка.
  function computeInsertSort(list, newIndex) {
    const prev = list[newIndex - 1];
    const next = list[newIndex + 1];

    if (!prev && !next) return MIN_SORT; // единственный баннер в списке

    if (!prev) {
      // вставили в самое начало — но не ниже минимума
      const candidate = Math.round(next.sortIndex - SORT_STEP);
      if (candidate >= MIN_SORT && candidate < next.sortIndex) return candidate;
      if (next.sortIndex > MIN_SORT) return MIN_SORT; // есть хоть немного места над полом
      return null; // сосед и так уже на минимуме — целого места нет
    }

    if (!next) {
      return Math.round(prev.sortIndex + SORT_STEP); // вставили в самый конец
    }

    const gap = next.sortIndex - prev.sortIndex;
    if (gap >= 2) {
      const mid = Math.round((prev.sortIndex + next.sortIndex) / 2);
      if (mid > prev.sortIndex && mid < next.sortIndex) return mid;
    }
    // Соседи равны или стоят впритык (например много одинаковых sortIndex
    // в старых данных, или после многих вставок) — целого числа между ними
    // просто не существует.
    return null;
  }

  // Перенумеровывает ВЕСЬ список целыми значениями с чистым шагом SORT_STEP,
  // начиная с MIN_SORT (100, 200, 300 ...). Используется только как fallback,
  // когда точечная вставка невозможна (см. computeInsertSort выше), либо по
  // явному нажатию «Перенумеровать всё» — то есть когда без этого никак.
  async function renumberAll(list) {
    const changed = [];
    list.forEach((banner, i) => {
      const target = MIN_SORT + i * SORT_STEP;
      if (target !== banner.sortIndex) changed.push({ banner, target });
    });
    if (!changed.length) return false;

    // Баннеры без черновика — заранее одним запросом подтягиваем их полные
    // опубликованные документы, чтобы клонировать в черновик.
    const needIds = changed.filter((c) => !c.banner.hasDraft).map((c) => c.banner.editId);
    let fullDocsById = {};
    if (needIds.length) {
      const idsList = needIds.map((id) => `"${id}"`).join(',');
      const docs = await groqQuery(`*[_id in [${idsList}]]`);
      docs.forEach((d) => { fullDocsById[d._id] = d; });
    }

    const mutations = [];
    changed.forEach(({ banner, target }) => {
      let targetId = banner.editId;
      if (!banner.hasDraft) {
        const draftId = 'drafts.' + banner.baseId;
        const full = fullDocsById[banner.editId];
        if (full) mutations.push({ createIfNotExists: cloneForDraft(full, draftId) });
        targetId = draftId;
        banner.editId = draftId;
        banner.hasDraft = true;
      }
      mutations.push({ patch: { id: targetId, set: { sortIndex: target } } });
      banner.sortIndex = target;
    });

    await mutate(mutations);
    return true;
  }

  // ==================== ГОРОДА И ЗАВЕДЕНИЯ («скрыть везде, кроме») ====================
  // Sanity хранит только БЕЛЫЙ список: banner.cities (город целиком) и
  // banner.shops (отдельная точка); оба пустые = показывать везде. Прямого
  // способа сказать «показывать везде, кроме» в схеме нет — поэтому этот
  // блок держит список выбранного пользователем для СКРЫТИЯ отдельно в UI
  // и на сохранении пересчитывает его в эквивалентный белый список.

  let citiesShopsCache = null; // {cities:[{_id,name}], shops:[{_id,cityId,city,street,house}]} — грузится один раз за открытие модалки

  // Города без единой точки и точки без привязки к городу — это, как правило,
  // незаполненные до конца или брошенные карточки в справочнике, а не то, чем
  // реально управляют через баннеры. Они только загромождают список чекбоксов,
  // поэтому в UI не показываются вовсе. Если такая запись всё же УЖЕ выбрана
  // у какого-то баннера (banner.cityIds/shopIds) — это не теряется: см.
  // untouchedCityIds/untouchedShopIds в openGeoModal/saveGeoModal, они
  // проходят через сохранение как есть, в обход чекбокс-списка.
  async function fetchCitiesAndShops() {
    if (citiesShopsCache) return citiesShopsCache;
    const query = `{
      "cities": *[_type=="city"] | order(coalesce(sortIndex,0) asc, name.ru asc) {_id, "name": name.ru},
      "shops": *[_type=="shop"] | order(address.city.ru asc, address.street.ru asc) {
        _id,
        "cityId": address.cityRef._ref,
        "city": address.city.ru,
        "street": address.street.ru,
        "house": address.house.ru
      }
    }`;
    const raw = await groqQuery(query);
    const shops = raw.shops.filter((s) => s.cityId); // без города — не показываем
    const usedCityIds = new Set(shops.map((s) => s.cityId));
    const cities = raw.cities.filter((c) => usedCityIds.has(c._id)); // без точек — не показываем
    citiesShopsCache = { cities, shops };
    return citiesShopsCache;
  }

  function generateRefKey() {
    return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  function toWeakRefs(ids) {
    return ids.map((id) => ({ _type: 'reference', _ref: id, _weak: true, _key: generateRefKey() }));
  }

  // По текущему белому списку баннера (включённые города/точки) восстанавливает,
  // что пользователь, скорее всего, имел в виду как «скрытое»: город скрыт
  // целиком, если он не включён и ни одна его точка не включена отдельно;
  // если часть точек города всё же включена отдельно — скрыты только
  // оставшиеся точки этого города (а не весь город).
  function computeHiddenSelection(banner, citiesShops) {
    const includedCityIds = new Set(banner.cityIds);
    const includedShopIds = new Set(banner.shopIds);
    const hiddenCityIds = new Set();
    const hiddenShopIds = new Set();

    if (!includedCityIds.size && !includedShopIds.size) {
      // Оба поля пустые — баннер показывается везде, скрытого нет.
      return { hiddenCityIds, hiddenShopIds };
    }

    for (const city of citiesShops.cities) {
      if (includedCityIds.has(city._id)) continue; // город открыт целиком
      const shopsOfCity = citiesShops.shops.filter((s) => s.cityId === city._id);
      const anyShopIncluded = shopsOfCity.some((s) => includedShopIds.has(s._id));
      if (anyShopIncluded) {
        shopsOfCity.forEach((s) => { if (!includedShopIds.has(s._id)) hiddenShopIds.add(s._id); });
      } else {
        hiddenCityIds.add(city._id);
      }
    }
    citiesShops.shops
      .filter((s) => !s.cityId)
      .forEach((s) => { if (!includedShopIds.has(s._id)) hiddenShopIds.add(s._id); });

    return { hiddenCityIds, hiddenShopIds };
  }

  // Обратное преобразование — из набора скрытых городов/точек собирает белый
  // список для записи в Sanity. Возвращает null, если результат означал бы
  // «скрыть вообще везде»: пустой белый список Sanity трактует как ровно
  // противоположное («показывать везде»), поэтому такое состояние этим
  // инструментом сохранить нельзя.
  function computeAllowList(hiddenCityIds, hiddenShopIds, citiesShops) {
    if (!hiddenCityIds.size && !hiddenShopIds.size) {
      return { cityIds: [], shopIds: [] };
    }

    const cityIds = [];
    const shopIds = [];
    for (const city of citiesShops.cities) {
      if (hiddenCityIds.has(city._id)) continue;
      const shopsOfCity = citiesShops.shops.filter((s) => s.cityId === city._id);
      const hasHiddenShop = shopsOfCity.some((s) => hiddenShopIds.has(s._id));
      if (!hasHiddenShop) {
        cityIds.push(city._id);
      } else {
        shopsOfCity.forEach((s) => { if (!hiddenShopIds.has(s._id)) shopIds.push(s._id); });
      }
    }
    citiesShops.shops
      .filter((s) => !s.cityId)
      .forEach((s) => { if (!hiddenShopIds.has(s._id)) shopIds.push(s._id); });

    if (!cityIds.length && !shopIds.length) return null; // скрыто буквально всё
    return { cityIds, shopIds };
  }

  // Прямой (не инвертированный) режим «Показывать только здесь»: отмеченное —
  // это и есть белый список, никакого пересчёта не нужно. Единственная
  // подчистка — точки, чей город уже отмечен целиком, не дублируются в
  // shopIds (город и так их покрывает); а если отмечено вообще всё — пишем
  // пустые массивы, а не длинный список из всех городов, чтобы в самой
  // студии это по-прежнему читалось как «показывать везде».
  function buildShowAllowList(checkedCityIds, checkedShopIds, citiesShops) {
    const cityIds = citiesShops.cities.filter((c) => checkedCityIds.has(c._id)).map((c) => c._id);
    const shopIds = citiesShops.shops
      .filter((s) => checkedShopIds.has(s._id) && !(s.cityId && checkedCityIds.has(s.cityId)))
      .map((s) => s._id);

    const allCitiesChecked = cityIds.length === citiesShops.cities.length;
    const allNoCityShopsChecked = citiesShops.shops
      .filter((s) => !s.cityId)
      .every((s) => checkedShopIds.has(s._id));
    if (allCitiesChecked && allNoCityShopsChecked) return { cityIds: [], shopIds: [] };

    return { cityIds, shopIds };
  }

  // ==================== СТИЛИ ====================

  const STYLE = `
  :root {
    /* Акцентный цвет — единственное место, которое нужно поменять под общий
       брендовый цвет. Всё остальное (фокус, активные фильтры, обводки при
       наведении, включённые тумблеры) ссылается на эти переменные. */
    --sob-accent: #bd5b34;
    --sob-accent-hover: #9c4a29;
    --sob-accent-shadow: rgba(189, 91, 52, .35);
    --sob-accent-soft-bg: #f3e3da;
    --sob-accent-soft-border: #e0b89e;
    --sob-accent-soft-text: #7a3c1e;

    /* Тёплая нейтральная палитра модалки (светлая тема) */
    --sob-bg-page: #fbf9f5;
    --sob-bg-panel: #fffdfa;
    --sob-bg-subtle: #f2ede2;
    --sob-thumb-bg: #ece5d6;
    --sob-border: #e6dfd0;
    --sob-border-soft: #ece6d9;
    --sob-text-primary: #2b2620;
    --sob-text-secondary: #857e6f;
    --sob-text-tertiary: #a89f8c;
  }
  /* Тёмная тема — переопределяет те же переменные внутри модалки, поэтому
     весь остальной CSS (который везде ссылается на var(--sob-*)) трогать не
     пришлось: достаточно навесить класс на #sob-overlay. */
  #sob-overlay.sob-dark {
    --sob-accent: #d97a4f;
    --sob-accent-hover: #e8956d;
    --sob-accent-shadow: rgba(217, 122, 79, .4);
    --sob-accent-soft-bg: #4a2f22;
    --sob-accent-soft-border: #6b4530;
    --sob-accent-soft-text: #edb08a;
    --sob-bg-page: #211d17;
    --sob-bg-panel: #2b251d;
    --sob-bg-subtle: #332c22;
    --sob-thumb-bg: #3a3327;
    --sob-border: #443b2d;
    --sob-border-soft: #3a3327;
    --sob-text-primary: #f1ece1;
    --sob-text-secondary: #b8ae9c;
    --sob-text-tertiary: #8f8672;
  }
  /* У <button> в браузере есть свой UA-паддинг (в Chrome — 1px 6px) поверх
     заданного нами width/height (box-sizing тоже свой, border-box) — без
     сброса он незаметно съедает часть объявленной ширины/высоты, особенно
     заметно на маленьких квадратных кнопках вроде .sob-move-btn. Кнопки,
     которым нужен свой отступ (например .sob-filter-btn), просто объявляют
     padding сами и переопределяют этот сброс. */
  button { margin: 0; padding: 0; font: inherit; }
  #sob-nav-btn {
    display: inline-flex; align-items: center; gap: 6px; margin-left: 4px;
    background: var(--sob-accent); color: #fff; border: none; border-radius: 6px;
    padding: 0 14px; height: 33px; font-size: 13px; font-weight: 600; cursor: pointer;
    font-family: inherit; white-space: nowrap;
  }
  #sob-nav-btn:hover { background: var(--sob-accent-hover); }
  #sob-fab {
    position: fixed; bottom: 22px; right: 22px; z-index: 999998;
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--sob-accent); color: #fff; border: none; border-radius: 24px;
    padding: 11px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 6px 18px var(--sob-accent-shadow);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #sob-fab:hover { background: var(--sob-accent-hover); }
  .sob-icon { display: inline-flex; }
  .sob-icon svg { width: 20px; height: 20px; display: block; }
  #sob-overlay {
    position: fixed; inset: 0; background: rgba(23, 20, 14, 0.5);
    z-index: 999999; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #sob-modal {
    background: var(--sob-bg-page); width: min(1280px, 96vw); height: min(88vh, 960px);
    border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.3);
    display: flex; flex-direction: column; overflow: hidden;
    transition: background-color .3s ease;
  }
  #sob-header {
    display: flex; align-items: center; gap: 12px; padding: 14px 18px;
    background: var(--sob-bg-panel); border-bottom: 1px solid var(--sob-border); flex-shrink: 0;
    transition: background-color .3s ease, border-color .3s ease;
  }
  #sob-header h2 { font-size: 16px; margin: 0; color: var(--sob-text-primary); flex-shrink: 0; transition: color .3s ease; }
  #sob-search {
    flex: 1; padding: 8px 12px; border: 1px solid var(--sob-border); border-radius: 8px;
    font-size: 13px; outline: none; background: var(--sob-bg-panel); color: var(--sob-text-primary);
    transition: background-color .3s ease, border-color .3s ease, color .3s ease;
  }
  #sob-search:focus { border-color: var(--sob-accent); }
  .sob-filter-btn {
    border: 1px solid var(--sob-border); background: var(--sob-bg-panel); border-radius: 8px; padding: 7px 12px;
    font-size: 13px; cursor: pointer; color: var(--sob-text-primary); white-space: nowrap;
    transition: border-color .12s, background-color .3s ease, color .3s ease;
  }
  #sob-refresh, #sob-close {
    border: 1px solid var(--sob-border); background: var(--sob-bg-panel); border-radius: 8px; width: 34px; height: 34px;
    cursor: pointer; font-size: 15px; flex-shrink: 0; color: var(--sob-text-secondary);
    display: inline-flex; align-items: center; justify-content: center;
    transition: border-color .12s, background-color .3s ease, color .3s ease;
  }
  #sob-refresh:hover, #sob-close:hover, .sob-filter-btn:hover { border-color: var(--sob-accent); }

  /* Тройной переключатель "Все / Активные / Неактивные" — та же идея, что
     в button-14 из подборки Химали Сингха (флип цветной плашки поверх метки),
     только на 3 позиции вместо 2 и через radio, а не checkbox. */
  .sob-tri {
    position: relative; display: inline-flex; border: 1px solid var(--sob-border);
    border-radius: 8px; overflow: hidden; flex-shrink: 0;
  }
  .sob-tri input { position: absolute; width: 0; height: 0; opacity: 0; }
  .sob-tri-opt {
    position: relative; overflow: hidden; padding: 7px 12px; font-size: 13px;
    cursor: pointer; color: var(--sob-text-secondary); white-space: nowrap; background: var(--sob-bg-panel);
    transition: background-color .3s ease, border-color .3s ease;
  }
  .sob-tri-opt + .sob-tri-opt { border-left: 1px solid var(--sob-border); }
  .sob-tri-opt:hover .sob-tri-text { color: var(--sob-text-primary); }
  .sob-tri-fill {
    position: absolute; inset: 0; background: var(--sob-accent);
    transform: translateY(-100%);
    transition: transform .5s cubic-bezier(0.22, 1, 0.36, 1), background-color .3s ease;
    z-index: 1;
  }
  .sob-tri-text { position: relative; z-index: 2; transition: color .15s ease; }
  #sob-f-all:checked ~ label[for="sob-f-all"] .sob-tri-fill,
  #sob-f-on:checked ~ label[for="sob-f-on"] .sob-tri-fill,
  #sob-f-off:checked ~ label[for="sob-f-off"] .sob-tri-fill { transform: translateY(0); }
  #sob-f-all:checked ~ label[for="sob-f-all"] .sob-tri-text,
  #sob-f-on:checked ~ label[for="sob-f-on"] .sob-tri-text,
  #sob-f-off:checked ~ label[for="sob-f-off"] .sob-tri-text { color: #fff; }

  /* Переключатель темы — упрощённый вариант механики jkantner/xxyMYKg:
     там это два слоя с взаимно компенсирующимися сдвигами (солнце/луна едут
     в одну сторону, цветная маска — в другую, всё через em), рассчитанный на
     огромный масштаб (в оригинале шрифт демо-страницы — 60–120px). На нашей
     34-пиксельной кнопке та точная механика упирается в субпиксельные
     огрехи. Здесь та же идея (едущая цветная «шайба», солнце слева, луна
     справа), но всего один движущийся слой на фиксированных px: шайба едет
     под нужную иконку, а не наоборот — иконки вообще не двигаются, только
     меняют цвет под шайбой на белый. */
  .sob-theme-switch {
    position: relative; display: inline-flex; align-items: center; cursor: pointer;
    -webkit-tap-highlight-color: transparent; user-select: none; flex-shrink: 0;
  }
  .sob-theme-switch .switch__input {
    margin: 0; width: 68px; height: 34px; background-color: var(--sob-bg-panel);
    border: 1px solid var(--sob-border); border-radius: 8px; outline: transparent;
    -webkit-appearance: none; appearance: none; cursor: pointer;
    transition: background-color .3s ease, border-color .3s ease;
  }
  .sob-theme-switch .switch__input:checked { background-color: var(--sob-bg-subtle); }
  .sob-theme-switch .switch__input:focus-visible { box-shadow: 0 0 0 2px var(--sob-accent-shadow); }
  .sob-theme-switch .switch__icon {
    position: absolute; top: 50%; width: 14px; height: 14px; transform: translateY(-50%) rotate(0deg);
    pointer-events: none; z-index: 2; color: var(--sob-text-tertiary);
    transition: color .25s ease, transform .35s ease;
  }
  .sob-theme-switch .switch__icon--sun { left: 8px; }
  .sob-theme-switch .switch__icon--moon { right: 8px; }
  .sob-theme-switch .switch__input:not(:checked) ~ .switch__icon--sun {
    color: #fff; transform: translateY(-50%) rotate(360deg);
  }
  .sob-theme-switch .switch__input:checked ~ .switch__icon--moon {
    color: #fff; transform: translateY(-50%) rotate(360deg);
  }
  .sob-theme-switch .switch__knob {
    position: absolute; top: 4px; left: 3px; width: 26px; height: 26px; border-radius: 6px;
    background: var(--sob-accent); pointer-events: none; z-index: 1;
    transition: transform .3s cubic-bezier(0.65,0,0.35,1), background-color .3s ease;
  }
  .sob-theme-switch .switch__input:checked ~ .switch__knob { transform: translateX(36px); }
  .sob-theme-switch .switch__sr { overflow: hidden; position: absolute; width: 1px; height: 1px; }
  #sob-hint {
    padding: 12px 18px; font-size: 13px; line-height: 1.6; color: var(--sob-text-secondary);
    background: var(--sob-bg-subtle); border-bottom: 1px solid var(--sob-border); flex-shrink: 0;
    transition: background-color .3s ease, border-color .3s ease, color .3s ease;
  }
  #sob-hint p { margin: 0 0 8px; }
  #sob-hint p:last-child { margin-bottom: 0; }
  #sob-hint b { color: var(--sob-text-primary); transition: color .3s ease; }
  #sob-body { flex: 1; overflow-y: auto; padding: 16px 18px; background: var(--sob-bg-page); transition: background-color .3s ease; }
  #sob-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px; align-items: start;
  }
  .sob-card {
    background: var(--sob-bg-panel); border: 1px solid var(--sob-border-soft); border-radius: 10px; overflow: hidden;
    cursor: grab; position: relative;
    transition: box-shadow .15s, opacity .15s, background-color .3s ease, border-color .3s ease;
    display: flex; flex-direction: column;
  }
  .sob-card:hover { box-shadow: 0 4px 14px rgba(43,38,32,.10); }
  .sob-card.dragging { opacity: .35; }
  .sob-card.drag-over { outline: 2px dashed var(--sob-accent); outline-offset: -2px; }
  .sob-thumbs { position: relative; background: var(--sob-bg-subtle); transition: background-color .3s ease; }
  .sob-thumb-box {
    width: 100%; display: flex; align-items: center; justify-content: center;
    overflow: hidden; background: var(--sob-thumb-bg); transition: background-color .3s ease, border-color .3s ease;
  }
  .sob-thumb-box.h { height: 110px; }
  .sob-thumb-box.v { height: 230px; }
  .sob-thumb-box + .sob-thumb-box { border-top: 1px solid var(--sob-border); }
  .sob-thumb-box img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .sob-thumb-label {
    position: absolute; left: 6px; font-size: 9.5px; font-weight: 700; letter-spacing: .02em;
    text-transform: uppercase; color: #fff; background: rgba(0,0,0,.5); padding: 2px 6px;
    border-radius: 4px; pointer-events: none;
  }
  .sob-noimg {
    color: var(--sob-text-tertiary); font-size: 11px; text-align: center; padding: 8px; height: 110px;
    display: flex; align-items: center; justify-content: center; transition: color .3s ease;
  }
  .sob-rank {
    position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,.58); color: #fff;
    font-size: 13px; font-weight: 600; padding: 3px 8px; border-radius: 6px; line-height: 1.5; z-index: 2;
  }

  /* Переключатель активности баннера — механика 17-й кнопки из подборки
     Химали Сингха: один «жетон» (цветной блок + текст) едет по треку, при
     этом меняется и его цвет, и подпись (через content на ::before), и фон
     самой подложки (как .btn-bg в оригинале). Едет через transform, а не
     left — left триггерит layout на каждый кадр и дёргается при любой
     нагрузке на поток; transform всегда гладкий, даже во время запроса
     к Sanity. Переключается через прямую мутацию .checked существующего
     чекбокса (см. syncCardToggles) — если пересоздавать DOM на каждый клик,
     переходу физически не на чем анимироваться. */
  .sob-status {
    position: absolute; top: 6px; right: 6px; z-index: 2;
    width: 64px; height: 26px; border-radius: 7px; overflow: hidden;
    background: rgba(93, 45, 26, .55); cursor: pointer;
    transition: background-color .3s ease;
  }
  .sob-status:has(.sob-status-input:checked) { background: rgba(38, 56, 30, .55); }
  .sob-status-input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; z-index: 3; }
  .sob-status-chip {
    position: absolute; top: 3px; left: 3px; width: 28px; height: 20px; border-radius: 5px;
    background: var(--sob-accent); z-index: 1; transform: translateX(0);
    transition: transform .35s cubic-bezier(0.18, 0.89, 0.35, 1.15), background-color .3s ease;
  }
  .sob-status-input:checked ~ .sob-status-chip { transform: translateX(30px); background: #6b8e4e; }
  .sob-status-label {
    position: absolute; top: 3px; left: 3px; width: 28px; height: 20px; z-index: 2;
    display: flex; align-items: center; justify-content: center; pointer-events: none;
    transform: translateX(0);
    transition: transform .35s cubic-bezier(0.18, 0.89, 0.35, 1.15);
  }
  .sob-status-label::before {
    content: "OFF"; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; line-height: 1;
  }
  .sob-status-input:checked ~ .sob-status-label { transform: translateX(30px); }
  .sob-status-input:checked ~ .sob-status-label::before { content: "ON"; }
  .sob-draft-badge {
    position: absolute; bottom: 6px; left: 6px; font-size: 10px; font-weight: 600;
    padding: 2px 7px; border-radius: 20px; background: #e08a2b; color: #fff; z-index: 2;
  }
  .sob-body { padding: 9px 10px 10px; display: flex; flex-direction: column; gap: 7px; flex: 1; }
  .sob-title {
    font-size: 12.5px; font-weight: 600; color: var(--sob-text-primary); line-height: 1.3;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    min-height: 32px; transition: color .3s ease;
  }
  .sob-venues {
    font-size: 10.5px; color: var(--sob-text-secondary); line-height: 1.35; margin-top: -3px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    transition: color .3s ease;
  }
  .sob-toggles { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .sob-toggle {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10.5px; padding: 3px 7px; border-radius: 6px; border: 1px solid var(--sob-border);
    cursor: pointer; user-select: none; color: var(--sob-text-secondary); background: var(--sob-bg-subtle);
    transition: background-color .3s ease, border-color .3s ease, color .3s ease;
  }
  .sob-toggle svg { display: block; flex-shrink: 0; }
  .sob-toggle.on { background: var(--sob-accent-soft-bg); border-color: var(--sob-accent-soft-border); color: var(--sob-accent-soft-text); }
  .sob-toggle:hover { filter: brightness(0.97); }
  .sob-sortval { font-size: 11px; color: var(--sob-text-tertiary); margin-left: auto; white-space: nowrap; transition: color .3s ease; }
  .sob-sortrow { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: auto; }
  .sob-move-btn {
    width: 22px; height: 22px; border: 1px solid var(--sob-border); background: var(--sob-bg-panel); border-radius: 6px;
    cursor: pointer; color: var(--sob-text-secondary); display: flex; align-items: center; justify-content: center;
    line-height: 1; transition: border-color .12s, background-color .3s ease, color .3s ease;
  }
  .sob-move-btn svg { display: block; width: 20px; height: 20px; }
  .sob-move-btn:hover { border-color: var(--sob-accent); }
  .sob-move-btn:disabled { opacity: .3; cursor: default; }
  #sob-toast {
    position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
    background: #2b2620; color: #fff; padding: 14px 22px; border-radius: 10px; font-size: 15px;
    z-index: 1000001; opacity: 0; transition: opacity .2s; pointer-events: none;
  }
  #sob-toast.show { opacity: 1; }
  #sob-loading {
    display: flex; align-items: center; justify-content: center; height: 100%;
    color: var(--sob-text-secondary); font-size: 13px; transition: color .3s ease;
  }

  /* Окно «Города и заведения» — второй, вложенный оверлей поверх основной
     модалки (тот же паттерн overlay+modal, z-index выше). Один и тот же
     чек-лист городов/точек работает в двух режимах (см. .sob-geo-mode) —
     переключатель режима использует ту же механику флипа плашки, что и
     .sob-tri у фильтра статуса баннеров, просто на 2 позиции вместо 3. */
  #sob-geo-overlay {
    position: fixed; inset: 0; background: rgba(23, 20, 14, 0.5);
    z-index: 1000002; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #sob-geo-modal {
    background: var(--sob-bg-page); width: min(760px, 92vw); height: min(82vh, 740px);
    border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.3);
    display: flex; flex-direction: column; overflow: hidden;
  }
  #sob-geo-header {
    display: flex; align-items: center; gap: 10px; padding: 14px 18px;
    background: var(--sob-bg-panel); border-bottom: 1px solid var(--sob-border); flex-shrink: 0;
  }
  #sob-geo-header h3 { font-size: 14px; margin: 0; color: var(--sob-text-primary); flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #sob-geo-controls {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 12px 18px 0;
  }
  #sob-geo-mode-show:checked ~ label[for="sob-geo-mode-show"] .sob-tri-fill,
  #sob-geo-mode-hide:checked ~ label[for="sob-geo-mode-hide"] .sob-tri-fill { transform: translateY(0); }
  #sob-geo-mode-show:checked ~ label[for="sob-geo-mode-show"] .sob-tri-text,
  #sob-geo-mode-hide:checked ~ label[for="sob-geo-mode-hide"] .sob-tri-text { color: #fff; }
  #sob-geo-hint {
    margin: 12px 18px 0; padding: 10px 12px; font-size: 12.5px; line-height: 1.5;
    color: var(--sob-text-secondary); background: var(--sob-bg-subtle); border-radius: 8px;
  }
  #sob-geo-search {
    margin: 10px 18px 0; padding: 8px 12px; border: 1px solid var(--sob-border); border-radius: 8px;
    font-size: 13px; outline: none; background: var(--sob-bg-panel); color: var(--sob-text-primary);
  }
  #sob-geo-search:focus { border-color: var(--sob-accent); }
  #sob-geo-body { flex: 1; overflow-y: auto; padding: 10px 18px 16px; }
  .sob-geo-row {
    display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 6px;
    font-size: 13px; color: var(--sob-text-primary); cursor: pointer;
  }
  .sob-geo-row:hover { background: var(--sob-bg-subtle); }
  .sob-geo-row input { flex-shrink: 0; accent-color: var(--sob-accent); width: 15px; height: 15px; }
  .sob-geo-row.city { font-weight: 600; }
  .sob-geo-row.shop { padding-left: 26px; color: var(--sob-text-secondary); }
  #sob-geo-footer {
    display: flex; align-items: center; gap: 10px; padding: 12px 18px;
    border-top: 1px solid var(--sob-border); background: var(--sob-bg-panel); flex-shrink: 0;
  }
  #sob-geo-count { font-size: 12px; color: var(--sob-text-secondary); flex: 1; }
  #sob-geo-count.warn { color: #c0362c; font-weight: 600; }
  .sob-geo-btn-primary {
    background: var(--sob-accent); color: #fff; border: none; border-radius: 8px;
    padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
  }
  .sob-geo-btn-primary:hover { background: var(--sob-accent-hover); }
  .sob-geo-btn-primary:disabled { opacity: .5; cursor: default; }
  `;

  function injectStyle() {
    if (!document.head) return; // документ ещё не готов (document-start) — попробуем на следующем тике
    if (document.getElementById('sob-style')) return;
    const style = document.createElement('style');
    style.id = 'sob-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  // ==================== ВСПОМОГАТЕЛЬНОЕ ====================

  let toastTimer = null;
  function toast(msg, isError) {
    let el = document.getElementById('sob-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sob-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = isError ? '#c0362c' : '#2b2620';
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  function cdnUrl(url, extra) {
    if (!url) return null;
    return url + (url.includes('?') ? '&' : '?') + extra;
  }

  function formatSort(value) {
    // Округляем только для отображения — реальное значение, отправленное
    // в Sanity, остаётся точным (это важно для вставки «между» соседями).
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  // ==================== МОДАЛКА ====================

  let state = {
    banners: [],
    filter: 'all', // all | active | inactive
    search: '',
    saving: false,
  };

  function filteredBanners() {
    let list = state.banners;
    if (state.filter === 'active') list = list.filter((b) => b.status);
    if (state.filter === 'inactive') list = list.filter((b) => !b.status);
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      list = list.filter((b) => b.title.toLowerCase().includes(q));
    }
    return list;
  }

  function renderGrid() {
    const grid = document.getElementById('sob-grid');
    if (!grid) return;
    const list = filteredBanners();
    const filtering = list.length !== state.banners.length;

    grid.innerHTML = '';
    list.forEach((banner) => {
      const card = document.createElement('div');
      card.className = 'sob-card';
      card.draggable = !filtering; // сортировка доступна только когда не активны поиск/фильтр
      card.dataset.baseId = banner.baseId;

      const globalIndex = state.banners.indexOf(banner);
      const hImg = cdnUrl(banner.thumbH, 'w=440&fit=max&auto=format');
      const vImg = cdnUrl(banner.thumbV, 'w=300&fit=max&auto=format');

      let thumbsHtml = '';
      if (hImg) {
        thumbsHtml += `<div class="sob-thumb-box h"><img src="${hImg}" loading="lazy" alt=""><span class="sob-thumb-label" style="bottom:4px;">гориз.</span></div>`;
      }
      if (vImg) {
        thumbsHtml += `<div class="sob-thumb-box v"><img src="${vImg}" loading="lazy" alt=""><span class="sob-thumb-label" style="bottom:4px;">верт.</span></div>`;
      }
      if (!thumbsHtml) {
        thumbsHtml = `<div class="sob-noimg">Нет превью</div>`;
      }

      const venuesHtml = banner.venues.length
        ? `<div class="sob-venues" title="${banner.venues.join('; ').replace(/"/g, '&quot;')}">📍 ${banner.venues.join(' · ')}</div>`
        : '';

      card.innerHTML = `
        <div class="sob-thumbs">
          <div class="sob-rank">#${globalIndex + 1}</div>
          <div class="sob-status" title="Клик — переключить активность">
            <input type="checkbox" class="sob-status-input" ${banner.status ? 'checked' : ''}>
            <span class="sob-status-chip"></span>
            <span class="sob-status-label"></span>
          </div>
          ${banner.hasDraft ? `<div class="sob-draft-badge">есть черновик</div>` : ''}
          ${thumbsHtml}
        </div>
        <div class="sob-body">
          <div class="sob-title" title="${banner.title.replace(/"/g, '&quot;')}">${banner.title}</div>
          ${venuesHtml}
          <div class="sob-toggles">
            <div class="sob-toggle site ${banner.showInWeb ? 'on' : ''}">${ICON_WEBSITE} Сайт</div>
            <div class="sob-toggle app ${banner.showInApplication ? 'on' : ''}">${ICON_MOBILE} Прил.</div>
            <div class="sob-toggle geo" title="Города и заведения">${ICON_PIN} Гео</div>
            <div class="sob-sortval">Сорт.: ${formatSort(banner.sortIndex)}</div>
          </div>
          <div class="sob-sortrow">
            <button class="sob-move-btn up" ${filtering || globalIndex === 0 ? 'disabled' : ''} title="${filtering ? 'Недоступно при активном поиске/фильтре' : 'Раньше в очереди'}">${ICON_ARROW_LEFT}</button>
            <button class="sob-move-btn down" ${filtering || globalIndex === state.banners.length - 1 ? 'disabled' : ''} title="${filtering ? 'Недоступно при активном поиске/фильтре' : 'Позже в очереди'}">${ICON_ARROW_RIGHT}</button>
          </div>
        </div>
      `;

      card.querySelector('.sob-status').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleField(banner, 'status');
      });
      card.querySelector('.sob-toggle.site').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleField(banner, 'showInWeb');
      });
      card.querySelector('.sob-toggle.app').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleField(banner, 'showInApplication');
      });
      card.querySelector('.sob-toggle.geo').addEventListener('click', (e) => {
        e.stopPropagation();
        openGeoModal(banner);
      });

      card.querySelector('.sob-move-btn.up').addEventListener('click', (e) => {
        e.stopPropagation();
        moveBanner(globalIndex, globalIndex - 1);
      });
      card.querySelector('.sob-move-btn.down').addEventListener('click', (e) => {
        e.stopPropagation();
        moveBanner(globalIndex, globalIndex + 1);
      });

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', String(globalIndex));
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = globalIndex;
        if (from !== to) moveBanner(from, to);
      });

      grid.appendChild(card);
    });

    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--sob-text-tertiary);padding:40px 0;">Ничего не найдено</div>`;
    }
  }

  // Точечно обновляет уже отрисованные переключатели одной карточки, не
  // трогая остальной DOM. Полный renderGrid() тут не годится: он сносит и
  // создаёт заново весь чекбокс/тумблеры, а свежесозданный элемент рождается
  // сразу в конечном состоянии — CSS-переходу банально не на чем играть.
  function syncCardToggles(banner) {
    const card = document.querySelector(`.sob-card[data-base-id="${CSS.escape(banner.baseId)}"]`);
    if (!card) return;
    const statusInput = card.querySelector('.sob-status-input');
    if (statusInput) statusInput.checked = banner.status;
    const siteToggle = card.querySelector('.sob-toggle.site');
    if (siteToggle) siteToggle.classList.toggle('on', banner.showInWeb);
    const appToggle = card.querySelector('.sob-toggle.app');
    if (appToggle) appToggle.classList.toggle('on', banner.showInApplication);
  }

  async function toggleField(banner, field) {
    if (state.saving) return;
    const prev = banner[field];
    banner[field] = !prev;
    syncCardToggles(banner);
    state.saving = true;
    try {
      await patchBanner(banner, { [field]: banner[field] });
      renderGrid(); // чтобы сразу показать бейдж «черновик», если он появился
      toast('Сохранено в черновик — не забудьте опубликовать в студии');
    } catch (err) {
      banner[field] = prev;
      renderGrid();
      toast('Ошибка сохранения: ' + err.message, true);
    } finally {
      state.saving = false;
    }
  }

  async function moveBanner(fromIdx, toIdx) {
    if (state.saving) return;
    if (toIdx < 0 || toIdx >= state.banners.length) return;
    const list = state.banners;
    const [item] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);

    const newSort = computeInsertSort(list, toIdx);
    state.saving = true;

    if (newSort !== null) {
      item.sortIndex = newSort;
      renderGrid();
      toast('Сохраняю позицию…');
      try {
        await patchBanner(item, { sortIndex: newSort });
        toast(`Готово: sort ${newSort} — остальные баннеры не тронуты`);
        renderGrid();
      } catch (err) {
        toast('Ошибка сохранения порядка: ' + err.message, true);
      } finally {
        state.saving = false;
      }
      return;
    }

    // Целого числа между соседями нет (упёрлись в минимум 100 или соседи
    // стоят впритык/равны) — аккуратно перенумеровываем весь список чистыми
    // целыми значениями с шагом 100. Это единственный случай, когда меняется
    // больше одного баннера.
    renderGrid();
    toast('Не осталось места между соседями — пересчитываю порядок всего списка…');
    try {
      await renumberAll(list);
      toast('Список перенумерован целыми значениями с шагом 100');
      renderGrid();
    } catch (err) {
      toast('Ошибка сохранения порядка: ' + err.message, true);
    } finally {
      state.saving = false;
    }
  }

  async function loadAndRender() {
    const body = document.getElementById('sob-body');
    body.innerHTML = `<div id="sob-loading">Загружаю баннеры…</div>`;
    try {
      // Общий страховочный таймаут — если что-то зависнет (например, сеть или
      // прерванная навигация), модалка не будет висеть на «Загружаю…» вечно.
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Превышено время ожидания (12с)')), 12000)
      );
      state.banners = await Promise.race([fetchBanners(), timeout]);
      body.innerHTML = `<div id="sob-grid"></div>`;
      renderGrid();
    } catch (err) {
      body.innerHTML = `
        <div id="sob-loading" style="flex-direction:column;gap:10px;">
          <div>Ошибка загрузки: ${err.message}</div>
          <button id="sob-retry" class="sob-filter-btn">Повторить</button>
        </div>
      `;
      document.getElementById('sob-retry')?.addEventListener('click', loadAndRender);
    }
  }

  function openModal() {
    if (document.getElementById('sob-overlay')) return;
    injectStyle();

    const overlay = document.createElement('div');
    overlay.id = 'sob-overlay';
    overlay.innerHTML = `
      <div id="sob-modal">
        <div id="sob-header">
          <h2>Баннеры</h2>
          <input id="sob-search" type="text" placeholder="Поиск по названию…" />
          <div class="sob-tri">
            <input type="radio" name="sob-filter-radio" id="sob-f-all" checked>
            <input type="radio" name="sob-filter-radio" id="sob-f-on">
            <input type="radio" name="sob-filter-radio" id="sob-f-off">
            <label for="sob-f-all" class="sob-tri-opt" data-filter="all"><span class="sob-tri-fill"></span><span class="sob-tri-text">Все</span></label>
            <label for="sob-f-on" class="sob-tri-opt" data-filter="active"><span class="sob-tri-fill"></span><span class="sob-tri-text">Активные</span></label>
            <label for="sob-f-off" class="sob-tri-opt" data-filter="inactive"><span class="sob-tri-fill"></span><span class="sob-tri-text">Неактивные</span></label>
          </div>
          <button id="sob-renumber" class="sob-filter-btn" title="Пересчитать sort у всех баннеров целыми значениями с шагом 100">Перенумеровать всё</button>
          <button id="sob-refresh" title="Обновить">⟳</button>
          <label class="sob-theme-switch" title="Переключить тему">
            <span class="switch__sr">Тёмная тема</span>
            <input type="checkbox" class="switch__input" id="sob-theme-toggle">
            ${ICON_SUN}${ICON_MOON}
            <span class="switch__knob"></span>
          </label>
          <button id="sob-close" title="Закрыть">✕</button>
        </div>
        <div id="sob-hint">
          <p>Перетащите превью, чтобы изменить порядок, либо используйте кнопки ◀▶. Кнопки недоступны при активном поиске или
          фильтре — порядок в них относится к полному списку, а не к отфильтрованному.</p>
          <p>Новое целое значение sort (минимум 100) ставится ровно между соседями — например 150 между 100 и 200, —
          и <b>меняется только у перемещённого баннера</b>. Если целого числа между соседями не осталось (несколько баннеров с
          одинаковым sort), весь список автоматически пересчитывается с шагом 100; то же можно сделать вручную кнопкой
          «Перенумеровать всё».</p>
          <p>Клик по бейджу «Активен/Неактивен» переключает активность баннера, клик по «🌐 Сайт» / «📱 Прил.» — видимость.
          Все изменения сохраняются как <b>неопубликованные черновики</b> (бейдж «есть черновик» на карточке) — опубликуйте
          баннер вручную в студии, когда будете готовы.</p>
        </div>
        <div id="sob-body"></div>
      </div>
    `;
    overlay.classList.toggle('sob-dark', getStoredTheme() === 'dark');
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.getElementById('sob-close').addEventListener('click', closeModal);
    document.getElementById('sob-refresh').addEventListener('click', () => {
      citiesShopsCache = null; // на «Обновить» также подтягиваем свежий список городов/точек
      loadAndRender();
    });
    const themeInput = document.getElementById('sob-theme-toggle');
    themeInput.checked = getStoredTheme() === 'dark';
    themeInput.addEventListener('change', () => {
      const next = themeInput.checked ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, next);
      overlay.classList.toggle('sob-dark', next === 'dark');
    });
    document.getElementById('sob-renumber').addEventListener('click', async () => {
      if (state.saving) return;
      state.saving = true;
      toast('Перенумеровываю всё…');
      try {
        const changed = await renumberAll(state.banners);
        toast(changed ? 'Готово: целые значения с шагом 100 от 100' : 'Уже всё аккуратно — менять нечего');
        renderGrid();
      } catch (err) {
        toast('Ошибка: ' + err.message, true);
      } finally {
        state.saving = false;
      }
    });

    document.getElementById('sob-search').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderGrid();
    });

    overlay.querySelectorAll('.sob-tri-opt').forEach((label) => {
      const input = document.getElementById(label.getAttribute('for'));
      input.addEventListener('change', () => {
        state.filter = label.dataset.filter;
        renderGrid();
      });
    });

    document.addEventListener('keydown', escListener);

    loadAndRender();
  }

  function escListener(e) {
    if (e.key === 'Escape') closeModal();
  }

  function closeModal() {
    const overlay = document.getElementById('sob-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', escListener);
  }

  // ==================== ОКНО «ГОРОДА И ЗАВЕДЕНИЯ» ====================
  // Один и тот же чек-лист городов/точек работает в двух режимах:
  //  - "show" — прямой белый список («показывать только здесь»);
  //  - "hide" — инвертированный («показывать везде, кроме отмеченного»).
  // checkedCityIds/checkedShopIds хранят именно то, что отмечено галочками —
  // смысл этих отметок (включить или исключить) зависит только от режима.
  // При переключении режима отметки пересчитываются через те же функции
  // computeHiddenSelection/computeAllowList, что и при сохранении — так
  // выбор не теряется, когда передумал на середине.

  let geoModalState = null; // { banner, citiesShops, mode, checkedCityIds, checkedShopIds, search }

  async function openGeoModal(banner) {
    if (document.getElementById('sob-geo-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'sob-geo-overlay';
    overlay.innerHTML = `
      <div id="sob-geo-modal">
        <div id="sob-geo-header">
          <h3>Города и заведения — «${banner.title.replace(/</g, '&lt;')}»</h3>
          <button id="sob-geo-close" class="sob-filter-btn" title="Закрыть">✕</button>
        </div>
        <div id="sob-geo-controls">
          <div class="sob-tri">
            <input type="radio" name="sob-geo-mode-radio" id="sob-geo-mode-show" checked>
            <input type="radio" name="sob-geo-mode-radio" id="sob-geo-mode-hide">
            <label for="sob-geo-mode-show" class="sob-tri-opt"><span class="sob-tri-fill"></span><span class="sob-tri-text">Показывать только здесь</span></label>
            <label for="sob-geo-mode-hide" class="sob-tri-opt"><span class="sob-tri-fill"></span><span class="sob-tri-text">Показывать везде, кроме</span></label>
          </div>
          <button id="sob-geo-select-all" class="sob-filter-btn">Отметить всё</button>
          <button id="sob-geo-select-none" class="sob-filter-btn">Снять всё</button>
        </div>
        <div id="sob-geo-hint"></div>
        <input id="sob-geo-search" type="text" placeholder="Поиск по городу или адресу…" />
        <div id="sob-geo-body"><div id="sob-loading">Загружаю города и точки…</div></div>
        <div id="sob-geo-footer">
          <span id="sob-geo-count"></span>
          <button id="sob-geo-save" class="sob-geo-btn-primary" disabled>Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGeoModal(); });
    document.getElementById('sob-geo-close').addEventListener('click', closeGeoModal);
    let geoSearchTimer = null;
    document.getElementById('sob-geo-search').addEventListener('input', (e) => {
      const value = e.target.value;
      clearTimeout(geoSearchTimer);
      // Небольшая задержка, чтобы при быстром наборе не перестраивать весь
      // список чекбоксов на каждое нажатие клавиши — не критично на текущих
      // объёмах (сотни точек), но дешёвая подстраховка на случай роста.
      geoSearchTimer = setTimeout(() => {
        geoModalState.search = value;
        renderGeoBody();
      }, 150);
    });
    document.getElementById('sob-geo-select-all').addEventListener('click', () => {
      const st = geoModalState;
      st.citiesShops.cities.forEach((c) => st.checkedCityIds.add(c._id));
      st.citiesShops.shops.forEach((s) => st.checkedShopIds.add(s._id));
      renderGeoBody();
    });
    document.getElementById('sob-geo-select-none').addEventListener('click', () => {
      geoModalState.checkedCityIds.clear();
      geoModalState.checkedShopIds.clear();
      renderGeoBody();
    });
    document.getElementById('sob-geo-mode-show').addEventListener('change', () => switchGeoMode('show'));
    document.getElementById('sob-geo-mode-hide').addEventListener('change', () => switchGeoMode('hide'));
    document.getElementById('sob-geo-save').addEventListener('click', saveGeoModal);
    document.addEventListener('keydown', geoEscListener);

    try {
      const citiesShops = await fetchCitiesAndShops();
      // Города/точки, отфильтрованные из выдачи (см. fetchCitiesAndShops), но
      // уже выбранные у этого баннера — оставляем как есть, не показывая
      // чекбоксом и не давая инструменту их случайно потерять при сохранении.
      const visibleCityIds = new Set(citiesShops.cities.map((c) => c._id));
      const visibleShopIds = new Set(citiesShops.shops.map((s) => s._id));
      const untouchedCityIds = banner.cityIds.filter((id) => !visibleCityIds.has(id));
      const untouchedShopIds = banner.shopIds.filter((id) => !visibleShopIds.has(id));
      geoModalState = {
        banner,
        citiesShops,
        mode: 'show',
        checkedCityIds: new Set(banner.cityIds.filter((id) => visibleCityIds.has(id))),
        checkedShopIds: new Set(banner.shopIds.filter((id) => visibleShopIds.has(id))),
        untouchedCityIds,
        untouchedShopIds,
        search: '',
      };
      updateGeoHint();
      renderGeoBody();
    } catch (err) {
      document.getElementById('sob-geo-body').innerHTML =
        `<div id="sob-loading">Ошибка загрузки: ${err.message}</div>`;
    }
  }

  function geoEscListener(e) {
    if (e.key === 'Escape') closeGeoModal();
  }

  function closeGeoModal() {
    const overlay = document.getElementById('sob-geo-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', geoEscListener);
    geoModalState = null;
  }

  function switchGeoMode(newMode) {
    const st = geoModalState;
    if (!st || st.mode === newMode) return;

    if (newMode === 'hide') {
      // show -> hide: то, что было отмечено как «показывать», переводим
      // в эквивалентное «что скрыто» — тем же способом, каким читаем
      // существующие данные баннера при открытии окна.
      const fakeBanner = { cityIds: [...st.checkedCityIds], shopIds: [...st.checkedShopIds] };
      const { hiddenCityIds, hiddenShopIds } = computeHiddenSelection(fakeBanner, st.citiesShops);
      st.checkedCityIds = hiddenCityIds;
      st.checkedShopIds = hiddenShopIds;
    } else {
      // hide -> show: наоборот, разворачиваем «что скрыто» в белый список.
      const allowList = computeAllowList(st.checkedCityIds, st.checkedShopIds, st.citiesShops);
      if (allowList === null) {
        // «Скрыто вообще всё» нельзя представить как непустой белый список —
        // осмысленного перевода нет, начинаем с чистого листа в новом режиме.
        toast('Состояние «скрыто всё» нельзя показать как список «только здесь» — отметьте заново.', true);
        st.checkedCityIds = new Set();
        st.checkedShopIds = new Set();
      } else {
        st.checkedCityIds = new Set(allowList.cityIds);
        st.checkedShopIds = new Set(allowList.shopIds);
      }
    }

    st.mode = newMode;
    updateGeoHint();
    renderGeoBody();
  }

  function updateGeoHint() {
    const hint = document.getElementById('sob-geo-hint');
    if (!hint) return;
    hint.innerHTML = geoModalState.mode === 'show'
      ? 'Отметьте города и точки, где баннер <b>должен</b> показываться. Если не отмечено ничего — показывается везде.'
      : 'Отметьте города и точки, где баннер <b>не должен</b> показываться — остальные включатся автоматически.';
  }

  function renderGeoBody() {
    if (!geoModalState) return;
    const { citiesShops, checkedCityIds, checkedShopIds, search } = geoModalState;
    const body = document.getElementById('sob-geo-body');
    const q = search.trim().toLowerCase();

    const rows = [];
    citiesShops.cities.forEach((city) => {
      const shopsOfCity = citiesShops.shops.filter((s) => s.cityId === city._id);
      const cityMatches = !q || city.name.toLowerCase().includes(q);
      const matchingShops = shopsOfCity.filter(
        (s) => !q || cityMatches || [s.city, s.street, s.house].filter(Boolean).join(' ').toLowerCase().includes(q)
      );
      if (!cityMatches && !matchingShops.length) return;

      rows.push(`
        <label class="sob-geo-row city">
          <input type="checkbox" data-kind="city" data-id="${city._id}" ${checkedCityIds.has(city._id) ? 'checked' : ''}>
          ${city.name.replace(/</g, '&lt;')}
        </label>
      `);
      // Точки города имеет смысл показывать точечно только когда сам город не
      // отмечен целиком (иначе это лишний шум — они и так уже все включены
      // или все скрыты вместе с городом, в зависимости от режима).
      if (!checkedCityIds.has(city._id)) {
        (cityMatches ? shopsOfCity : matchingShops).forEach((s) => {
          const label = [s.street, s.house].filter(Boolean).join(', ') || '(без адреса)';
          rows.push(`
            <label class="sob-geo-row shop">
              <input type="checkbox" data-kind="shop" data-id="${s._id}" ${checkedShopIds.has(s._id) ? 'checked' : ''}>
              ${label.replace(/</g, '&lt;')}
            </label>
          `);
        });
      }
    });

    body.innerHTML = rows.length
      ? rows.join('')
      : `<div style="text-align:center;color:var(--sob-text-tertiary);padding:30px 0;">Ничего не найдено</div>`;

    body.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => {
        const set = input.dataset.kind === 'city' ? checkedCityIds : checkedShopIds;
        if (input.checked) set.add(input.dataset.id);
        else set.delete(input.dataset.id);
        if (input.dataset.kind === 'city') renderGeoBody(); // город раскрыл/спрятал свои точки в списке
        else updateGeoFooter();
      });
    });
    updateGeoFooter();
  }

  function updateGeoFooter() {
    const { mode, citiesShops, checkedCityIds, checkedShopIds } = geoModalState;
    const cityCount = checkedCityIds.size;
    const shopCount = checkedShopIds.size;
    const countEl = document.getElementById('sob-geo-count');
    const saveBtn = document.getElementById('sob-geo-save');

    if (mode === 'hide' && (cityCount || shopCount) && computeAllowList(checkedCityIds, checkedShopIds, citiesShops) === null) {
      countEl.textContent = '⚠ Нельзя скрыть баннер вообще везде — снимите хотя бы одну отметку';
      countEl.classList.add('warn');
      saveBtn.disabled = true;
      return;
    }
    countEl.classList.remove('warn');

    if (!cityCount && !shopCount) {
      countEl.textContent = mode === 'hide'
        ? 'Ничего не скрыто — баннер будет показываться везде'
        : 'Ничего не отмечено — баннер будет показываться везде';
    } else {
      countEl.textContent = (mode === 'hide' ? 'Скрыто' : 'Показывается') + `: городов — ${cityCount}, точек — ${shopCount}`;
    }
    saveBtn.disabled = false;
  }

  async function saveGeoModal() {
    const { banner, mode, citiesShops, checkedCityIds, checkedShopIds, untouchedCityIds, untouchedShopIds } = geoModalState;
    let allowList;
    if (mode === 'hide') {
      allowList = computeAllowList(checkedCityIds, checkedShopIds, citiesShops);
      if (allowList === null) {
        toast('Так нельзя скрыть баннер вообще везде — пустой список Sanity читает как «показывать везде». Выключите переключатель «Активный», «Сайт» или «Прил.», если нужно скрыть баннер полностью.', true);
        return;
      }
    } else {
      allowList = buildShowAllowList(checkedCityIds, checkedShopIds, citiesShops);
    }

    const saveBtn = document.getElementById('sob-geo-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохраняю…';
    try {
      await patchBanner(banner, {
        cities: toWeakRefs([...allowList.cityIds, ...untouchedCityIds]),
        shops: toWeakRefs([...allowList.shopIds, ...untouchedShopIds]),
      });
      toast('Сохранено в черновик — не забудьте опубликовать в студии');
      closeGeoModal();
      await loadAndRender(); // подтянуть свежие cityIds/shopIds/venues для карточки
    } catch (err) {
      toast('Ошибка сохранения: ' + err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить';
    }
  }

  // ==================== КНОПКА В ШАПКЕ (рядом со Schedules) ====================
  // Studio — это SPA: переход между Structure/Vision/Media/Schedules и между
  // баннерами не перезагружает страницу, поэтому кнопку нужно постоянно
  // держать синхронизированной с текущим маршрутом (опрос вместо разовой вставки).

  function findNavContainer() {
    const link = Array.from(document.querySelectorAll('a')).find(
      (a) => a.textContent.trim() === 'Schedules'
    );
    return link ? link.parentElement : null;
  }

  // currentColor — иконка автоматически принимает цвет текста кнопки,
  // отдельно её красить не нужно даже при смене --sob-accent.
  const ICON_SVG = '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M196,80v32a4,4,0,0,1-8,0V84H160a4,4,0,0,1,0-8h32A4.0002,4.0002,0,0,1,196,80ZM96,172H68V144a4,4,0,0,0-8,0v32a4.0002,4.0002,0,0,0,4,4H96a4,4,0,0,0,0-8ZM228,56V200a12.01312,12.01312,0,0,1-12,12H40a12.01312,12.01312,0,0,1-12-12V56A12.01312,12.01312,0,0,1,40,44H216A12.01312,12.01312,0,0,1,228,56Zm-8,0a4.004,4.004,0,0,0-4-4H40a4.004,4.004,0,0,0-4,4V200a4.004,4.004,0,0,0,4,4H216a4.004,4.004,0,0,0,4-4Z"/></svg>';

  // Иконки для переключателя темы (солнце/луна) — не двигаются, только
  // меняют цвет под цветной шайбой (см. .switch__icon в стилях).
  const ICON_SUN = '<svg class="switch__icon switch__icon--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const ICON_MOON = '<svg class="switch__icon switch__icon--moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  // Стрелки сортировки (◀/▶) и иконки каналов показа (сайт/приложение) —
  // те же svg, что прислал пользователь, с fill/stroke заменённым на currentColor.
  // viewBox обрезан вплотную к самой фигуре (с учётом нахлёста stroke-width),
  // а не «0 0 24 24» с запасом по краям — иначе при масштабировании до 20px
  // нецелый коэффициент даёт разный поднапиксельный сдвиг сверху/справа и
  // снизу/слева (было 4px и 5px вместо одинаковых отступов).
  const ICON_ARROW_LEFT = '<svg viewBox="3 3 18 18" width="20" height="20" aria-hidden="true"><path d="M11 9L8 12M8 12L11 15M8 12H16M7.2 20H16.8C17.9201 20 18.4802 20 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.782 18.908C20 18.4802 20 17.9201 20 16.8V7.2C20 6.0799 20 5.51984 19.782 5.09202C19.5903 4.71569 19.2843 4.40973 18.908 4.21799C18.4802 4 17.9201 4 16.8 4H7.2C6.0799 4 5.51984 4 5.09202 4.21799C4.71569 4.40973 4.40973 4.71569 4.21799 5.09202C4 5.51984 4 6.07989 4 7.2V16.8C4 17.9201 4 18.4802 4.21799 18.908C4.40973 19.2843 4.71569 19.5903 5.09202 19.782C5.51984 20 6.07989 20 7.2 20Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
  const ICON_ARROW_RIGHT = '<svg viewBox="3 3 18 18" width="20" height="20" aria-hidden="true"><path d="M13 15L16 12M16 12L13 9M16 12H8M7.2 20H16.8C17.9201 20 18.4802 20 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.782 18.908C20 18.4802 20 17.9201 20 16.8V7.2C20 6.0799 20 5.51984 19.782 5.09202C19.5903 4.71569 19.2843 4.40973 18.908 4.21799C18.4802 4 17.9201 4 16.8 4H7.2C6.0799 4 5.51984 4 5.09202 4.21799C4.71569 4.40973 4.40973 4.71569 4.21799 5.09202C4 5.51984 4 6.07989 4 7.2V16.8C4 17.9201 4 18.4802 4.21799 18.908C4.40973 19.2843 4.71569 19.5903 5.09202 19.782C5.51984 20 6.07989 20 7.2 20Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
  const ICON_WEBSITE = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(3,4)"><rect x="7" y="12" width="5" height="4.5"/><rect x="0" y="0" width="19" height="12" rx="1"/><line x1="8.5" y1="9.5" x2="10.5" y2="9.5"/><line x1="4.5" y1="16.5" x2="14.5" y2="16.5"/></g></svg>';
  const ICON_MOBILE = '<svg viewBox="0 0 32 32" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M22 1.25h-12c-1.518 0.002-2.748 1.232-2.75 2.75v24c0.002 1.518 1.232 2.748 2.75 2.75h12c1.518-0.002 2.748-1.232 2.75-2.75v-24c-0.002-1.518-1.232-2.748-2.75-2.75h-0zM23.25 28c-0.001 0.69-0.56 1.249-1.25 1.25h-12c-0.69-0.001-1.249-0.56-1.25-1.25v-24c0.001-0.69 0.56-1.249 1.25-1.25h12c0.69 0.001 1.249 0.56 1.25 1.25v0zM15.3 25.299c-0.185 0.173-0.3 0.418-0.3 0.69 0 0.004 0 0.008 0 0.012v-0.001c-0 0.004-0 0.009-0 0.014 0 0.277 0.115 0.527 0.3 0.704l0 0c0.176 0.185 0.424 0.301 0.7 0.301s0.524-0.115 0.699-0.3l0-0c0.186-0.178 0.301-0.429 0.301-0.706 0-0.004-0-0.009-0-0.013v0.001c0-0.003 0-0.007 0-0.010 0-0.273-0.116-0.518-0.3-0.69l-0.001-0.001c-0.181-0.176-0.427-0.284-0.7-0.284s-0.519 0.108-0.7 0.284l0-0z"/></svg>';
  const ICON_PIN = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 2C7.86 2 4.5 5.36 4.5 9.5c0 5.25 6.5 12 7 12.5.5-.5 7-7.25 7-12.5C18.5 5.36 15.14 2 12 2zm0 10.25a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5z"/></svg>';

  // Тема хранится в localStorage и переживает переоткрытие модалки.
  const THEME_KEY = 'sob-theme';
  function getStoredTheme() {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  }

  function createNavButton() {
    const btn = document.createElement('button');
    btn.id = 'sob-nav-btn';
    btn.type = 'button';
    btn.innerHTML = `<span class="sob-icon">${ICON_SVG}</span> Баннеры`;
    btn.addEventListener('click', openModal);
    return btn;
  }

  function createFallbackFab() {
    const btn = document.createElement('button');
    btn.id = 'sob-fab';
    btn.type = 'button';
    btn.innerHTML = `<span class="sob-icon">${ICON_SVG}</span> Баннеры: превью и сортировка`;
    btn.addEventListener('click', openModal);
    return btn;
  }

  // Даём тулбару время отрисоваться (обычно доли секунды) и только если он
  // так и не появился спустя разумное время — показываем плавающую кнопку.
  // Раньше фолбэк показывался сразу и потом «мигал», перескакивая наверх —
  // это и есть та вспышка кнопки внизу справа, которую было видно при обычной загрузке.
  const FALLBACK_GRACE_MS = 2500;
  let bannersRouteSince = null;

  function syncButton() {
    if (!document.body) return; // документ ещё не готов (document-start) — попробуем на следующем тике
    const shouldShow = isBannersRoute();
    const navBtn = document.getElementById('sob-nav-btn');
    const fab = document.getElementById('sob-fab');

    if (!shouldShow) {
      bannersRouteSince = null;
      if (navBtn) navBtn.remove();
      if (fab) fab.remove();
      return;
    }

    if (bannersRouteSince === null) bannersRouteSince = Date.now();

    injectStyle();
    const container = findNavContainer();

    if (container) {
      // Кнопка встраивается в шапку сразу после «Schedules».
      if (fab) fab.remove();
      if (!navBtn || navBtn.parentElement !== container) {
        if (navBtn) navBtn.remove();
        container.appendChild(createNavButton());
      }
      return;
    }

    // Тулбар ещё не отрисовался — ждём, не показывая ничего преждевременно.
    if (Date.now() - bannersRouteSince > FALLBACK_GRACE_MS && !fab) {
      document.body.appendChild(createFallbackFab());
    }
  }

  setInterval(syncButton, 250);
  syncButton();
})();
    });
  });

  // ===== Модуль: pages (sanity-page-editor/sanity-page-editor.user.js, v0.6.3) — после загрузки DOM
  whenReady(function () {
    runModule('pages', function () {
(function () {
  'use strict';

  // ===================================================================
  // 1. Окружение и API
  // ===================================================================
  const API_VER = 'v2024-05-28';
  const ws = () => location.pathname.split('/').filter(Boolean)[0] || '';

  // Tampermonkey с @grant запускает скрипт в песочнице: переменные страницы — только через unsafeWindow
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let ENV_CACHE = null; // { ws, e }
  // Запасной путь: те же переменные лежат в HTML Studio (window.__SANITY_ENV__ = {...})
  async function loadEnv() {
    if (PAGE.__SANITY_ENV__?.SANITY_STUDIO_API_PROJECT_ID) return true;
    if (ENV_CACHE?.ws === ws()) return true;
    try {
      const html = await (await fetch(`/${ws()}/structure`, { credentials: 'include' })).text();
      const e = {};
      for (const m of html.matchAll(/"(SANITY_STUDIO_[A-Z_]+)"\s*:\s*"([^"]*)"/g)) e[m[1]] = m[2];
      if (e.SANITY_STUDIO_API_PROJECT_ID) { ENV_CACHE = { ws: ws(), e }; return true; }
    } catch (err) { /* ignore */ }
    return false;
  }
  function env() {
    const e = PAGE.__SANITY_ENV__?.SANITY_STUDIO_API_PROJECT_ID ? PAGE.__SANITY_ENV__ : (ENV_CACHE?.ws === ws() ? ENV_CACHE.e : {});
    const pid = e.SANITY_STUDIO_API_PROJECT_ID;
    const ds = e.SANITY_STUDIO_API_DATASET || 'production';
    const host = e.SANITY_STUDIO_API_HOST; // https://sanity-proxy.starterapp.ru
    const base = host ? host.replace('://', `://${pid}.`) : `https://${pid}.api.sanity.io`;
    return { pid, ds, base: `${base}/${API_VER}` };
  }
  function authHeaders() {
    const { pid } = env();
    const t = JSON.parse(localStorage.getItem(`__studio_auth_token_${pid}`) || 'null');
    return t?.token ? { Authorization: `Bearer ${t.token}` } : {};
  }
  async function api(path, opts = {}) {
    const r = await fetch(env().base + path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) }, credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.description || j?.message || `HTTP ${r.status}`);
    return j;
  }
  const q = (groq, params = {}) => {
    const p = Object.entries(params).map(([k, v]) => `&$${k}=${encodeURIComponent(JSON.stringify(v))}`).join('');
    return api(`/data/query/${env().ds}?perspective=raw&query=${encodeURIComponent(groq)}${p}`).then(j => j.result);
  };
  const mutate = (mutations) => api(`/data/mutate/${env().ds}?returnIds=true`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mutations })
  });
  async function uploadImage(file) {
    const r = await fetch(`${env().base}/assets/images/${env().ds}?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': file.type }, body: file, credentials: 'include'
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.description || 'Загрузка не удалась');
    return j.document._id;
  }
  function imgUrl(ref, w) {
    if (!ref) return '';
    const m = ref.match(/^image-([a-f0-9]+)-(\d+x\d+)-(\w+)$/);
    if (!m) return '';
    return `https://cdn.sanity.io/images/${env().pid}/${env().ds}/${m[1]}-${m[2]}.${m[3]}${w ? `?w=${w}&auto=format` : ''}`;
  }
  const gmGet = (url) => new Promise((res, rej) => GM_xmlhttpRequest({
    method: 'GET', url, timeout: 25000,
    onload: r => r.status < 400 ? res({ text: r.responseText, finalUrl: r.finalUrl || url }) : rej(new Error(`HTTP ${r.status} ${url}`)),
    onerror: () => rej(new Error('Сеть: ' + url)), ontimeout: () => rej(new Error('Таймаут: ' + url))
  }));

  // Контурный глаз (Tabler «eye», MIT): тонкие линии, цвет берётся от текста — не сливается, в отличие от эмодзи
  const EYE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/></svg>';

  // ===================================================================
  // 2. Утилиты
  // ===================================================================
  const key = () => Math.random().toString(36).slice(2, 14);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const get = (o, path) => path.split('.').reduce((a, k) => a == null ? a : a[k], o);
  function set(o, path, v) {
    const ks = path.split('.'); let c = o;
    ks.slice(0, -1).forEach(k => { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; });
    if (v === undefined || v === '') delete c[ks.at(-1)]; else c[ks.at(-1)] = v;
  }
  const ls = s => ({ _type: 'localeString', ru: s });
  // ВАЖНО: синк Starter (Sanity → бэкенд) молча отбрасывает документ, если у цвета нет hsl/hsv.
  // Поэтому пишем цвет полностью, как это делает Studio.
  function hexToColor(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
    let h = 0;
    if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = Math.round(h * 60); if (h < 0) h += 360;
    const l = (max + min) / 2;
    const sl = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const sv = max ? d / max : 0;
    return {
      _type: 'color', hex, alpha: 1,
      hsl: { _type: 'hslaColor', h, s: sl, l, a: 1 },
      hsv: { _type: 'hsvaColor', h, s: sv, v: max, a: 1 },
      rgb: { _type: 'rgbaColor', r, g, b, a: 1 }
    };
  }
  // Чинит цвета без hsl/hsv в старых документах перед сохранением
  function fixColors(o) {
    if (!o || typeof o !== 'object') return;
    if (o._type === 'color' && o.hex && (!o.hsl || !o.hsv)) Object.assign(o, hexToColor(o.hex), { alpha: o.alpha ?? 1 });
    Object.values(o).forEach(fixColors);
  }
  function colorCss(c) {
    if (!c) return '';
    if (c.rgb) return `rgba(${c.rgb.r},${c.rgb.g},${c.rgb.b},${c.rgb.a ?? 1})`;
    return c.hex || '';
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Portable Text <-> мини-разметка: **жирный**, [текст](ссылка)
  function blockToText(b) {
    const defs = Object.fromEntries((b.markDefs || []).map(d => [d._key, d]));
    return (b.children || []).map(ch => {
      let t = ch.text || '';
      const marks = ch.marks || [];
      if (marks.includes('strong')) t = `**${t}**`;
      const lk = marks.find(m => defs[m]?._type === 'link');
      if (lk) t = `[${t}](${defs[lk].href || ''})`;
      return t;
    }).join('');
  }
  function textToChildren(text) {
    const children = [], markDefs = [];
    const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
    let last = 0, m;
    const push = (t, marks = []) => t && children.push({ _type: 'span', _key: key(), marks, text: t });
    while ((m = re.exec(text))) {
      push(text.slice(last, m.index));
      if (m[1] != null) {
        const k = key(); markDefs.push({ _key: k, _type: 'link', href: m[2] });
        let inner = m[1], marks = [k];
        if (/^\*\*.*\*\*$/.test(inner)) { inner = inner.slice(2, -2); marks.push('strong'); }
        push(inner, marks);
      } else push(m[3], ['strong']);
      last = re.lastIndex;
    }
    push(text.slice(last));
    if (!children.length) children.push({ _type: 'span', _key: key(), marks: [], text: '' });
    return { children, markDefs };
  }

  // ===================================================================
  // 3. Описание полей (что показывать в форме)
  // ===================================================================
  const YESNO = [['true', 'Да'], ['false', 'Нет']];
  const BTN_ICON = [['', 'Без иконки'], ['phone', 'Телефон'], ['location', 'Локация']];

  const MAIN_FIELDS = [
    { p: 'isActive', t: 'bool', l: 'Страница активна', h: 'Выключенная страница на сайте не открывается (404).' },
    { p: 'title.ru', t: 'text', l: 'Название страницы', h: 'Видно в списке страниц и во вкладке браузера.', req: true },
    { p: 'url.current', t: 'slug', l: 'URL-код', h: 'Адрес страницы: сайт.ru/<url-код>. Только латиница в нижнем регистре, цифры и дефис.', req: true },
    { p: 'type', t: 'radio', l: 'Открывать как', o: [['page', 'Страница'], ['popup', 'Всплывающее окно (pop-up)']], h: 'Pop-up открывается окном поверх текущей страницы.' },
  ];
  const H = 'headerCallToAction.';
  const COVER_FIELDS = [
    { sec: 'Текст и кнопки' },
    { p: H + 'title.ru', t: 'text', l: 'Заголовок', h: '6–8 слов, не больше 50 символов.' },
    { p: H + 'description.ru', t: 'textarea', l: 'Описание', h: '12–16 слов, не больше 200 символов.' },
    { p: H + 'primaryButton', t: 'buttonCTA', l: 'Основная кнопка' },
    { p: H + 'secondaryButton', t: 'buttonCTA', l: 'Второстепенная кнопка' },
    { sec: 'Картинка/видео рядом с заголовком' },
    { p: H + 'contentType', t: 'radio', l: 'Контент на обложке', o: [['image', 'Изображение'], ['video', 'Видео']] },
    { p: H + 'logo', t: 'image', l: 'Изображение', h: 'Логотип или иллюстрация над/сбоку от заголовка.', show: d => get(d, H + 'contentType') !== 'video' },
    { p: H + 'video', t: 'text', l: 'Ссылка на видео (mp4)', h: '21:9, до 15 МБ, до 30 с. Без звука, по кругу.', show: d => get(d, H + 'contentType') === 'video' },
    { p: H + 'style', t: 'radio', l: 'Где стоит картинка', o: [['vertical', 'Над заголовком'], ['horizontal', 'Сбоку (50% обложки)']], h: 'Для видео — только «Сбоку».' },
    { p: H + 'position', t: 'radio', l: 'С какой стороны', o: [['left', 'Картинка слева'], ['right', 'Картинка справа']], show: d => get(d, H + 'style') === 'horizontal' },
    { sec: 'Фон обложки' },
    { p: H + 'background', t: 'radio', l: 'Фон', o: [['null', 'Без фона'], ['image', 'Картинка'], ['color', 'Цвет'], ['video', 'Видео']], h: 'Видео-фон нельзя при картинке «Сбоку».' },
    { p: H + 'cover', t: 'image', l: 'Фон — компьютер', h: '3200 × 728–1052 px.', show: d => get(d, H + 'background') === 'image' },
    { p: H + 'coverMobile', t: 'image', l: 'Фон — телефон', h: '880 × 800–960 px. Если пусто — берётся компьютерный.', show: d => get(d, H + 'background') === 'image' },
    { p: H + 'videoCover', t: 'text', l: 'Видео-фон — компьютер (mp4)', h: '21:9, до 15 МБ.', show: d => get(d, H + 'background') === 'video' },
    { p: H + 'videoCoverMobile', t: 'text', l: 'Видео-фон — телефон (mp4)', h: '3:4 или 1:1.', show: d => get(d, H + 'background') === 'video' },
    { p: H + 'backgroundColor', t: 'color', l: 'Цвет фона', show: d => get(d, H + 'background') === 'color' },
    { p: H + 'backgroundBlackout', t: 'bool', l: 'Затемнить фон', h: 'Тёмная вуаль поверх фона, чтобы текст читался.' },
    { p: H + 'imageSize', t: 'radio', l: 'Высота обложки по', o: [['arbitrary', 'Пропорциям картинки/видео'], ['content', 'Тексту']], h: 'По пропорциям — на некоторых экранах часть картинки обрежется.' },
    { sec: 'Оформление (компьютер)' },
    { p: H + 'headerLayout.pane', t: 'radio', l: 'Тема', o: [['light', 'Светлая'], ['dark', 'Тёмная']], h: 'Определяет цвет текста и навигации поверх обложки.' },
    { p: H + 'headerLayout.headerFontColor', t: 'color', l: 'Цвет текста', h: 'Пусто — по теме.' },
    { p: H + 'headerLayout.contentPosition', t: 'radio', l: 'Заголовок и кнопки', o: [['center', 'По центру'], ['bottom', 'Прижать к низу']] },
    { p: H + 'headerLayout.size', t: 'radio', l: 'Размер заголовка и отступов', o: [['l', 'Стандартный'], ['m', 'Уменьшенный']] },
    { p: H + 'headerLayout.width', t: 'radio', l: 'Во всю ширину страницы', o: [['max', 'Да'], ['content', 'Нет, по ширине контента']] },
    { p: H + 'headerLayout.settingsForMobile', t: 'bool', l: 'Настроить отдельно для телефона' },
    { sec: 'Оформление (телефон)', show: d => get(d, H + 'headerLayout.settingsForMobile') },
    { p: H + 'headerLayout.paneMobile', t: 'radio', l: 'Тема', o: [['light', 'Светлая'], ['dark', 'Тёмная']], show: d => get(d, H + 'headerLayout.settingsForMobile') },
    { p: H + 'headerLayout.headerFontColorMobile', t: 'color', l: 'Цвет текста', show: d => get(d, H + 'headerLayout.settingsForMobile') },
    { p: H + 'headerLayout.contentPositionMobile', t: 'radio', l: 'Заголовок и кнопки', o: [['center', 'По центру'], ['bottom', 'Прижать к низу']], show: d => get(d, H + 'headerLayout.settingsForMobile') },
    { p: H + 'headerLayout.sizeMobile', t: 'radio', l: 'Размер', o: [['l', 'Стандартный'], ['m', 'Уменьшенный']], show: d => get(d, H + 'headerLayout.settingsForMobile') },
    { p: H + 'headerLayout.widthMobile', t: 'radio', l: 'Во всю ширину', o: [['max', 'Да'], ['content', 'Нет']], show: d => get(d, H + 'headerLayout.settingsForMobile') },
  ];
  const HL = 'headerAndLogoSettings.';
  const HEADER_FIELDS = [
    { p: HL + 'logoInHeader', t: 'bool', l: 'Показывать логотип в шапке' },
    { p: HL + 'navType', t: 'radio', l: 'Шапка', o: [['standard-with-image', 'Поверх обложки'], ['separated-image', 'Отдельно над обложкой']] },
    { p: HL + 'headerNavColor', t: 'color', l: 'Цвет фона шапки', h: 'Пусто — прозрачная/по теме.' },
    { p: HL + 'settingsForMobile', t: 'bool', l: 'Настроить отдельно для телефона' },
    { p: HL + 'logoInHeaderMobile', t: 'bool', l: 'Логотип в шапке (телефон)', show: d => get(d, HL + 'settingsForMobile') },
    { p: HL + 'navTypeMobile', t: 'radio', l: 'Шапка (телефон)', o: [['standard-with-image', 'Поверх обложки'], ['separated-image', 'Отдельно']], show: d => get(d, HL + 'settingsForMobile') },
    { p: HL + 'headerNavColorMobile', t: 'color', l: 'Цвет фона шапки (телефон)', show: d => get(d, HL + 'settingsForMobile') },
  ];

  const BLOCKS = {
    text: { title: 'Текст', make: () => ({ _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: key(), marks: [], text: '' }] }) },
    image: { title: 'Изображение', make: () => ({ _type: 'image' }) },
    productSelection: { title: 'Подборка товаров', make: () => ({ _type: 'productSelection', productSelectionList: [] }) },
    border: { title: 'Разделитель', make: () => ({ _type: 'border', divider: true }) },
    button: { title: 'Кнопка', make: () => ({ _type: 'button', type: 'primary', label: 'Кнопка', url: '/' }) },
    callToAction: { title: 'Call To Action', make: () => ({ _type: 'callToAction', style: 'vertical', background: 'null', size: 'm', backgroundBlackout: true, position: 'left', width: 'max', pane: 'dark', contentPosition: 'center', imageSize: 'arbitrary', title: ls('Заголовок блока') }) },
    iframeWrapper: { title: 'iframe (видео, карта, 3D-тур)', make: () => ({ _type: 'iframeWrapper', iframe: { _type: 'slug', current: '' }, aspectRatio: '16/9' }) },
    tableWrapper: { title: 'Таблица', make: () => ({ _type: 'tableWrapper', tableBold: 'row', table: { _type: 'table', rows: [{ _type: 'tableRow', _key: key(), cells: ['', ''] }, { _type: 'tableRow', _key: key(), cells: ['', ''] }] } }) },
    accordionWrapper: { title: 'Аккордеон (вопрос-ответ)', make: () => ({ _type: 'accordionWrapper', accordionList: [{ _type: 'accordion', _key: key(), title: 'Вопрос', description: 'Ответ' }] }) },
    mediaWrapper: { title: 'Галерея фото и видео', make: () => ({ _type: 'mediaWrapper', mediaList: [] }) },
    bannersWrapper: { title: 'Слайдер баннеров', make: () => ({ _type: 'bannersWrapper', banners: [] }) },
  };
  const blockKind = b => b._type === 'block' ? 'text' : b._type;
  const TEXT_STYLES = [['normal', 'Текст'], ['h2', 'Заголовок'], ['h3', 'Подзаголовок'], ['large', 'Выделенный'], ['small', 'Мелкий серый']];

  // ===================================================================
  // 4. Состояние
  // ===================================================================
  const S = {
    pages: [], id: null, doc: null, published: null, dirty: false, saving: false,
    tab: 'content', device: 'desktop', openBlock: null,
    meals: {}, banners: {}, siteShell: null, siteUrl: null, cls: {},
    mounted: false, logos: {}, accOpen: new Set(), justDragged: 0,
  };

  // ===================================================================
  // 5. Стили модалки
  // ===================================================================
  const CSS = `
  #spe-overlay{--a:#bd5b34;--ah:#9c4a29;--asb:#f3e3da;--ast:#7a3c1e;--bg:#fbf9f5;--pn:#fffdfa;--sub:#f2ede2;--bd:#e6dfd0;--t1:#2b2620;--t2:#857e6f;--t3:#a89f8c;--err:#c0392b;
    --in:#fff;--veil:rgba(251,249,245,.92);--prevbg:#e9e5dc;--wbg:#fff4e0;--wbd:#f0c27a;--wt:#7a4b00;--wblk:#fffaf0;--eblk:#fff6f5;--ebg:#fdecea;--ebd:#e8a39b;--ect:#8a1f14;--tipbg:#2b2620;--tipt:#fff;color-scheme:light;
    position:fixed;inset:0;background:rgba(23,20,14,.5);z-index:999999;display:flex;align-items:center;justify-content:center;
    font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--t1)}
  /* Тёмная тема — только интерфейс модалки; предпросмотр (iframe) не затрагивается */
  #spe-overlay.spe-dark{--a:#d9774f;--ah:#e58a63;--asb:#4a2f22;--ast:#f2c3a8;--bg:#1b1916;--pn:#23201c;--sub:#302c26;--bd:#3b362f;--t1:#ece6da;--t2:#aaa293;--t3:#7f786c;--err:#ef6b5b;
    --in:#1f1c19;--veil:rgba(27,25,22,.92);--prevbg:#14120f;--wbg:#3a2d14;--wbd:#7a5a1e;--wt:#f0c27a;--wblk:#2c2416;--eblk:#2e1c1a;--ebg:#3a1f1c;--ebd:#7a3a33;--ect:#f2a79e;--tipbg:#ece6da;--tipt:#1b1916;color-scheme:dark}
  #spe-iframe{color-scheme:light}
  #spe-overlay *{box-sizing:border-box}
  #spe-overlay button{margin:0;padding:0;font:inherit;color:inherit;cursor:pointer;background:none;border:0}
  #spe-overlay input,#spe-overlay textarea,#spe-overlay select{font:inherit;color:inherit}
  #spe-modal{background:var(--bg);width:98vw;height:95vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}
  #spe-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--pn);border-bottom:1px solid var(--bd)}
  #spe-head h2{font-size:15px;margin:0;white-space:nowrap}
  #spe-head .grow{flex:1}
  #spe-status{font-size:12px;color:var(--t2);white-space:nowrap}
  #spe-status.err{color:var(--err)}
  .spe-btn{padding:7px 14px !important;border-radius:8px;border:1px solid var(--bd) !important;background:var(--pn) !important;white-space:nowrap}
  .spe-btn:hover{border-color:var(--a) !important}
  .spe-btn.pri{background:var(--a) !important;border-color:var(--a) !important;color:#fff !important}
  .spe-btn.pri:hover{background:var(--ah) !important}
  .spe-btn:disabled{opacity:.5;cursor:default}
  .spe-x{width:30px;height:30px;border-radius:50%;font-size:18px !important;line-height:30px;text-align:center}
  .spe-x:hover{background:var(--sub) !important}
  .spe-theme{display:inline-flex;align-items:center;justify-content:center;color:var(--t2) !important}
  .spe-theme:hover{color:var(--t1) !important}
  #spe-main{flex:1;display:flex;min-height:0;position:relative}
  #spe-sitebox{position:absolute;inset:0;z-index:30;background:var(--veil);display:flex;align-items:center;justify-content:center}
  .spe-sitecard{width:min(520px,92%);background:var(--pn);border:1px solid var(--bd);border-radius:12px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.12);font-size:13px;line-height:1.5}
  .spe-sitecard a{color:var(--a)}
  #spe-list{width:230px;border-right:1px solid var(--bd);display:flex;flex-direction:column;background:var(--pn)}
  #spe-list input{margin:10px;padding:7px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg)}
  #spe-pages{flex:1;overflow:auto;padding:0 6px 10px}
  .spe-pg{display:block;width:100%;text-align:left;padding:7px 9px !important;border-radius:7px;margin-bottom:2px}
  .spe-pg:hover{background:var(--sub) !important}
  .spe-pg.on{background:var(--asb) !important;color:var(--ast)}
  .spe-pg small{display:block;color:var(--t3);font-size:11px}
  .spe-pg .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#2ecc71;margin-right:6px}
  .spe-pg .dot.off{background:#bbb}.spe-pg .dot.dr{background:#f39c12}
  #spe-form{width:440px;display:flex;flex-direction:column;border-right:1px solid var(--bd);min-width:0}
  #spe-tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid var(--bd);background:var(--pn)}
  .spe-tab{padding:6px 10px !important;border-radius:7px;color:var(--t2) !important}
  .spe-tab.on{background:var(--asb) !important;color:var(--ast) !important;font-weight:600}
  #spe-fields{flex:1;overflow:auto;padding:12px 14px 40px}
  .spe-sec{margin:18px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--t3);font-weight:600}
  .spe-f{margin-bottom:12px}
  .spe-f>label{display:block;font-weight:600;font-size:13px;margin-bottom:4px}
  .spe-f .req{color:var(--err)}
  .spe-h{font-size:12px;color:var(--t2);margin-top:3px}
  .spe-in{width:100%;padding:7px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--in)}
  .spe-in:focus{outline:none;border-color:var(--a)}
  textarea.spe-in{resize:vertical;min-height:60px}
  .spe-radio{display:flex;flex-wrap:wrap;gap:4px}
  .spe-radio button{padding:5px 10px !important;border:1px solid var(--bd) !important;border-radius:7px;background:var(--in) !important;font-size:13px !important}
  .spe-radio button.on{background:var(--asb) !important;border-color:var(--a) !important;color:var(--ast) !important}
  .spe-row{display:flex;gap:6px;align-items:center}
  .spe-img{display:flex;gap:8px;align-items:center}
  .spe-img img{width:56px;height:56px;object-fit:cover;border-radius:6px;background:var(--sub)}
  .spe-sub{border:1px solid var(--bd);border-radius:8px;padding:8px 10px;background:var(--pn)}
  .spe-blk{border:1px solid var(--bd);border-radius:9px;background:var(--pn);margin-bottom:8px}
  .spe-blk.on{border-color:var(--a)}
  .spe-bh{display:flex;align-items:center;gap:6px;padding:7px 9px;cursor:grab;touch-action:none}
  .spe-grip{color:var(--t3);font-size:12px;letter-spacing:-2px;margin-right:2px;user-select:none}
  .spe-blk.spe-dragging{opacity:.35}
  .spe-drop-line{position:fixed;height:4px;margin-top:-1px;background:#bd5b34;border-radius:2px;z-index:1000003;pointer-events:none;box-shadow:0 0 0 2px rgba(189,91,52,.2)}
  html.spe-dragmode, html.spe-dragmode *{cursor:grabbing!important;user-select:none!important}
  .spe-dlg{position:absolute;inset:0;z-index:30;background:var(--veil);display:flex;align-items:center;justify-content:center}
  .spe-bh .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .spe-bh .tp{font-size:11px;color:var(--t3);margin-right:4px}
  .spe-ib{width:24px;height:24px;border-radius:6px;color:var(--t2) !important;font-size:13px !important}
  .spe-ib:hover{background:var(--sub) !important;color:var(--t1) !important}
  .spe-bb{padding:4px 10px 10px;border-top:1px solid var(--bd)}
  .spe-add{position:relative;margin-top:6px}
  .spe-menu{position:absolute;left:0;top:100%;z-index:5;background:var(--in);border:1px solid var(--bd);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:4px;width:260px}
  .spe-menu button{display:block;width:100%;text-align:left;padding:6px 10px !important;border-radius:6px}
  .spe-menu button:hover{background:var(--sub) !important}
  .spe-tbl td{padding:2px}.spe-tbl input{width:100%;padding:4px 6px;border:1px solid var(--bd);border-radius:5px;background:var(--in)}
  #spe-prev{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--prevbg)}
  #spe-ptools{display:flex;gap:6px;align-items:center;padding:8px 10px;background:var(--pn);border-bottom:1px solid var(--bd);font-size:12px;color:var(--t2)}
  #spe-pwrap{flex:1;overflow:auto;display:flex;justify-content:center;padding:10px}
  #spe-iframe{border:0;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.12);height:100%}
  .spe-warn{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:var(--wbg);border:1px solid var(--wbd);color:var(--wt);font-size:12px}
  .spe-iss{margin-top:4px}.spe-iss a{color:var(--wt);text-decoration:underline;cursor:pointer;font-weight:600}
  .spe-iss .spe-ib{width:20px;height:20px;font-size:12px!important;vertical-align:middle}
  .spe-blk.warn{border-color:#f0a43a;background:var(--wblk)}
  .spe-blk.err{border-color:var(--err);background:var(--eblk)}
  .spe-errmark{color:var(--err);font-weight:700;font-size:12px}
  .spe-blkerr{margin:6px 0;padding:6px 9px;border-radius:7px;background:var(--ebg);color:var(--err);font-size:12px}
  .spe-tabcnt{display:inline-block;margin-left:5px;min-width:16px;padding:0 4px;border-radius:8px;background:var(--err);color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:600}
  #spe-errs .spe-iss a{color:var(--err);text-decoration:underline;cursor:pointer;font-weight:600}
  .spe-conflict{margin:0 0 10px;padding:10px 12px;border-radius:8px;background:var(--ebg);border:1px solid var(--ebd);color:var(--ect);font-size:12px}
  .spe-conflict .spe-row{margin-top:8px;flex-wrap:wrap}
  /* Подсказки при наведении: data-tip="текст" */
  /* Одна общая плашка; позицию считает JS и не даёт выйти за края модалки */
  #spe-tip{position:fixed;z-index:1000002;max-width:280px;padding:8px 10px;border-radius:8px;background:var(--tipbg);color:var(--tipt);
    font:400 12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;text-align:left;white-space:normal;box-shadow:0 6px 18px rgba(0,0,0,.2);
    pointer-events:none;opacity:0;transition:opacity .12s ease-out}
  #spe-tip.show{opacity:1}
  @keyframes speFlash{0%{box-shadow:inset 0 0 0 3px rgba(189,91,52,.7)}100%{box-shadow:inset 0 0 0 3px rgba(189,91,52,0)}}
  .spe-flash{animation:speFlash 1.4s ease-out}
  #spe-errs{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:var(--ebg);color:var(--err);font-size:12px}
  #spe-fab{align-self:center;display:inline-flex;align-items:center;gap:6px;margin:0 0 0 6px;padding:6px 10px;border-radius:6px;border:0;background:#bd5b34;color:#fff;line-height:1;white-space:nowrap;
    font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer}
  #spe-fab:hover{background:#9c4a29}
  `;

  // ===================================================================
  // 6. Валидация (как в Studio)
  // ===================================================================
  // Возвращает [{ key, text }]: key — где ошибка ('main' | 'cover' | _key блока), чтобы подсветить и перейти
  const CTA_REQ = { style: 'Расположение', background: 'Фон', pane: 'Тема', width: 'Ширина', size: 'Размер отступов и заголовка', contentPosition: 'Текст прижат к' };
  function validate(d) {
    const e = [];
    const add = (key, text) => e.push({ key, text });
    if (!get(d, 'title.ru')) add('main', 'Не заполнено название страницы');
    const slug = get(d, 'url.current');
    if (!slug) add('main', 'Не заполнен URL-код');
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) add('main', 'URL-код: только латиница в нижнем регистре, цифры и дефис');
    if (!(get(d, 'detail.ru') || []).length) add('content', 'Содержимое пустое — добавьте хотя бы один блок');
    const hc = d.headerCallToAction || {};
    if (!hc.background) add('cover', 'Обложка: не выбран фон');
    if (hc.contentType === 'video' && hc.style === 'vertical') add('cover', 'Обложка: при видео картинка может быть только «Сбоку»');
    if (hc.style === 'horizontal' && hc.background === 'video') add('cover', 'Обложка: видео-фон нельзя при картинке «Сбоку»');
    (get(d, 'detail.ru') || []).forEach(b => {
      const k = b._key;
      if (b._type === 'image' && !b.asset) add(k, 'Не загружено изображение');
      if (b._type === 'button' && (!b.label || !b.url)) add(k, 'Нужны текст кнопки и ссылка');
      if (b._type === 'callToAction') {
        Object.entries(CTA_REQ).forEach(([f, l]) => { if (!b[f]) add(k, `Не выбрано «${l}»`); });
        if (b.style === 'horizontal' && !b.position) add(k, 'Выберите, с какой стороны картинка');
      }
      if (b._type === 'accordionWrapper') (b.accordionList || []).forEach((a, j) => { if (!a.title || !a.description) add(k, `Пункт ${j + 1}: нужны и вопрос, и ответ`); });
      if (b._type === 'mediaWrapper') (b.mediaList || []).forEach((m, j) => { if (!m.image && !m.video && !m.iframe?.current) add(k, `Элемент ${j + 1} пустой — добавьте фото или iframe`); });
    });
    return e;
  }
  // Подпись места ошибки/замечания для списка
  function whereLabel(k) {
    if (k === 'cover') return 'Обложка';
    if (k === 'main') return 'Основное';
    if (k === 'header') return 'Шапка';
    if (k === 'content') return 'Содержимое';
    const i = (S.doc?.detail?.ru || []).findIndex(b => b._key === k);
    if (i < 0) return 'Блок удалён';
    const b = S.doc.detail.ru[i];
    return `Блок ${i + 1} · ${BLOCKS[blockKind(b)]?.title || b._type}`;
  }
  function goTo(k) {
    if (['cover', 'main', 'header', 'content'].includes(k)) { S.tab = k; renderTabs(); renderForm(); return; }
    if (k) { selectBlock(k); highlightPreview(k); }
  }

  // ===================================================================
  // 7. Загрузка данных
  // ===================================================================
  async function loadPages() {
    S.pages = await q(`*[_type=="page"]{_id,_updatedAt,isActive,documentType,type,"title":title.ru,"slug":url.current}|order(_updatedAt desc)`);
  }
  // Неотправленные правки: спросить, что с ними делать. false — отмена действия.
  async function resolveUnsent() {
    if (!S.dirty || !S.doc) return true;
    if (confirm('Есть неотправленные правки. Отправить их в Sanity сейчас?\n\nОК — отправить' + (autoPub() ? ' (и опубликовать, если нет ошибок)' : '') + '\nОтмена — оставить только в этом браузере')) {
      await sendToSanity(); return !S.dirty;
    }
    S.dirty = false; return true; // копия остаётся в localStorage
  }
  async function openPage(id) {
    if (!(await resolveUnsent())) return;
    const baseId = id.replace(/^drafts\./, '');
    const docs = await q(`*[_id in [$a, $b]]`, { a: baseId, b: 'drafts.' + baseId });
    const draft = docs.find(x => x._id.startsWith('drafts.'));
    S.published = docs.find(x => !x._id.startsWith('drafts.')) || null;
    S.doc = clone(draft || S.published);
    S.id = baseId;
    deliveryRun++; setDelivery('');
    // локальная копия неотправленных правок
    try {
      const loc = JSON.parse(localStorage.getItem(localKey()) || 'null');
      const remoteTs = Date.parse(S.doc._updatedAt || 0) || 0;
      if (loc?.doc && loc.ts > remoteTs && confirm(`Найдены неотправленные правки этой страницы от ${new Date(loc.ts).toLocaleString()}. Восстановить их?`)) {
        S.doc = loc.doc; S.dirty = true;
      } else if (loc) dropLocal();
    } catch (e) { /* ignore */ }
    S.doc.detail = S.doc.detail || { _type: 'localeBlockContent', ru: [] };
    S.doc.detail.ru = S.doc.detail.ru || [];
    S.openBlock = null; S.accOpen = new Set();
    // Версии, от которых начали редактирование — чтобы заметить чужие правки
    S.base = { draft: draft?._rev || null, pub: S.published?._rev || null }; S.conflict = null;
    try { S.issues = JSON.parse(localStorage.getItem(issuesKey()) || '[]'); } catch (e) { S.issues = []; }
    await loadRefs();
    render();
  }
  async function loadRefs() {
    const blocks = S.doc?.detail?.ru || [];
    const mealIds = [...new Set(blocks.flatMap(b => b._type === 'productSelection' ? (b.productSelectionList || []).map(r => r._ref) : []))].filter(i => !S.meals[i]);
    const banIds = [...new Set(blocks.flatMap(b => b._type === 'bannersWrapper' ? (b.banners || []).map(r => r._ref) : []))].filter(i => !S.banners[i]);
    if (mealIds.length) (await q(`*[_id in $ids]{_id,"n":name.ru,"img":images[0].asset._ref,"price":*[_type=="mealOffer" && meal._ref==^._id][0].price}`, { ids: mealIds })).forEach(m => S.meals[m._id] = m);
    if (banIds.length) (await q(`*[_id in $ids]{_id,"n":title,"img":coalesce(verticalBackgroundImage.asset._ref,backgroundImage.asset._ref,image.asset._ref)}`, { ids: banIds })).forEach(b => S.banners[b._id] = b);
  }
  async function newPage() {
    const id = crypto.randomUUID();
    const doc = {
      _id: 'drafts.' + id, _type: 'page', isActive: true, type: 'page', documentType: 'page',
      title: ls('Новая страница'), url: { _type: 'slug', current: 'novaya-stranica-' + id.slice(0, 4) },
      headerCallToAction: { contentType: 'image', background: 'null', backgroundBlackout: true, position: 'left', style: 'vertical', imageSize: 'arbitrary', headerLayout: { _type: 'headerLayout', size: 'l', width: 'max', pane: 'light', contentPosition: 'center', settingsForMobile: false } },
      headerAndLogoSettings: { logoInHeader: true, navType: 'standard-with-image', logoPosition: 'center', settingsForMobile: false, headerNavHeight: 'standard' },
      detail: { _type: 'localeBlockContent', ru: [] }
    };
    await mutate([{ createIfNotExists: doc }]);
    await loadPages();
    await openPage(id);
  }

  // ===================================================================
  // 7а. Диалоги и дублирование страницы
  // ===================================================================
  function dialog(html) {
    $.querySelector('.spe-dlg')?.remove();
    const box = document.createElement('div'); box.className = 'spe-dlg';
    box.innerHTML = `<div class="spe-sitecard">${html}</div>`;
    $.querySelector('#spe-main').appendChild(box);
    return box;
  }
  function infoDialog(title, text) {
    const box = dialog(`<h3 style="margin:0 0 8px;font-size:15px">${esc(title)}</h3><p style="margin:0 0 12px">${text}</p>
      <div class="spe-row" style="justify-content:flex-end"><button class="spe-btn pri" data-d="ok">Понятно</button></div>`);
    box.querySelector('[data-d=ok]').onclick = () => box.remove();
  }
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  async function allSlugs() { return new Set((await q(`*[_type=="page"].url.current`)).filter(Boolean)); }
  function freeSlug(base, taken) {
    base = (base || 'page').replace(/-kopiya(-\d+)?$/, '');
    let s = `${base}-kopiya`, n = 2;
    while (taken.has(s)) s = `${base}-kopiya-${n++}`;
    return s;
  }
  async function duplicateDialog() {
    if (!S.doc) return;
    const taken = await allSlugs();
    const title0 = `${get(S.doc, 'title.ru') || 'Страница'} (копия)`;
    const slug0 = freeSlug(get(S.doc, 'url.current'), taken);
    const special = S.doc.documentType && S.doc.documentType !== 'page';
    const box = dialog(`<h3 style="margin:0 0 8px;font-size:15px">Дублировать страницу</h3>
      <p class="spe-h" style="margin:0 0 10px">Копия создастся черновиком в этом же проекте — со всеми блоками, обложкой и шапкой${S.dirty ? ', включая ещё не отправленные правки' : ''}. На сайте она не появится, пока вы её не опубликуете.${special ? '<br><b>Оферта, политика и т. п. бывают только в одном экземпляре — копия станет обычной страницей.</b>' : ''}</p>
      <div class="spe-f"><label>Название</label><input class="spe-in" data-d="title" value="${esc(title0)}"></div>
      <div class="spe-f"><label>URL-код</label><input class="spe-in" data-d="slug" value="${esc(slug0)}"><div class="spe-h" data-d="hint"></div></div>
      <div class="spe-row" style="justify-content:flex-end"><button class="spe-btn" data-d="cancel">Отмена</button><button class="spe-btn pri" data-d="ok">Создать копию</button></div>`);
    const $t = box.querySelector('[data-d=title]'), $s = box.querySelector('[data-d=slug]'), $h = box.querySelector('[data-d=hint]'), ok = box.querySelector('[data-d=ok]');
    const check = () => {
      const s = $s.value;
      let msg = '', bad = false;
      if (!s) { msg = 'Введите URL-код'; bad = true; }
      else if (!SLUG_RE.test(s)) { msg = 'Только латиница в нижнем регистре, цифры и дефис (без дефиса в начале и конце)'; bad = true; }
      else if (taken.has(s)) { msg = `URL «${s}» уже занят другой страницей этого проекта`; bad = true; }
      else msg = `Адрес копии: ${S.siteUrl || 'сайт'}/${s}`;
      if (!$t.value.trim()) { bad = true; }
      $h.textContent = msg; $h.style.color = bad && s ? 'var(--err)' : '';
      ok.disabled = bad;
      return !bad;
    };
    $s.oninput = () => { $s.value = $s.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); check(); };
    $t.oninput = check;
    check(); $s.focus(); $s.select();
    box.querySelector('[data-d=cancel]').onclick = () => box.remove();
    ok.onclick = async () => {
      if (!check()) return;
      ok.disabled = true; ok.textContent = 'Создаю…';
      try {
        // перепроверяем по свежим данным — вдруг URL заняли, пока окно было открыто
        const fresh = await allSlugs();
        if (fresh.has($s.value)) { taken.add($s.value); check(); ok.textContent = 'Создать копию'; return; }
        ensureKeys(S.doc);
        const d = stripMeta(S.doc);
        const id = crypto.randomUUID();
        d._id = 'drafts.' + id; d._type = 'page';
        d.title = { _type: 'localeString', ru: $t.value.trim() };
        d.url = { _type: 'slug', current: $s.value };
        if (special) d.documentType = 'page';
        await mutate([{ createIfNotExists: d }]);
        box.remove();
        const srcDirty = S.dirty;
        await loadPages();
        await openPage(id);
        status(`✓ Создана копия «${$t.value.trim()}» (черновик)${srcDirty ? '. Исходная страница осталась с неотправленными правками' : ''}`);
      } catch (e) { $h.textContent = 'Не удалось: ' + e.message; $h.style.color = 'var(--err)'; ok.disabled = false; ok.textContent = 'Создать копию'; }
    };
  }

  // ===================================================================
  // 7б. Экспорт / импорт страницы между проектами
  // ===================================================================
  // Картинки и файлы Sanity принадлежат проекту: при импорте их скачиваем с CDN исходного проекта
  // и загружаем заново. Блюда и баннеры ищем в новом проекте по названию. Что не нашлось —
  // убираем и подсвечиваем в форме («issues»), остальное переносим как есть.
  const issuesKey = () => `spe-issues:${env().pid}:${S.id}`;
  function saveIssues() { try { S.issues?.length ? localStorage.setItem(issuesKey(), JSON.stringify(S.issues)) : localStorage.removeItem(issuesKey()); } catch (e) { /* ignore */ } }

  function assetUrl(ref, pid, ds) {
    let m = ref.match(/^image-([a-f0-9]+)-(\d+x\d+)-(\w+)$/);
    if (m) return `https://cdn.sanity.io/images/${pid}/${ds}/${m[1]}-${m[2]}.${m[3]}`;
    m = ref.match(/^file-([a-f0-9]+)-(\w+)$/);
    if (m) return `https://cdn.sanity.io/files/${pid}/${ds}/${m[1]}.${m[2]}`;
    return '';
  }
  // Обойти все {asset:{_ref}} в объекте; cb(holder, path)
  function walkAssets(o, cb, path = '') {
    if (!o || typeof o !== 'object') return;
    if (o.asset?._ref) cb(o, path);
    for (const [k, v] of Object.entries(o)) if (k !== 'asset') walkAssets(v, cb, path ? path + '.' + k : k);
  }
  // Ключ блока верхнего уровня по пути вида detail.ru.3.xxx
  const blockKeyByPath = (doc, path) => { const m = path.match(/^detail\.ru\.(\d+)/); return m ? doc.detail.ru[+m[1]]?._key : path.startsWith('headerCallToAction') ? 'cover' : 'main'; };

  function downloadJson(name, data) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function exportPage() {
    if (!S.doc) return;
    ensureKeys(S.doc);
    const doc = stripMeta(S.doc); delete doc._id;
    const blocks = doc.detail?.ru || [];
    const mealIds = [...new Set(blocks.flatMap(b => b._type === 'productSelection' ? (b.productSelectionList || []).map(r => r._ref) : []))];
    const banIds = [...new Set(blocks.flatMap(b => b._type === 'bannersWrapper' ? (b.banners || []).map(r => r._ref) : []))];
    const meals = mealIds.length ? await q(`*[_id in $ids]{_id,"n":name.ru}`, { ids: mealIds }) : [];
    const banners = banIds.length ? await q(`*[_id in $ids]{_id,"n":coalesce(title,code.current)}`, { ids: banIds }) : [];
    const front = (await q(`*[_type=="envSettings"][0].frontUrl`).catch(() => '')) || '';
    const data = {
      format: 'spe-page', version: 1, exportedAt: new Date().toISOString(),
      source: { project: ws(), pid: env().pid, ds: env().ds, site: S.siteUrl || front },
      refs: { meals: Object.fromEntries(meals.map(m => [m._id, m.n])), banners: Object.fromEntries(banners.map(b => [b._id, b.n])) },
      doc
    };
    downloadJson(`${ws()}-${get(doc, 'url.current') || 'page'}.page.json`, data);
    status('✓ Файл страницы скачан');
  }

  const gmBlob = (url) => new Promise((res, rej) => GM_xmlhttpRequest({
    method: 'GET', url, responseType: 'blob', timeout: 60000,
    onload: r => r.status < 400 ? res(r.response) : rej(new Error('HTTP ' + r.status)),
    onerror: () => rej(new Error('сеть')), ontimeout: () => rej(new Error('таймаут'))
  }));
  async function uploadAsset(blob, name, isImage) {
    const r = await fetch(`${env().base}/assets/${isImage ? 'images' : 'files'}/${env().ds}?filename=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': blob.type || 'application/octet-stream' }, body: blob, credentials: 'include'
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.description || 'загрузка не удалась');
    return j.document._id;
  }

  async function importPage(file) {
    if (!(await resolveUnsent())) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('файл не читается как JSON'); }
    if (data?.format !== 'spe-page' || !data.doc) throw new Error('это не файл экспорта страницы');
    // Импорт в тот же проект создал бы некорректный черновик (тот же URL, те же ссылки) — для этого есть «Дублировать»
    if (data.source?.pid && data.source.pid === env().pid) {
      infoDialog('Этот файл — из этого же проекта',
        `Страница «${esc(get(data.doc, 'title.ru') || '')}» экспортирована из проекта <b>${esc(data.source.project || ws())}</b> — того же, где вы сейчас.
        Импорт сюда не нужен: чтобы сделать копию страницы, откройте её в списке слева и нажмите <b>«Дублировать»</b> вверху.`);
      status('Импорт отменён: файл из этого же проекта', true);
      return;
    }
    const src = data.source || {};
    const doc = clone(data.doc);
    const issues = [];
    const add = (key, text) => issues.push({ key, text });
    doc._type = 'page';
    doc.detail = doc.detail || { _type: 'localeBlockContent', ru: [] }; doc.detail.ru = doc.detail.ru || [];

    // 1. Картинки и файлы — перезалить в этот проект
    const holders = []; walkAssets(doc, (h, p) => holders.push([h, p]));
    const done = {};
    for (let i = 0; i < holders.length; i++) {
      const [h, p] = holders[i]; const ref = h.asset._ref;
      status(`Импорт: переношу картинки ${i + 1}/${holders.length}…`);
      try {
        if (!done[ref]) {
          if (src.pid === env().pid) done[ref] = ref; // тот же проект — ничего не переносим
          else {
            const url = assetUrl(ref, src.pid, src.ds || 'production');
            if (!url) throw new Error('неизвестный тип файла');
            const blob = await gmBlob(url);
            done[ref] = await uploadAsset(blob, url.split('/').pop(), ref.startsWith('image-'));
          }
        }
        h.asset = { _type: 'reference', _ref: done[ref] };
      } catch (e) {
        delete h.asset;
        add(blockKeyByPath(doc, p), `Не удалось перенести картинку/файл (${p.replace(/^detail\.ru\.\d+\.?/, '') || 'изображение'}): ${e.message}. Загрузите заново.`);
      }
    }

    // 2. Блюда — по названию
    const mealName = data.refs?.meals || {};
    const wantMeals = [...new Set(Object.values(mealName))];
    const found = wantMeals.length && src.pid !== env().pid ? await q(`*[_type=="meal" && !(_id in path("drafts.**")) && name.ru in $n]{_id,"n":name.ru}`, { n: wantMeals }) : [];
    const mealByName = Object.fromEntries(found.map(m => [m.n, m._id]));
    doc.detail.ru.forEach(b => {
      if (b._type !== 'productSelection' || src.pid === env().pid) return;
      const miss = [];
      b.productSelectionList = (b.productSelectionList || []).map(r => {
        const n = mealName[r._ref]; const id = n && mealByName[n];
        if (id) return { ...r, _ref: id };
        miss.push(n || r._ref); return null;
      }).filter(Boolean);
      if (miss.length) add(b._key, `Нет в этом проекте блюд: ${miss.join(', ')}. Они убраны из подборки — добавьте замену.`);
    });

    // 3. Баннеры — по названию
    const banName = data.refs?.banners || {};
    const wantBan = [...new Set(Object.values(banName))];
    const foundB = wantBan.length && src.pid !== env().pid ? await q(`*[_type=="banner" && !(_id in path("drafts.**")) && (title in $n || code.current in $n)]{_id,"n":coalesce(title,code.current)}`, { n: wantBan }) : [];
    const banByName = Object.fromEntries(foundB.map(b => [b.n, b._id]));
    doc.detail.ru.forEach(b => {
      if (b._type !== 'bannersWrapper' || src.pid === env().pid) return;
      const miss = [];
      b.banners = (b.banners || []).map(r => { const n = banName[r._ref]; const id = n && banByName[n]; if (id) return { ...r, _ref: id }; miss.push(n || r._ref); return null; }).filter(Boolean);
      if (miss.length) add(b._key, `Нет в этом проекте баннеров: ${miss.join(', ')}. Они убраны из слайдера.`);
    });

    // 4. Ссылки на сайт исходного проекта
    if (src.site) {
      const host = (() => { try { return new URL(src.site).host; } catch (e) { return ''; } })();
      if (host) {
        doc.detail.ru.forEach(b => { if (JSON.stringify(b).includes(host)) add(b._key, `Ссылка ведёт на сайт исходного проекта (${host}) — замените на адрес этого сайта.`); });
        if (JSON.stringify(doc.headerCallToAction || {}).includes(host)) add('cover', `Кнопка обложки ведёт на сайт исходного проекта (${host}).`);
      }
    }

    // 5. Тип и URL-код — должны быть уникальны в проекте
    if (doc.documentType && doc.documentType !== 'page') {
      const exists = await q(`count(*[_type=="page" && documentType==$t && !(_id in path("drafts.**"))])`, { t: doc.documentType });
      if (exists) { add('main', `В проекте уже есть страница типа «${doc.documentType}» — импортировано как обычная страница.`); doc.documentType = 'page'; }
    }
    let slug = get(doc, 'url.current') || 'imported';
    const taken = new Set(await q(`*[_type=="page"].url.current`));
    if (taken.has(slug)) {
      let n = 2; while (taken.has(`${slug}-${n}`)) n++;
      add('main', `URL-код «${slug}» уже занят в этом проекте — заменён на «${slug}-${n}».`);
      slug = `${slug}-${n}`;
    }
    doc.url = { _type: 'slug', current: slug };

    // 6. Создать черновик (не публикуем — сначала проверка)
    const id = crypto.randomUUID();
    doc._id = 'drafts.' + id;
    S.id = id; ensureKeys(doc);
    await mutate([{ createIfNotExists: doc }]);
    S.issues = issues; saveIssues();
    await loadPages();
    await openPage(id);
    S.tab = 'content'; renderTabs(); renderForm();
    status(issues.length ? `Импортировано черновиком. Проверьте подсвеченное: ${issues.length}` : '✓ Импортировано черновиком без замечаний');
  }

  // ===================================================================
  // 8. Сохранение и публикация
  // ===================================================================
  function stripMeta(d) { const o = clone(d); delete o._rev; delete o._createdAt; delete o._updatedAt; return o; }
  function ensureKeys(d) {
    fixColors(d);
    (d.detail?.ru || []).forEach(b => {
      b._key = b._key || key();
      (b.children || []).forEach(c => c._key = c._key || key());
      (b.productSelectionList || b.banners || b.mediaList || b.accordionList || []).forEach(x => x._key = x._key || key());
      (b.table?.rows || []).forEach(x => x._key = x._key || key());
    });
  }
  // Правки копятся в модалке (мгновенный предпросмотр, Sanity не трогаем).
  // Локальная копия в localStorage — чтобы не потерять работу при закрытии вкладки.
  const localKey = () => `spe-local:${env().pid}:${S.id}`;
  const saveLocal = debounce(() => { try { if (S.doc && S.dirty) localStorage.setItem(localKey(), JSON.stringify({ ts: Date.now(), doc: S.doc })); } catch (e) { /* квота */ } }, 500);
  const dropLocal = () => { try { localStorage.removeItem(localKey()); } catch (e) { /* ignore */ } };

  const autoPub = () => localStorage.getItem('spe-autopublish') !== '0';

  // ---------- Защита от перезаписи чужих правок ----------
  // Перед записью сверяем ревизии черновика и опубликованной версии с теми, что были при открытии.
  // Отличаются → кто-то правил страницу (Studio, другая модалка) → не пишем, показываем выбор.
  async function checkConflict() {
    const cur = await q(`*[_id in [$a, $b]]{_id,_rev,_updatedAt}`, { a: S.id, b: 'drafts.' + S.id });
    const d = cur.find(x => x._id.startsWith('drafts.')), p = cur.find(x => !x._id.startsWith('drafts.'));
    const now = { draft: d?._rev || null, pub: p?._rev || null };
    if (now.draft === S.base.draft && now.pub === S.base.pub) return null;
    const changedDoc = (d && now.draft !== S.base.draft) ? d : p || d;
    const info = { now, when: changedDoc?._updatedAt, who: '' };
    // кто изменил — из истории Sanity (если доступно)
    try {
      const tx = await (await fetch(`${env().base}/data/history/${env().ds}/transactions/${changedDoc._id}?excludeContent=true&reverse=true&limit=1`, { headers: authHeaders(), credentials: 'include' })).text();
      const author = JSON.parse(tx.trim().split('\n')[0] || '{}').author;
      const me = await api('/users/me').catch(() => ({}));
      if (author && author === me.id) info.who = 'вы (в другой вкладке или в Studio)';
      else if (author) { const u = await api(`/users/${author}`).catch(() => null); info.who = u?.displayName || u?.name || ''; }
    } catch (e) { /* не страшно */ }
    return info;
  }
  function conflictHtml() {
    const c = S.conflict; if (!c) return '';
    const when = c.when ? new Date(c.when).toLocaleString().slice(0, 17) : '';
    return `<div class="spe-conflict"><b>⚠ Пока вы редактировали, эту страницу изменили${c.who ? ` — ${esc(c.who)}` : ''}${when ? `, ${esc(when)}` : ''}.</b><br>
      Ваши правки НЕ отправлены, чтобы не затереть чужие. Выберите, что делать:
      <div class="spe-row">
        <button class="spe-btn" data-cf="export" data-tip="Скачать вашу версию файлом — потом её можно загрузить «Импортом из файла»">Сохранить мои правки в файл</button>
        <button class="spe-btn" data-cf="reload" data-tip="Открыть свежую версию страницы. Ваши неотправленные правки пропадут — сначала сохраните их в файл, если нужны">Загрузить свежую версию</button>
        <button class="spe-btn" data-cf="force" data-tip="Отправить вашу версию поверх. Чужие правки будут потеряны">Перезаписать своими</button>
      </div></div>`;
  }
  function bindConflict(root) {
    root.querySelectorAll('[data-cf]').forEach(b => b.onclick = async () => {
      const a = b.dataset.cf;
      if (a === 'export') exportPage().catch(e => status('Экспорт: ' + e.message, true));
      if (a === 'reload') { if (!confirm('Загрузить свежую версию? Ваши неотправленные правки пропадут.')) return; S.dirty = false; dropLocal(); await openPage(S.id); status('Загружена свежая версия'); }
      if (a === 'force') { if (!confirm('Перезаписать страницу вашей версией? Чужие правки будут потеряны.')) return; S.base = S.conflict.now; S.conflict = null; renderForm(); sendToSanity(); }
    });
  }

  async function saveDraft() {
    ensureKeys(S.doc);
    const d = stripMeta(S.doc); d._id = 'drafts.' + S.id;
    const r = await mutate([{ createOrReplace: d }]);
    S.doc._id = d._id;
    S.base.draft = r.transactionId; // новая ревизия документа = id транзакции
    markListDraft();
  }
  async function publishNow() {
    ensureKeys(S.doc);
    const d = stripMeta(S.doc); d._id = S.id;
    const r = await mutate([{ createOrReplace: d }, { delete: { id: 'drafts.' + S.id } }]);
    S.base = { draft: null, pub: r.transactionId };
    S.doc._id = S.id; S.published = clone(d);
    await loadPages(); renderList();
    watchDelivery(r?.transactionId);
  }

  // Главная кнопка: отправить всё в Sanity и, если проверки пройдены, опубликовать
  async function sendToSanity(forcePublish) {
    if (!S.doc || S.saving) return;
    S.saving = true; renderHeadButtons();
    try {
      status('Проверяю, не менял ли кто-то страницу…');
      const cf = await checkConflict();
      if (cf) {
        S.conflict = cf; S.saving = false; renderHeadButtons(); renderForm();
        $.querySelector('#spe-fields').scrollTop = 0;
        status('Не отправлено: страницу изменил кто-то другой', true);
        return;
      }
      S.conflict = null;
      const errs = validate(S.doc);
      const wantPub = forcePublish || autoPub();
      if (wantPub && !errs.length) {
        status('Отправляю и публикую…');
        await publishNow();
        S.dirty = false; dropLocal();
        status('✓ Опубликовано · ' + new Date().toLocaleTimeString().slice(0, 5));
      } else {
        status('Сохраняю черновик в Sanity…');
        await saveDraft();
        S.dirty = false; dropLocal();
        if (wantPub && errs.length) { status(`Сохранено черновиком: не опубликовано, ошибок — ${errs.length} (список в форме)`, true); renderForm(); }
        else status('✓ Черновик сохранён в Sanity · ' + new Date().toLocaleTimeString().slice(0, 5));
      }
    } catch (e) { status('Ошибка: ' + e.message, true); }
    S.saving = false; renderHeadButtons();
  }

  // Слежение за доставкой: бэкенд Starter (≤1 мин), затем сайт (≤5 мин)
  let deliveryRun = 0;
  async function watchDelivery() {
    const run = ++deliveryRun;
    const slug = get(S.doc, 'url.current'), rev = null;
    const marker = (get(S.doc, 'headerCallToAction.title.ru') || (S.doc.detail.ru.find(b => b._type === 'block')?.children || []).map(c => c.text).join('') || '').trim();
    const pubRev = (await q(`*[_id==$id][0]._rev`, { id: S.id }).catch(() => rev));
    const backUrl = `https://static-content.starterapp.co/api/${ws()}/info_pages`;
    const t0 = Date.now(), sec = () => Math.round((Date.now() - t0) / 1000);
    const alive = () => run === deliveryRun && $;
    let inBack = false;
    while (alive() && Date.now() - t0 < 180000) {
      try {
        const r = await gmGet(`${backUrl}?t=${Date.now()}`);
        const list = JSON.parse(r.text); const arr = Array.isArray(list) ? list : (list.data || list.items || []);
        const p = arr.find(x => (x.url?.current || '').replace(/^\//, '') === slug);
        if (p && (!pubRev || p._rev === pubRev)) { inBack = true; break; }
      } catch (e) { /* сеть — пробуем ещё */ }
      setDelivery(sec() < 60 ? `Синк в Starter… ${sec()} с` : `Синк идёт дольше обычного… ${sec()} с`, sec() >= 60);
      await new Promise(r => setTimeout(r, 5000));
    }
    if (!alive()) return;
    if (!inBack) { setDelivery('⚠ За 3 мин не попало в бэкенд Starter. Проверьте project-checker или сообщите разработчикам', true); return; }
    setDelivery(`✓ В бэкенде Starter за ${sec()} с · жду сайт…`);
    if (!S.siteUrl || !marker) { setDelivery(`✓ В бэкенде Starter за ${sec()} с · на сайте — в течение ~5 мин`); return; }
    while (alive() && Date.now() - t0 < 300000) {
      try {
        const r = await gmGet(`${S.siteUrl}/${slug}?spe=${Date.now()}`);
        if (r.text.includes(esc(marker).slice(0, 60)) || r.text.includes(marker.slice(0, 60))) { setDelivery(`✓ На сайте через ${sec()} с`); return; }
      } catch (e) { /* ignore */ }
      setDelivery(`✓ В бэкенде · жду сайт… ${sec()} с`);
      await new Promise(r => setTimeout(r, 10000));
    }
    if (alive()) setDelivery('⚠ За 5 мин на сайте не обновилось (кэш сайта). Откройте страницу позже', true);
  }
  function setDelivery(t, err) { const el = $?.querySelector('#spe-deliv'); if (el) { el.textContent = t; el.style.color = err ? 'var(--err)' : ''; } }

  async function publish() { return sendToSanity(true); }
  async function discardDraft() {
    if (!S.published) { status('Это неопубликованная страница — сбрасывать не к чему', true); return; }
    const cf = await checkConflict();
    if (cf && !confirm(`Черновик только что менял${cf.who ? ' ' + cf.who : ' кто-то другой'}. Всё равно удалить его вместе с этими правками?`)) return;
    if (!cf && !confirm('Удалить черновик и вернуть опубликованную версию?')) return;
    await mutate([{ delete: { id: 'drafts.' + S.id } }]);
    await openPage(S.id); await loadPages(); renderList();
    status('Черновик удалён');
  }
  function changed(rerenderForm) {
    S.dirty = true; saveLocal(); schedulePreview();
    if (rerenderForm) renderForm(); else refreshErrors();
    renderHeadButtons();
  }

  // ===================================================================
  // 9. Рендер модалки
  // ===================================================================
  let $ = null; // корень
  function status(t, err) { const el = $?.querySelector('#spe-status'); if (el) { el.textContent = t; el.classList.toggle('err', !!err); } }

  async function openModal() {
    if ($) return;
    if (!(await loadEnv()) || !env().pid) { alert('Не найден projectId Sanity — откройте Studio проекта.'); return; }
    if ($) return;
    if (!document.getElementById('spe-style')) { const st = document.createElement('style'); st.id = 'spe-style'; st.textContent = CSS; document.head.appendChild(st); }
    $ = document.createElement('div'); $.id = 'spe-overlay';
    $.innerHTML = `<div id="spe-modal">
      <div id="spe-head"><h2 style="display:flex;align-items:center;gap:6px"><span style="color:var(--a);display:inline-flex">${EYE_SVG}</span>Контентные страницы</h2><span id="spe-title" class="grow"></span>
        <span style="display:flex;flex-direction:column;align-items:flex-end"><span id="spe-status"></span><span id="spe-deliv" class="spe-h" style="margin:0"></span></span>
        <span id="spe-hbtns" class="spe-row"></span><button class="spe-x spe-theme" id="spe-theme"></button><button class="spe-x" title="Закрыть">×</button></div>
      <div id="spe-main">
        <div id="spe-list"><input placeholder="Поиск страницы…"><div id="spe-pages"></div>
          <div style="padding:8px;display:flex;flex-direction:column;gap:6px"><button class="spe-btn" id="spe-new" style="width:100%">+ Новая страница</button>
            <label class="spe-btn" style="width:100%;text-align:center;cursor:pointer" data-tip="Загрузить страницу из файла, скачанного кнопкой «Экспорт» в другом проекте. Создастся черновик; то, что не удалось перенести (блюда, баннеры и т.п.), будет подсвечено">Импорт из файла<input type="file" accept=".json,application/json" hidden id="spe-import"></label></div></div>
        <div id="spe-form"><div id="spe-tabs"></div><div id="spe-fields"></div></div>
        <div id="spe-prev"><div id="spe-ptools"></div><div id="spe-pwrap"><iframe id="spe-iframe"></iframe></div></div>
      </div></div>`;
    document.body.appendChild($);
    $.querySelector('.spe-x:not(.spe-theme)').onclick = closeModal;
    applyTheme();
    $.querySelector('#spe-theme').onclick = () => { try { localStorage.setItem('spe-theme', isDark() ? 'light' : 'dark'); } catch {} applyTheme(); };
    // Перетаскивание блоков в списке «Содержимое» — за строку блока
    makeSortable({
      root: $, doc: document,
      getItems: () => [...$.querySelectorAll('.spe-blk')].map(el => ({ el, start: +el.dataset.i, end: +el.dataset.i })),
      grab: t => (S.tab === 'content' && t.closest?.('.spe-bh') && !t.closest('button')) ? t.closest('.spe-bh') : null,
      scroller: () => $.querySelector('#spe-fields')
    });
    // Подсказки: показываем под элементом, сдвигаем внутрь модалки, если не помещается
    const tip = document.createElement('div'); tip.id = 'spe-tip'; $.appendChild(tip);
    let tipEl = null;
    $.addEventListener('mouseover', e => {
      const t = e.target.closest?.('[data-tip]');
      if (t === tipEl) return;
      tipEl = t;
      if (!t) { tip.classList.remove('show'); return; }
      tip.textContent = t.dataset.tip;
      const box = $.querySelector('#spe-modal').getBoundingClientRect(), r = t.getBoundingClientRect(), pad = 8;
      tip.style.left = '0px'; tip.style.top = '0px';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = r.left + r.width / 2 - w / 2;
      x = Math.max(box.left + pad, Math.min(x, box.right - pad - w));
      let y = r.bottom + 8;
      if (y + h > box.bottom - pad) y = r.top - 8 - h; // не влезает снизу — показываем сверху
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      tip.classList.add('show');
    });
    $.addEventListener('mouseleave', () => { tipEl = null; tip.classList.remove('show'); });
    $.addEventListener('mousedown', () => { tipEl = null; tip.classList.remove('show'); });
    $.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'ы')) { e.preventDefault(); sendToSanity(); }
    });
    $.querySelector('#spe-list input').oninput = renderList;
    $.querySelector('#spe-new').onclick = () => newPage().catch(e => status(e.message, true));
    $.querySelector('#spe-import').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importPage(f).catch(er => status('Импорт: ' + er.message, true)); };
    status('Загрузка…');
    (async () => {
      try {
        await loadPages(); renderList();
        const m = location.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
        const cand = m && S.pages.find(p => p._id.replace('drafts.', '') === m[1]);
        if (cand) await openPage(m[1]); else render();
        status('');
        loadSite();
      } catch (e) { status('Ошибка: ' + e.message, true); }
    })();
  }
  // Тема модалки (светлая/тёмная) — запоминается в браузере; на предпросмотр не влияет
  const MOON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c.13 0 .26 0 .39 0a7.5 7.5 0 0 0 7.92 12.45a9 9 0 1 1 -8.31 -12.45z"/></svg>';
  const SUN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/></svg>';
  const isDark = () => { try { return localStorage.getItem('spe-theme') === 'dark'; } catch { return false; } };
  function applyTheme() {
    if (!$) return;
    const dark = isDark();
    $.classList.toggle('spe-dark', dark);
    const b = $.querySelector('#spe-theme');
    b.innerHTML = dark ? SUN_SVG : MOON_SVG;
    b.dataset.tip = dark ? 'Светлая тема окна' : 'Тёмная тема окна (предпросмотр не меняется)';
  }
  async function closeModal() {
    if (!(await resolveUnsent())) return;
    deliveryRun++;
    $?.remove(); $ = null;
  }

  function render() { renderList(); renderHeadButtons(); renderTabs(); renderForm(); renderPreviewTools(); schedulePreview(); }

  function renderHeadButtons() {
    const t = $.querySelector('#spe-title');
    t.textContent = S.doc ? `${get(S.doc, 'title.ru') || ''} · /${get(S.doc, 'url.current') || ''}` : '';
    const h = $.querySelector('#spe-hbtns');
    if (!S.doc) { h.innerHTML = ''; return; }
    const hasDraft = S.doc._id?.startsWith('drafts.');
    const errs = validate(S.doc).length;
    const ap = autoPub();
    const label = S.saving ? 'Отправляю…' : S.dirty ? (ap && !errs ? 'Отправить и опубликовать' : 'Отправить в Sanity') : hasDraft ? 'Опубликовать черновик' : 'Всё отправлено ✓';
    const sendTip = S.dirty
      ? (ap && !errs ? 'Записать правки в Sanity и сразу опубликовать. На сайте появится через 1–5 мин. Горячая клавиша Ctrl+S'
        : ap ? 'Есть ошибки (список в форме) — правки сохранятся черновиком, без публикации. Ctrl+S'
          : 'Сохранить правки в Sanity черновиком, без публикации (автопубликация выключена). Ctrl+S')
      : hasDraft ? 'В Sanity есть неопубликованный черновик — опубликовать его' : 'Все правки уже в Sanity';
    h.innerHTML = `${S.published && hasDraft && !S.dirty ? '<button class="spe-btn" data-a="discard" data-tip="Удалить неопубликованный черновик и вернуть страницу к версии, которая сейчас на сайте">Сбросить черновик</button>' : ''}
      <button class="spe-btn" data-a="dupage" data-tip="Создать копию этой страницы в этом же проекте — с новым названием и URL. Копия создаётся черновиком и не публикуется">Дублировать</button>
      <button class="spe-btn" data-a="export" data-tip="Скачать страницу файлом, чтобы загрузить её в другой проект кнопкой «Импорт из файла» (слева внизу). Сохраняется версия, открытая сейчас в модалке">Экспорт</button>
      <button class="spe-btn" data-a="studio" data-tip="Закрыть эту модалку и открыть страницу в обычном интерфейсе Sanity — для полей, которых здесь нет (например, тип страницы)">Открыть в Sanity</button>
      ${S.published ? '<button class="spe-btn" data-a="site" data-tip="Открыть опубликованную страницу на сайте в новой вкладке. Свежие правки появляются там через 1–5 мин после публикации">На сайте ↗</button>' : ''}
      <label class="spe-h" style="margin:0;display:flex;gap:4px;align-items:center;cursor:pointer" data-tip="Включено — кнопка справа сразу публикует страницу, если в ней нет ошибок. Выключено — правки сохраняются только черновиком"><input type="checkbox" data-a="ap" ${ap ? 'checked' : ''}>автопубликация</label>
      <button class="spe-btn pri" data-a="send" data-tip="${esc(sendTip)}" ${S.saving || (!S.dirty && !hasDraft) ? 'disabled' : ''}>${label}</button>`;
    h.querySelector('[data-a=send]').onclick = () => sendToSanity(!S.dirty && hasDraft);
    h.querySelector('[data-a=ap]').onchange = e => { localStorage.setItem('spe-autopublish', e.target.checked ? '1' : '0'); renderHeadButtons(); };
    const dd = h.querySelector('[data-a=discard]'); if (dd) dd.onclick = discardDraft;
    h.querySelector('[data-a=export]').onclick = () => exportPage().catch(e => status('Экспорт: ' + e.message, true));
    h.querySelector('[data-a=dupage]').onclick = () => duplicateDialog();
    h.querySelector('[data-a=studio]').onclick = () => { closeModal(); location.href = `/${ws()}/structure/static-item;pages;${S.id}`; };
    const sb = h.querySelector('[data-a=site]'); if (sb) sb.onclick = () => window.open(`${S.siteUrl || ''}/${S.published.url?.current}`, '_blank');
  }

  function markListDraft() {
    const p = S.pages.find(x => x._id.replace('drafts.', '') === S.id);
    if (p && !p._id.startsWith('drafts.')) S.pages.unshift({ ...p, _id: 'drafts.' + S.id, title: get(S.doc, 'title.ru'), slug: get(S.doc, 'url.current') });
    renderList();
  }
  function renderList() {
    const f = ($.querySelector('#spe-list input').value || '').toLowerCase();
    const map = new Map();
    S.pages.forEach(p => {
      const id = p._id.replace('drafts.', '');
      const o = map.get(id) || { id };
      if (p._id.startsWith('drafts.')) o.draft = p; else o.pub = p;
      map.set(id, o);
    });
    const DT = { offer: 'Оферта', privacy: 'Политика', loyalty: 'Лояльность', personalDataConsent: 'Согласие на ПД' };
    const rows = [...map.values()].map(o => {
      const p = o.draft || o.pub;
      return { id: o.id, title: p.title || '(без названия)', slug: p.slug, act: (o.pub || o.draft).isActive, draft: !!o.draft, pub: !!o.pub, kind: p.type === 'popup' ? 'pop-up' : (DT[p.documentType] || 'страница') };
    }).filter(r => !f || (r.title + ' ' + r.slug).toLowerCase().includes(f));
    $.querySelector('#spe-pages').innerHTML = rows.map(r => `<button class="spe-pg ${r.id === S.id ? 'on' : ''}" data-id="${r.id}">
      <span class="dot ${r.draft ? 'dr' : r.act ? '' : 'off'}" title="${r.draft ? 'Есть неопубликованные правки' : r.act ? 'Активна' : 'Выключена'}"></span>${esc(r.title)}
      <small>/${esc(r.slug || '')} · ${r.kind}${r.pub ? '' : ' · не опубликована'}</small></button>`).join('');
    $.querySelectorAll('.spe-pg').forEach(b => b.onclick = () => openPage(b.dataset.id).catch(e => status(e.message, true)));
  }

  function renderTabs() {
    const tabs = [['main', 'Основное'], ['cover', 'Обложка'], ['header', 'Шапка'], ['content', 'Содержимое']];
    const el = $.querySelector('#spe-tabs');
    el.innerHTML = S.doc ? tabs.map(([k, l]) => `<button class="spe-tab ${S.tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('') : '';
    el.querySelectorAll('.spe-tab').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderTabs(); renderForm(); });
    refreshErrors();
  }

  // ---------- поля формы ----------
  function fieldHtml(f, obj, id) {
    const v = get(obj, f.p);
    const lab = `<label>${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}</label>`;
    const hint = f.h ? `<div class="spe-h">${esc(f.h)}</div>` : '';
    let inp = '';
    switch (f.t) {
      case 'text': case 'slug':
        inp = `<input class="spe-in" data-p="${f.p}" data-k="${f.k || f.t}" value="${esc(v)}">`; break;
      case 'textarea':
        inp = `<textarea class="spe-in" data-p="${f.p}" rows="${f.rows || 3}">${esc(v)}</textarea>`; break;
      case 'bool':
        inp = `<div class="spe-radio" data-p="${f.p}" data-k="bool">${YESNO.map(([k, l]) => `<button class="${String(!!v) === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>`; break;
      case 'radio':
        inp = `<div class="spe-radio" data-p="${f.p}">${f.o.map(([k, l]) => `<button class="${v === k ? 'on' : ''}" data-v="${k}">${esc(l)}</button>`).join('')}</div>`; break;
      case 'color':
        inp = `<div class="spe-row"><input type="color" data-p="${f.p}" data-k="color" value="${esc(v?.hex || '#ffffff')}">
          <span class="spe-h" style="margin:0">${v?.hex || 'не задан'}</span>${v ? `<button class="spe-ib" data-clear="${f.p}" title="Очистить">✕</button>` : ''}</div>`; break;
      case 'image':
        inp = `<div class="spe-img">${v?.asset?._ref ? `<img src="${imgUrl(v.asset._ref, 120)}">` : ''}
          <label class="spe-btn" style="cursor:pointer">${v?.asset ? 'Заменить' : 'Загрузить'}<input type="file" accept="image/*" hidden data-p="${f.p}" data-k="image"></label>
          ${v?.asset ? `<button class="spe-ib" data-clear="${f.p}" title="Убрать">✕</button>` : ''}</div>`; break;
      case 'buttonCTA':
        inp = `<div class="spe-sub">
          <div class="spe-f"><label>Текст</label><input class="spe-in" data-p="${f.p}.label.ru" value="${esc(get(obj, f.p + '.label.ru'))}" placeholder="Пусто — кнопки нет"></div>
          <div class="spe-f"><label>Ссылка</label><input class="spe-in" data-p="${f.p}.url" value="${esc(get(obj, f.p + '.url'))}" placeholder="https://… или /страница или tel://+7…"></div>
          <div class="spe-f" style="margin:0"><label>Иконка</label><div class="spe-radio" data-p="${f.p}.icon">${BTN_ICON.map(([k, l]) => `<button class="${(get(obj, f.p + '.icon') || '') === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div></div>
        </div>`; break;
    }
    return `<div class="spe-f">${lab}${inp}${hint}</div>`;
  }
  function fieldsHtml(list, obj) {
    return list.filter(f => !f.show || f.show(S.doc, obj)).map(f => f.sec ? `<div class="spe-sec">${esc(f.sec)}</div>` : fieldHtml(f, obj)).join('');
  }
  // Привязка событий: target — объект, в который пишем (документ или блок)
  function bind(root, target, rerenderOn) {
    root.querySelectorAll('input[data-p]:not([type=file]):not([type=color]),textarea[data-p]').forEach(el => el.oninput = () => {
      let val = el.value;
      if (el.dataset.k === 'slug') { val = val.toLowerCase().replace(/[^a-z0-9-]/g, '-'); }
      if (el.dataset.k === 'num') { val = val.trim() === '' ? undefined : (parseInt(val, 10) || undefined); }
      setVal(target, el.dataset.p, val);
      if (el.dataset.p === 'title.ru' || el.dataset.p === 'url.current') renderHeadButtons();
      changed(false);
      updateBlockTitle(root);
    });
    root.querySelectorAll('input[type=color][data-p]').forEach(el => el.oninput = () => { set(target, el.dataset.p, hexToColor(el.value)); el.nextElementSibling.textContent = el.value; changed(false); });
    root.querySelectorAll('.spe-radio[data-p]').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => {
      let v = b.dataset.v; if (g.dataset.k === 'bool') v = v === 'true'; if (v === '') v = undefined;
      set(target, g.dataset.p, v);
      g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      changed(rerenderOn !== false);
    }));
    root.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { set(target, b.dataset.clear, undefined); changed(true); });
    root.querySelectorAll('input[type=file][data-k=image]').forEach(el => el.onchange = async () => {
      const file = el.files[0]; if (!file) return;
      status('Загружаю картинку…');
      try { const id = await uploadImage(file); set(target, el.dataset.p, { _type: 'image', asset: { _type: 'reference', _ref: id } }); status('Картинка загружена'); changed(true); }
      catch (e) { status(e.message, true); }
    });
  }
  function setVal(target, p, val) {
    // пустые кнопки/строки удаляем, чтобы не плодить мусор в документе
    set(target, p, val);
    const btn = p.match(/^(.*(?:primaryButton|secondaryButton))\./);
    if (btn) { const b = get(target, btn[1]); if (b) { b._type = 'buttonCTA'; if (b.label) b.label._type = 'localeString'; } }
    const lsm = p.match(/^(.*)\.ru$/); if (lsm) { const o = get(target, lsm[1]); if (o && !o._type) o._type = 'localeString'; }
  }

  function renderForm() {
    const el = $.querySelector('#spe-fields');
    if (!S.doc) { el.innerHTML = '<div class="spe-h" style="padding:20px">Выберите страницу слева или создайте новую.</div>'; return; }
    let errHtml = conflictHtml() + `<div id="spe-errs-slot">${errPanelHtml()}</div>`;
    // Замечания после импорта: клик — перейти к месту, ✓ — отметить как проверенное
    const iss = S.issues || [];
    if (iss.length) {
      errHtml = `<div class="spe-warn"><div class="spe-row" style="justify-content:space-between"><b>⚠ После импорта проверьте (${iss.length}):</b><button class="spe-ib" data-iss-all title="Скрыть все замечания" style="width:auto;padding:0 6px!important;font-size:12px!important">скрыть все</button></div>
        ${iss.map((x, i) => `<div class="spe-iss"><a data-iss-go="${i}">${esc(whereLabel(x.key))}</a> — ${esc(x.text)} <button class="spe-ib" data-iss-ok="${i}" title="Проверено, скрыть">✓</button></div>`).join('')}</div>` + errHtml;
    }
    const sc = el.scrollTop;
    if (S.tab === 'main') {
      el.innerHTML = errHtml + fieldsHtml(MAIN_FIELDS, S.doc) +
        `<div class="spe-h">Тип документа: <b>${esc(S.doc.documentType)}</b> (не меняется в этом редакторе).</div>`;
      bind(el, S.doc);
    } else if (S.tab === 'cover') {
      el.innerHTML = errHtml + `<div class="spe-h" style="margin-bottom:8px">Обложка — первый экран страницы. Если заголовок пустой и фон «Без фона», обложки не будет.</div>` + fieldsHtml(COVER_FIELDS, S.doc);
      bind(el, S.doc);
    } else if (S.tab === 'header') {
      el.innerHTML = errHtml + `<div class="spe-h" style="margin-bottom:8px">Шапка сайта (меню, логотип) на этой странице.</div>` + fieldsHtml(HEADER_FIELDS, S.doc);
      bind(el, S.doc);
    } else renderContent(el, errHtml);
    el.scrollTop = sc;
    el.querySelectorAll('[data-iss-ok]').forEach(b => b.onclick = e => { e.stopPropagation(); S.issues.splice(+b.dataset.issOk, 1); saveIssues(); renderForm(); });
    const all = el.querySelector('[data-iss-all]'); if (all) all.onclick = () => { S.issues = []; saveIssues(); renderForm(); };
    el.querySelectorAll('[data-iss-go]').forEach(a => a.onclick = () => goTo(S.issues[+a.dataset.issGo]?.key));
    bindErrPanel(el); bindConflict(el);
    refreshErrors();
  }

  // ---------- Ошибки заполнения: список с переходом + подсветка блоков и вкладок ----------
  function errPanelHtml() {
    const errs = S.doc ? validate(S.doc) : [];
    if (!errs.length) return '';
    return `<div id="spe-errs"><b>Перед публикацией исправьте (${errs.length}):</b>
      ${errs.map(x => `<div class="spe-iss"><a data-err-go="${esc(x.key)}">${esc(whereLabel(x.key))}</a> — ${esc(x.text)}</div>`).join('')}</div>`;
  }
  function bindErrPanel(root) { root.querySelectorAll('[data-err-go]').forEach(a => a.onclick = () => goTo(a.dataset.errGo)); }
  // Обновить ошибки без перерисовки формы (вызывается на каждый ввод)
  function refreshErrors() {
    if (!$ || !S.doc) return;
    const errs = validate(S.doc);
    const slot = $.querySelector('#spe-errs-slot');
    if (slot) { const h = errPanelHtml(); if (slot.innerHTML !== h) { slot.innerHTML = h; bindErrPanel(slot); } }
    const byKey = new Map(); errs.forEach(x => byKey.set(x.key, [...(byKey.get(x.key) || []), x.text]));
    $.querySelectorAll('.spe-blk').forEach(bl => {
      const b = S.doc.detail.ru[+bl.dataset.i]; const list = b && byKey.get(b._key);
      bl.classList.toggle('err', !!list);
      const mark = bl.querySelector('.spe-errmark'); if (mark) mark.style.display = list ? '' : 'none';
      const box = bl.querySelector('.spe-blkerr');
      if (box) box.innerHTML = list ? list.map(t => `<div>✕ ${esc(t)}</div>`).join('') : '';
      if (box) box.style.display = list ? '' : 'none';
    });
    // красные счётчики на вкладках
    const tabOf = k => ['main', 'cover', 'header'].includes(k) ? k : 'content';
    const cnt = {}; errs.forEach(x => { const t = tabOf(x.key); cnt[t] = (cnt[t] || 0) + 1; });
    $.querySelectorAll('.spe-tab').forEach(t => {
      let badge = t.querySelector('.spe-tabcnt');
      const n = cnt[t.dataset.t] || 0;
      if (!n) { badge?.remove(); return; }
      if (!badge) { badge = document.createElement('span'); badge.className = 'spe-tabcnt'; t.appendChild(badge); }
      badge.textContent = n;
    });
  }

  // ---------- блоки контента ----------
  function blockTitle(b) {
    switch (b._type) {
      case 'block': return blockToText(b).replace(/\*\*|\[|\]\([^)]*\)/g, '') || '(пустой текст)';
      case 'button': return b.label || '';
      case 'callToAction': return get(b, 'title.ru') || '';
      case 'accordionWrapper': return (b.accordionList || []).map(a => a.title).join(', ');
      case 'productSelection': return (b.productSelectionList || []).map(r => S.meals[r._ref]?.n || '…').join(', ');
      case 'iframeWrapper': return b.iframe?.current || '';
      case 'image': return b.alt || '';
      case 'mediaWrapper': return `${(b.mediaList || []).length} шт.`;
      case 'bannersWrapper': return (b.banners || []).map(r => S.banners[r._ref]?.n || '…').join(', ');
      case 'tableWrapper': return `${(b.table?.rows || []).length} строк`;
      default: return '';
    }
  }
  function updateBlockTitle(root) {
    const bl = root.closest?.('.spe-blk'); if (!bl) return;
    const b = S.doc.detail.ru[+bl.dataset.i]; if (b) bl.querySelector('.nm').textContent = blockTitle(b);
  }
  function renderContent(el, errHtml) {
    const list = S.doc.detail.ru;
    el.innerHTML = errHtml + `<div class="spe-h" style="margin-bottom:8px">Блоки идут сверху вниз. Клик по блоку — редактировать, перетаскивание за строку — переставить (и здесь, и в предпросмотре). В тексте: <b>**жирный**</b>, [текст ссылки](https://…).</div>` +
      list.map((b, i) => {
        const kind = blockKind(b);
        const tp = kind === 'text' ? (b.listItem ? (b.listItem === 'bullet' ? 'Список •' : 'Список 1.') : TEXT_STYLES.find(s => s[0] === b.style)?.[1] || 'Текст') : BLOCKS[kind]?.title || b._type;
        const on = S.openBlock === b._key;
        const bi = (S.issues || []).filter(x => x.key === b._key);
        return `<div class="spe-blk ${on ? 'on' : ''} ${bi.length ? 'warn' : ''}" data-i="${i}">
          <div class="spe-bh"><span class="spe-grip" title="Перетащите, чтобы переставить блок">⋮⋮</span><span class="spe-errmark" title="В блоке есть ошибка — без исправления страница не опубликуется" style="display:none">✕</span>${bi.length ? '<span title="Есть замечание после импорта">⚠</span>' : ''}<span class="tp">${esc(tp)}</span><span class="nm">${esc(blockTitle(b))}</span>
            <button class="spe-ib" data-a="dup" title="Дублировать">⧉</button><button class="spe-ib" data-a="del" title="Удалить">🗑</button></div>
          ${on ? `<div class="spe-bb"><div class="spe-blkerr" style="display:none"></div>${bi.map(x => `<div class="spe-warn" style="margin:6px 0">⚠ ${esc(x.text)}</div>`).join('')}${blockFormHtml(b)}</div>` : ''}</div>`;
      }).join('') +
      `<div class="spe-add"><button class="spe-btn pri" id="spe-addbtn">+ Добавить блок</button></div>`;

    el.querySelectorAll('.spe-blk').forEach(bl => {
      const i = +bl.dataset.i, b = list[i];
      bl.querySelector('.spe-bh').onclick = e => {
        if (Date.now() - S.justDragged < 400) return; // это было перетаскивание, а не клик
        const a = e.target.dataset.a;
        if (a === 'dup') { const c = clone(b); c._key = key(); (c.children || []).forEach(x => x._key = key()); list.splice(i + 1, 0, c); changed(true); }
        else if (a === 'del') { if (confirm('Удалить блок?')) { list.splice(i, 1); changed(true); } }
        else if (!a) { S.openBlock = S.openBlock === b._key ? null : b._key; renderForm(); highlightPreview(b._key); }
      };
      const body = bl.querySelector('.spe-bb'); if (body) bindBlock(body, b);
    });
    el.querySelector('#spe-addbtn').onclick = e => {
      e.stopPropagation();
      const wrap = e.target.parentElement;
      if (wrap.querySelector('.spe-menu')) { wrap.querySelector('.spe-menu').remove(); return; }
      const m = document.createElement('div'); m.className = 'spe-menu';
      m.innerHTML = Object.entries(BLOCKS).map(([k, v]) => `<button data-k="${k}">${v.title}</button>`).join('');
      wrap.appendChild(m);
      m.onclick = ev => {
        const k = ev.target.dataset.k; if (!k) return;
        const b = BLOCKS[k].make(); b._key = key();
        list.push(b); S.openBlock = b._key; changed(true);
        setTimeout(() => { const f = $.querySelector('#spe-fields'); f.scrollTop = f.scrollHeight; }, 0);
      };
    };
  }

  const CTA_FIELDS = [
    { sec: 'Информация' },
    { p: 'title.ru', t: 'text', l: 'Заголовок' },
    { p: 'description.ru', t: 'textarea', l: 'Описание' },
    { p: 'primaryButton', t: 'buttonCTA', l: 'Основная кнопка' },
    { p: 'secondaryButton', t: 'buttonCTA', l: 'Второстепенная кнопка' },
    { p: 'logo', t: 'image', l: 'Изображение на блоке' },
    { p: 'style', t: 'radio', l: 'Расположение', o: [['vertical', 'Картинка над заголовком'], ['horizontal', 'Пополам: картинка | текст']] },
    { p: 'position', t: 'radio', l: 'Порядок', o: [['left', 'Картинка слева'], ['right', 'Картинка справа']], show: (d, b) => b.style === 'horizontal' },
    { p: 'imageSize', t: 'radio', l: 'Высота блока по', o: [['arbitrary', 'Пропорциям картинки'], ['content', 'Тексту']], show: (d, b) => b.style === 'horizontal' },
    { sec: 'Фон' },
    { p: 'background', t: 'radio', l: 'Фон', o: [['null', 'Без фона'], ['image', 'Картинка'], ['color', 'Цвет']] },
    { p: 'backgroundColor', t: 'color', l: 'Цвет фона', show: (d, b) => b.background === 'color' },
    { p: 'cover', t: 'image', l: 'Фон — компьютер', show: (d, b) => b.background === 'image' },
    { p: 'coverMobile', t: 'image', l: 'Фон — телефон', show: (d, b) => b.background === 'image' },
    { p: 'backgroundBlackout', t: 'bool', l: 'Затемнить фон' },
    { sec: 'Дизайн' },
    { p: 'pane', t: 'radio', l: 'Тема (цвет текста)', o: [['dark', 'Тёмная'], ['light', 'Светлая']], h: 'Цветовая схема текста и кнопок блока — смотрите результат в предпросмотре.' },
    { p: 'width', t: 'radio', l: 'Ширина', o: [['max', 'Во всю ширину'], ['content', 'По ширине контента']] },
    { p: 'size', t: 'radio', l: 'Размер отступов и заголовка', o: [['m', 'M — стандартный'], ['l', 'L — крупный']] },
    { p: 'contentPosition', t: 'radio', l: 'Текст прижат к', o: [['center', 'Центру'], ['bottom', 'Низу']] },
  ];

  function blockFormHtml(b) {
    switch (b._type) {
      case 'block': {
        const lt = b.listItem || '';
        return `<div class="spe-f"><label>Стиль</label><div class="spe-radio" data-x="style">${TEXT_STYLES.map(([k, l]) => `<button class="${(b.style || 'normal') === k && !lt ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}
            <button class="${lt === 'bullet' ? 'on' : ''}" data-v="li:bullet">Список •</button><button class="${lt === 'number' ? 'on' : ''}" data-v="li:number">Список 1.</button></div></div>
          <div class="spe-f"><label>Текст</label><textarea class="spe-in" data-x="text" rows="4">${esc(blockToText(b))}</textarea>
          <div class="spe-h">Enter — новый абзац (создаст отдельные блоки того же стиля). **жирный**, [ссылка](https://…), телефон: [звонок](tel:+7…)</div></div>`;
      }
      case 'image':
        return `<div class="spe-f"><label>Картинка</label><div class="spe-img">${b.asset?._ref ? `<img src="${imgUrl(b.asset._ref, 120)}">` : ''}
            <label class="spe-btn" style="cursor:pointer">${b.asset ? 'Заменить' : 'Загрузить'}<input type="file" accept="image/*" hidden data-x="selfimg"></label></div></div>` +
          fieldsHtml([{ p: 'alt', t: 'text', l: 'Описание (alt)', h: 'Для поисковиков и незрячих.' }, { p: 'width', t: 'text', k: 'num', l: 'Ширина, px', h: 'Необязательно.' }, { p: 'height', t: 'text', k: 'num', l: 'Высота, px', h: 'Необязательно.' }], b);
      case 'border': return '<div class="spe-h">Горизонтальная линия для разделения смысловых частей.</div>';
      case 'button':
        return fieldsHtml([
          { p: 'label', t: 'text', l: 'Текст кнопки', req: true },
          { p: 'url', t: 'text', l: 'Ссылка', req: true, h: 'https://…, /страница, телефон — tel://+79999999999' },
          { p: 'type', t: 'radio', l: 'Вид', o: [['primary', 'Основная (заливка)'], ['secondary', 'Второстепенная']] },
          { p: 'icon', t: 'radio', l: 'Иконка', o: BTN_ICON },
        ], b);
      case 'callToAction': return fieldsHtml(CTA_FIELDS, b);
      case 'iframeWrapper':
        return fieldsHtml([
          { p: 'iframe.current', t: 'text', l: 'Ссылка для встраивания (embed)', h: 'YouTube: youtube.com/embed/ID; Яндекс.Карты: ссылка из «Поделиться → Виджет».' },
          { p: 'aspectRatio', t: 'radio', l: 'Пропорции (компьютер)', o: [['16/9', '16:9'], ['16/10', '16:10'], ['4/3', '4:3'], ['2/1', '2:1'], ['1/1', '1:1']] },
          { p: 'aspectRatioMobile', t: 'radio', l: 'Пропорции (телефон)', o: [['16/9', '16:9'], ['16/10', '16:10'], ['4/3', '4:3'], ['1/1', '1:1'], ['4/5', '4:5'], ['9/16', '9:16']] },
        ], b);
      case 'tableWrapper': {
        const rows = b.table?.rows || [];
        const cols = Math.max(1, ...rows.map(r => r.cells.length));
        return fieldsHtml([{ p: 'tableBold', t: 'radio', l: 'Выделить жирным', o: [['row', '1-ю строку'], ['column', '1-й столбец'], ['', 'Ничего']] }], b) +
          `<table class="spe-tbl" style="width:100%">${rows.map((r, ri) => `<tr>${Array.from({ length: cols }, (_, ci) => `<td><input data-x="cell" data-r="${ri}" data-c="${ci}" value="${esc(r.cells[ci] || '')}"></td>`).join('')}
            <td><button class="spe-ib" data-x="delrow" data-r="${ri}" title="Удалить строку">✕</button></td></tr>`).join('')}</table>
          <div class="spe-row" style="margin-top:6px"><button class="spe-btn" data-x="addrow">+ строка</button><button class="spe-btn" data-x="addcol">+ столбец</button><button class="spe-btn" data-x="delcol">− столбец</button></div>
          <div class="spe-h">Рекомендуется не больше 5 столбцов.</div>`;
      }
      case 'accordionWrapper':
        return (b.accordionList || []).map((a, ai) => `<div class="spe-sub" style="margin-bottom:6px">
            <div class="spe-row"><input class="spe-in" data-x="acc-t" data-i="${ai}" value="${esc(a.title)}" placeholder="Заголовок"><button class="spe-ib" data-x="acc-del" data-i="${ai}">✕</button></div>
            <textarea class="spe-in" data-x="acc-d" data-i="${ai}" rows="2" style="margin-top:4px" placeholder="Текст">${esc(a.description)}</textarea></div>`).join('') +
          `<button class="spe-btn" data-x="acc-add">+ пункт</button>`;
      case 'mediaWrapper':
        return (b.mediaList || []).map((m, mi) => `<div class="spe-sub spe-row" style="margin-bottom:6px">
            ${m.image?.asset ? `<img src="${imgUrl(m.image.asset._ref, 120)}" style="width:48px;height:48px;object-fit:cover;border-radius:6px">` : `<span class="spe-h" style="width:48px">${m.iframe ? 'iframe' : m.video ? 'видео' : '—'}</span>`}
            <input class="spe-in" data-x="med-c" data-i="${mi}" value="${esc(m.caption)}" placeholder="Подпись">
            <button class="spe-ib" data-x="med-del" data-i="${mi}">✕</button></div>`).join('') +
          `<div class="spe-row"><label class="spe-btn" style="cursor:pointer">+ фото<input type="file" accept="image/*" multiple hidden data-x="med-add"></label>
           <button class="spe-btn" data-x="med-iframe">+ iframe</button></div>`;
      case 'productSelection':
        return (b.productSelectionList || []).map((r, ri) => `<div class="spe-row" style="margin-bottom:4px">${S.meals[r._ref]?.img ? `<img src="${imgUrl(S.meals[r._ref].img, 80)}" style="width:32px;height:32px;border-radius:5px;object-fit:cover">` : ''}
            <span style="flex:1">${esc(S.meals[r._ref]?.n || r._ref)}</span><button class="spe-ib" data-x="ps-del" data-i="${ri}">✕</button></div>`).join('') +
          `<input class="spe-in" data-x="ps-q" placeholder="Найти блюдо по названию…"><div data-x="ps-res"></div>`;
      case 'bannersWrapper':
        return (b.banners || []).map((r, ri) => `<div class="spe-row" style="margin-bottom:4px"><span style="flex:1">${esc(S.banners[r._ref]?.n || r._ref)}</span><button class="spe-ib" data-x="bn-del" data-i="${ri}">✕</button></div>`).join('') +
          `<button class="spe-btn" data-x="bn-pick">+ выбрать баннер</button><div data-x="bn-res"></div>`;
    }
    return `<div class="spe-h">Этот блок пока можно редактировать только в Studio.</div>`;
  }

  function bindBlock(el, b) {
    bind(el, b);
    const list = S.doc.detail.ru;
    const X = s => el.querySelectorAll(`[data-x="${s}"]`);
    // текст
    X('style').forEach(g => g.querySelectorAll('button').forEach(btn => btn.onclick = () => {
      const v = btn.dataset.v;
      if (v.startsWith('li:')) { b.listItem = v.slice(3); b.level = 1; b.style = 'normal'; }
      else { delete b.listItem; delete b.level; b.style = v; }
      changed(true);
    }));
    X('text').forEach(t => {
      t.oninput = () => {
        const parts = t.value.split(/\n/);
        const first = textToChildren(parts[0]); b.children = first.children; b.markDefs = first.markDefs;
        changed(false); updateBlockTitle(el);
      };
      t.onkeydown = e => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        const pos = t.selectionStart, before = t.value.slice(0, pos), after = t.value.slice(pos);
        Object.assign(b, textToChildren(before));
        const nb = { _type: 'block', _key: key(), style: b.style, ...(b.listItem ? { listItem: b.listItem, level: 1 } : {}), ...textToChildren(after) };
        list.splice(list.indexOf(b) + 1, 0, nb); S.openBlock = nb._key; changed(true);
        setTimeout(() => { const ta = $.querySelector('.spe-blk.on textarea[data-x=text]'); if (ta) { ta.focus(); ta.setSelectionRange(0, 0); } }, 0);
      };
    });
    // картинка-блок
    X('selfimg').forEach(inp => inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return; status('Загружаю…');
      try { const id = await uploadImage(f); b.asset = { _type: 'reference', _ref: id }; status('Готово'); changed(true); } catch (e) { status(e.message, true); }
    });
    // таблица
    const rows = () => (b.table = b.table || { _type: 'table', rows: [] }).rows;
    X('cell').forEach(i => i.oninput = () => { const r = rows()[+i.dataset.r]; while (r.cells.length <= +i.dataset.c) r.cells.push(''); r.cells[+i.dataset.c] = i.value; changed(false); });
    X('addrow').forEach(x => x.onclick = () => { const c = Math.max(1, ...rows().map(r => r.cells.length)); rows().push({ _type: 'tableRow', _key: key(), cells: Array(c).fill('') }); changed(true); });
    X('delrow').forEach(x => x.onclick = () => { rows().splice(+x.dataset.r, 1); changed(true); });
    X('addcol').forEach(x => x.onclick = () => { rows().forEach(r => r.cells.push('')); changed(true); });
    X('delcol').forEach(x => x.onclick = () => { rows().forEach(r => r.cells.length > 1 && r.cells.pop()); changed(true); });
    // аккордеон
    const acc = () => (b.accordionList = b.accordionList || []);
    X('acc-t').forEach(i => i.oninput = () => { acc()[+i.dataset.i].title = i.value; changed(false); updateBlockTitle(el); });
    X('acc-d').forEach(i => i.oninput = () => { acc()[+i.dataset.i].description = i.value; changed(false); });
    X('acc-del').forEach(x => x.onclick = () => { acc().splice(+x.dataset.i, 1); changed(true); });
    X('acc-add').forEach(x => x.onclick = () => { acc().push({ _type: 'accordion', _key: key(), title: '', description: '' }); changed(true); });
    // галерея
    const med = () => (b.mediaList = b.mediaList || []);
    X('med-c').forEach(i => i.oninput = () => { med()[+i.dataset.i].caption = i.value; changed(false); });
    X('med-del').forEach(x => x.onclick = () => { med().splice(+x.dataset.i, 1); changed(true); });
    X('med-add').forEach(inp => inp.onchange = async () => {
      status('Загружаю фото…');
      try { for (const f of inp.files) { const id = await uploadImage(f); med().push({ _type: 'media', _key: key(), image: { _type: 'image', asset: { _type: 'reference', _ref: id } } }); } status('Готово'); changed(true); }
      catch (e) { status(e.message, true); }
    });
    X('med-iframe').forEach(x => x.onclick = () => { const u = prompt('Ссылка для встраивания (embed):'); if (u) { med().push({ _type: 'media', _key: key(), iframe: { _type: 'slug', current: u } }); changed(true); } });
    // подборка товаров
    const ps = () => (b.productSelectionList = b.productSelectionList || []);
    X('ps-del').forEach(x => x.onclick = () => { ps().splice(+x.dataset.i, 1); changed(true); });
    X('ps-q').forEach(inp => inp.oninput = debounce(async () => {
      const res = el.querySelector('[data-x="ps-res"]');
      if (inp.value.trim().length < 2) { res.innerHTML = ''; return; }
      const items = await q(`*[_type=="meal" && !(_id in path("drafts.**")) && name.ru match $t][0...12]{_id,"n":name.ru,"img":images[0].asset._ref,"price":*[_type=="mealOffer" && meal._ref==^._id][0].price}`, { t: inp.value.trim() + '*' });
      res.innerHTML = items.map(m => `<button class="spe-pg" data-id="${m._id}">${esc(m.n)}</button>`).join('') || '<div class="spe-h">Ничего не найдено</div>';
      res.querySelectorAll('button').forEach(btn => btn.onclick = () => {
        const m = items.find(x => x._id === btn.dataset.id); S.meals[m._id] = m;
        ps().push({ _type: 'reference', _key: key(), _ref: m._id }); changed(true);
      });
    }, 300));
    // баннеры
    const bn = () => (b.banners = b.banners || []);
    X('bn-del').forEach(x => x.onclick = () => { bn().splice(+x.dataset.i, 1); changed(true); });
    X('bn-pick').forEach(x => x.onclick = async () => {
      const res = el.querySelector('[data-x="bn-res"]');
      const items = await q(`*[_type=="banner" && !(_id in path("drafts.**"))]|order(sortIndex asc){_id,"n":title,status,"img":coalesce(verticalBackgroundImage.asset._ref,backgroundImage.asset._ref)}`);
      res.innerHTML = items.filter(i => !bn().some(r => r._ref === i._id)).map(i => `<button class="spe-pg" data-id="${i._id}">${esc(i.n || i._id)}${i.status === false ? ' <small>выключен</small>' : ''}</button>`).join('');
      res.querySelectorAll('button').forEach(btn => btn.onclick = () => {
        const it = items.find(i => i._id === btn.dataset.id); S.banners[it._id] = it;
        bn().push({ _type: 'reference', _key: key(), _ref: it._id }); changed(true);
      });
    });
  }

  // ===================================================================
  // 10. Предпросмотр
  // ===================================================================
  function renderPreviewTools() {
    const el = $.querySelector('#spe-ptools');
    el.innerHTML = `<span>Предпросмотр</span>
      <div class="spe-radio" id="spe-dev"><button data-v="desktop" class="${S.device === 'desktop' ? 'on' : ''}" data-tip="Показать страницу как на компьютере">Компьютер</button><button data-v="mobile" class="${S.device === 'mobile' ? 'on' : ''}" data-tip="Показать страницу шириной экрана телефона">Телефон</button></div>
      <span class="grow" style="flex:1"></span><span id="spe-site">${S.siteUrl ? esc(S.siteUrl) : ''}</span>
      <button class="spe-btn" id="spe-reload" data-tip="Заново скачать оформление сайта (стили, шапку, логотип) — если на сайте что-то поменялось">⟳</button>`;
    el.querySelectorAll('#spe-dev button').forEach(b => b.onclick = () => { S.device = b.dataset.v; renderPreviewTools(); schedulePreview(); });
    el.querySelector('#spe-reload').onclick = () => { S.siteShell = null; S.mounted = false; loadSite(true); };
  }

  // Сообщение вместо предпросмотра (пока грузится или если сайт не отвечает)
  function previewMsg(html) {
    const fr = $?.querySelector('#spe-iframe'); if (!fr) return;
    S.mounted = false;
    fr.srcdoc = `<div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#857e6f;padding:40px;max-width:520px">${html}</div>`;
  }

  // Классы CSS-модулей, которые нужны предпросмотру (остальные не храним — экономим место в кэше)
  const CLS_RE = /^(CallToAction|SanityContent|SanityContentImg|SanityContentCTA|SanityContentButton|SanityContentParagraph|Button|Link|Accordion|Table|ContentPage|Header|Media|HeaderNavWrapper|CitySelect|SidebarButton|User)_/;
  const shellCacheKey = () => `spe-shell2:${ws()}`; // 2 — в карте классов появились элементы меню шапки

  // Скачать оформление сайта: HTML страницы-образца + карта классов из CSS
  async function fetchShell(site) {
    // Образец: опубликованная контентная страница; параллельно /offer — берём того, кто ответит первым
    const sample = S.pages.find(p => !p._id.startsWith('drafts.') && p.isActive && p.documentType === 'page' && p.type === 'page' && p.slug);
    const paths = [...new Set([sample ? '/' + sample.slug.replace(/^\//, '') : null, '/offer'].filter(Boolean))];
    // Заглушка защиты от ботов (кольцо загрузки + проверка браузера) пропускает только после того,
    // как человек сам открыл сайт в браузере. Обходить её не пытаемся — считаем такой ответ неудачей.
    const isBotStub = t => /__js_p_|get_jhash/.test(t) && !/<main[\s>]/.test(t);
    const r = await Promise.any(paths.map(p => gmGet(site + p).then(x => {
      if (isBotStub(x.text)) { const e = new Error('сайт показывает проверку браузера (защита от ботов)'); e.botCheck = true; throw e; }
      return x;
    }))).catch(e => {
      const errs = e.errors || [e];
      const out = new Error(errs.map(x => x.message).join('; ')); out.botCheck = errs.some(x => x.botCheck); throw out;
    });
    const origin = new URL(r.finalUrl).origin;
    const doc = new DOMParser().parseFromString(r.text, 'text/html');
    doc.querySelectorAll('script,noscript,link[rel=preload][as=script],link[rel=modulepreload],template').forEach(n => n.remove());
    const main = doc.querySelector('main'); if (main) main.innerHTML = '';
    const cssLinks = [...doc.querySelectorAll('link[rel=stylesheet]')].map(l => new URL(l.getAttribute('href'), origin).href);
    const cssTexts = await Promise.all(cssLinks.map(u => gmGet(u).then(x => x.text).catch(() => '')));
    const cls = {};
    const re = /\.([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_-]+?)__([A-Za-z0-9_-]{5})(?![A-Za-z0-9_-])/g;
    cssTexts.forEach(t => { let m; while ((m = re.exec(t))) if (CLS_RE.test(m[1])) cls[m[1]] = `${m[1]}__${m[2]}`; });
    doc.querySelectorAll('[class]').forEach(n => n.classList.forEach(c => { const m = c.match(/^(.+)__([A-Za-z0-9_-]{5})$/); if (m && CLS_RE.test(m[1])) cls[m[1]] = c; }));
    if (!cls.Header_container || !doc.querySelector('main')) throw new Error('по этому адресу не сайт Starter App (нет шапки и контента)');
    return { html: '<!doctype html>' + doc.documentElement.outerHTML, origin, cls, ts: Date.now() };
  }

  // Адрес сайта: «Приложение / сайт → Общие настройки проекта» (paramsSettingsWeb.siteUrl),
  // запасной — envSettings.frontUrl. Без адреса предпросмотр собрать нельзя.
  async function projectSiteUrl() {
    const r = await q(`{"site":*[_id=="paramsSettingsWeb"][0].siteUrl,"front":*[_type=="envSettings"][0].frontUrl}`).catch(() => ({}));
    return normSite(r?.site) || normSite(r?.front) || '';
  }
  function normSite(v) {
    v = (v || '').trim(); if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { return new URL(v).origin; } catch (e) { return ''; }
  }
  // Обязательная форма — только если в настройках проекта адрес не заполнен
  function requireSite() {
    if (!$) return;
    $.querySelector('#spe-sitebox')?.remove();
    const box = document.createElement('div'); box.id = 'spe-sitebox';
    box.innerHTML = `<div class="spe-sitecard">
      <h3 style="margin:0 0 8px;font-size:15px">Укажите адрес сайта проекта</h3>
      <p style="margin:0 0 8px">Предпросмотр строится из оформления настоящего сайта, поэтому без адреса редактор не работает.
      В проекте не заполнено поле «Адрес сайта»: <a href="/${esc(ws())}/structure/main-item;frontendSettings;generalFrontendSettingsCatalog" target="_blank">Приложение / сайт → Общие настройки проекта ↗</a>.
      Заполните его там (так адрес появится у всех) или введите здесь — тогда он сохранится только в этом браузере.</p>
      <input class="spe-in" id="spe-site-in" placeholder="https://адрес-сайта.ru">
      <div id="spe-site-err" class="spe-h" style="color:var(--err);min-height:18px;margin-top:6px"></div>
      <div class="spe-row" style="justify-content:flex-end;margin-top:6px"><button class="spe-btn pri" id="spe-site-ok">Проверить и сохранить</button></div></div>`;
    $.querySelector('#spe-main').appendChild(box);
    const inp = box.querySelector('#spe-site-in'), err = box.querySelector('#spe-site-err'), ok = box.querySelector('#spe-site-ok');
    inp.focus();
    inp.oninput = () => { err.textContent = ''; };
    inp.onkeydown = e => { if (e.key === 'Enter') ok.click(); };
    ok.onclick = async () => {
      const site = normSite(inp.value);
      if (!site) { err.textContent = 'Введите адрес сайта, например https://example.ru'; inp.focus(); return; }
      ok.disabled = true; ok.textContent = 'Проверяю сайт…'; err.textContent = '';
      try {
        const sh = { ...(await fetchShell(site)), site };
        localStorage.setItem(`spe-site-manual:${ws()}`, site);
        saveShell(sh); applyShell(sh); status(''); box.remove();
      } catch (e) {
        err.textContent = `Не получилось открыть оформление с ${site}: ${e.message}. Проверьте адрес.`;
        ok.disabled = false; ok.textContent = 'Проверить и сохранить';
      }
    };
  }
  function saveShell(sh) { try { localStorage.setItem(shellCacheKey(), JSON.stringify(sh)); localStorage.setItem(`spe-site:${ws()}`, sh.origin); } catch (e) { /* квота */ } }

  async function loadSite(force) {
    try {
      const k = `spe-site:${ws()}`;
      const site = (await projectSiteUrl()) || localStorage.getItem(`spe-site-manual:${ws()}`) || '';
      if (!site) { status('Не указан адрес сайта — предпросмотр недоступен', true); previewMsg('Нужен адрес сайта проекта.'); requireSite(); return; }
      // логотипы шапки берутся из «Настройки главной» (не зависят от сайта)
      try { S.logos = await q(`*[_type=="mainHeader"][0].headerAndLogoSettings{"l":headerLogo.asset._ref,"ld":headerLogoDark.asset._ref,"lm":headerLogoMobile.asset._ref,"ldm":headerLogoDarkMobile.asset._ref}`) || {}; } catch (e) { S.logos = {}; }

      // 1) Сохранённая копия — показываем сразу, свежую качаем в фоне
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(shellCacheKey()) || 'null'); } catch (e) { /* ignore */ }
      const save = saveShell;
      // копия от другого адреса (в настройках сменили сайт) — не используем
      if (cached?.site && cached.site !== site) cached = null;
      const fetchFor = s => fetchShell(s).then(sh => ({ ...sh, site: s }));
      if (cached?.html && !force) {
        applyShell(cached);
        fetchFor(site).then(save).catch(() => { /* сайт недоступен — работаем на копии */ });
        return;
      }
      // 2) Копии нет (или ⟳) — качаем и ждём
      status('Загружаю оформление сайта…');
      previewMsg(`Загружаю оформление сайта <b>${esc(site)}</b>…<br>Обычно 2–5 секунд.`);
      try {
        const sh = await fetchFor(site);
        save(sh); applyShell(sh); status('');
      } catch (e) {
        if (cached?.html) { applyShell(cached); status('Сайт не ответил — предпросмотр по сохранённой копии', true); return; }
        if (e.botCheck) {
          status('Сайт просит проверку браузера — откройте его один раз', true);
          previewMsg(`<b style="color:#7a4b00">Сайт ${esc(site)} защищён проверкой «я не робот»</b> — сначала он показывает заглушку с кольцом загрузки,
            и скрипт не может получить его оформление сам.<br><br>
            <b>Что сделать:</b> откройте сайт в новой вкладке, дождитесь, пока он загрузится, и вернитесь сюда — предпросмотр загрузится сам.<br><br>
            <a href="${esc(site)}" target="_blank" rel="noopener" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#bd5b34;color:#fff;text-decoration:none">Открыть сайт ↗</a><br><br>
            <small>Проверку нужно проходить примерно раз в полчаса, но предпросмотр запоминает оформление — дальше он работает и без этого.</small>`);
          // вернулись на вкладку Studio — пробуем ещё раз
          const retry = () => { if (document.visibilityState === 'visible' && $) { window.removeEventListener('focus', retry); document.removeEventListener('visibilitychange', retry); loadSite(true); } };
          window.addEventListener('focus', retry); document.addEventListener('visibilitychange', retry);
          return;
        }
        status('Сайт не отвечает — предпросмотр недоступен', true);
        previewMsg(`<b style="color:#c0392b">Сайт ${esc(site)} сейчас не отвечает</b>, поэтому предпросмотр не загрузился.<br><br>
          Редактировать и публиковать страницу можно и без него. Когда сайт заработает — нажмите ⟳ над этой областью.<br>
          Адрес берётся из <a href="/${esc(ws())}/structure/main-item;frontendSettings;generalFrontendSettingsCatalog" target="_blank">Приложение / сайт → Общие настройки проекта</a> — если он там неверный, исправьте его.<br><br>
          <small>Подробности: ${esc(e.message)}</small>`);
      }
    } catch (e) { status('Предпросмотр: ' + e.message, true); }
  }

  function applyShell(sh) {
    const doc = new DOMParser().parseFromString(sh.html, 'text/html');
    const origin = sh.origin;
    S.siteUrl = origin; S.cls = sh.cls || {};
    {
      // <base>, убрать стили «загрузки» — всё должно быть видно
      const base = doc.createElement('base'); base.href = origin + '/'; doc.head.prepend(base);
      const st = doc.createElement('style');
      st.textContent = `html,body{overflow:auto!important} [class*="Skeleton_"]{display:none!important}
        [data-spe-key],[data-spe-cover],header nav{cursor:pointer}
        [data-spe-key]:hover,[data-spe-cover]:hover{outline:2px dashed rgba(189,91,52,.55);outline-offset:3px}
        .spe-hl{outline:3px solid #bd5b34!important;outline-offset:4px}
        [data-spe-content] > *{touch-action:none} img{-webkit-user-drag:none}
        .spe-dragging{opacity:.35}
        .spe-drop-line{position:fixed;height:4px;margin-top:-1px;background:#bd5b34;border-radius:2px;z-index:99999;pointer-events:none;box-shadow:0 0 0 2px rgba(189,91,52,.2)}
        html.spe-dragmode, html.spe-dragmode *{cursor:grabbing!important;user-select:none!important}
        [data-spe-content] > *:hover{cursor:grab}
        .spe-logo-img{display:block;max-height:100%;max-width:100%;object-fit:contain}`;
      doc.head.appendChild(st);
    }
    S.siteShell = doc;
    renderPreviewTools();
    mountShell();
  }

  // Размер картинки — как на сайте (проверено на zzpopcorn.ru/tttest и sushistore.ru/contacts):
  // заданы ширина/высота — ровно W×H px; не заданы — собственный размер файла (иконка 40×40 так и остаётся 40×40).
  // В обоих случаях прижата влево и не шире колонки.
  const IMG_SIZE_STYLE = b => {
    const w = typeof b.width === 'number' ? b.width : null, h = typeof b.height === 'number' ? b.height : null;
    if (!w && !h) {
      const m = (b.asset?._ref || '').match(/-(\d+)x(\d+)-\w+$/);
      return m ? `width:${m[1]}px;height:auto;max-width:100%` : 'max-width:100%;height:auto';
    }
    return `width:${w ? w + 'px' : 'auto'};height:${h ? h + 'px' : 'auto'};max-width:100%;object-fit:fill`;
  };

  // C('CallToAction_wrapper', 'CallToAction_wrapper_vertical_l_max') → реальные классы
  const C = (...names) => names.flat().filter(Boolean).map(n => S.cls[n]).filter(Boolean).join(' ');

  function ptHtml(children, markDefs) {
    const defs = Object.fromEntries((markDefs || []).map(d => [d._key, d]));
    return (children || []).map(ch => {
      let t = esc(ch.text || '').replace(/\n/g, '<br>');
      const marks = ch.marks || [];
      if (marks.includes('strong')) t = `<strong>${t}</strong>`;
      const lk = marks.find(m => defs[m]?._type === 'link');
      if (lk) t = `<a href="${esc(defs[lk].href)}" style="text-decoration:underline">${t}</a>`;
      return t;
    }).join('');
  }
  function btnHtml(type, label, url, icon, extra) {
    if (!label) return '';
    return `<button class="${C('Button_button', 'Button_button_' + type, 'Button_button_medium', 'SanityContentButton_description__button', extra)}">
      <a class="${C('Link_link', 'SanityContentButton_description__button_link', icon ? 'SanityContentButton_description__button_with-icon' : 'SanityContentButton_description__button_link_' + type)}">${icon ? (icon === 'phone' ? '📞 ' : '📍 ') : ''}${esc(label)}</a></button>`;
  }

  // Общий рендер CTA (обложка и блок)
  function ctaHtml(c, { header, mobile }) {
    const L = c.headerLayout || {};
    const mob = mobile && L.settingsForMobile;
    const style = c.style || 'vertical';
    const size = header ? ((mob ? L.sizeMobile : L.size) || 'l') : (c.size || 'm');
    const width = header ? ((mob ? L.widthMobile : L.width) || 'max') : (c.width || 'max');
    const pane = header ? ((mob ? L.paneMobile : L.pane) || 'light') : (c.pane || 'dark');
    const pos = header ? ((mob ? L.contentPositionMobile : L.contentPosition) || 'center') : (c.contentPosition || 'center');
    const fontColor = header ? colorCss(mob ? L.headerFontColorMobile : L.headerFontColor) : '';
    const v = `${style}_${size}_${width}`;
    const bgImg = c.background === 'image' ? imgUrl((mobile && c.coverMobile?.asset?._ref) || c.cover?.asset?._ref, 2000) : '';
    const empty = c.background === 'null' || !c.background;
    let bgStyle = '';
    if (c.background === 'color') bgStyle = `background-color:${colorCss(c.backgroundColor)};`;
    if (bgImg) bgStyle = `background:url('${bgImg}') center/cover no-repeat;`;
    const title = get(c, 'title.ru'), desc = get(c, 'description.ru');
    // Обложка: при тёмной теме сайт делает текст белым (--textInversePrimary), при светлой — тёмным (проверено на fishka-sushi.ru)
    const tColor = fontColor ? `color:${fontColor}` : (header ? `color:var(${pane === 'dark' ? '--textInversePrimary' : '--textPrimary'})` : '');
    const img = c.background === 'image';
    const logo = c.logo?.asset?._ref ? `<img src="${imgUrl(c.logo.asset._ref, 1200)}" style="max-width:100%;${style === 'horizontal' ? 'width:100%;height:100%;object-fit:cover' : 'max-height:220px;margin:0 auto 16px;display:block'}">` : '';
    const btns = [
      c.primaryButton?.label?.ru ? btnHtml('primary', c.primaryButton.label.ru, c.primaryButton.url, c.primaryButton.icon, 'CallToAction_primary') : '',
      c.secondaryButton?.label?.ru ? btnHtml('secondary', c.secondaryButton.label.ru, c.secondaryButton.url, c.secondaryButton.icon, 'CallToAction_secondary') : ''
    ].join('');
    const Tag = header ? 'h1' : 'h4';
    const info = `<div class="${C('CallToAction_info-wrapper')}">
      ${style === 'vertical' ? logo : ''}
      ${title ? `<${Tag} class="${C('CallToAction_title', 'CallToAction_title_' + style, header && `CallToAction_title_${style}_${size}`, header && `CallToAction_title_${style}_${size}_${pos}`)}" style="${tColor}">${esc(title)}</${Tag}>` : ''}
      ${desc ? `<p class="${C('CallToAction_description', 'CallToAction_description_' + style, header && `CallToAction_description_${style}_${size}_${pos}`, !btns && 'CallToAction_description_last')}" style="${tColor}">${esc(desc)}</p>` : ''}
      ${btns ? `<div class="${C('CallToAction_controls')}">${btns}</div>` : ''}</div>`;
    const content = `<div class="${C('CallToAction_content', pane === 'dark' && 'CallToAction_content_dark', 'CallToAction_content_' + style, header && pos === 'bottom' && 'CallToAction_content_bottom')}" ${style === 'horizontal' ? `style="display:flex;gap:24px;align-items:${pos === 'bottom' ? 'flex-end' : 'center'};flex-direction:${(c.position || 'left') === 'right' ? 'row-reverse' : 'row'}"` : ''}>
      ${style === 'horizontal' && logo ? `<div style="flex:1;min-width:0">${logo}</div>` : ''}<div style="${style === 'horizontal' ? 'flex:1;min-width:0' : ''}">${info}</div></div>`;
    const blackout = c.backgroundBlackout && !empty ? `<div class="${C('CallToAction_blackout', 'CallToAction_blackout_' + pos, !header && 'CallToAction_blackout_content')}"></div>` : '';
    const cwCls = extra => C('CallToAction_content-wrapper', 'CallToAction_content-wrapper_' + v, header && `CallToAction_content-wrapper_${v}_${pos === 'bottom' ? 'bottom' : 'header'}`, empty && 'CallToAction_content-wrapper_empty', extra);

    // Обложка с фото, высота «по пропорциям картинки» — разметка как на сайте (fishka-sushi.ru):
    // wrapper_image > cover{padding-top: пропорция фото} > [слой картинки + текст поверх] + затемнение.
    // Высоту задаёт слой cover; отдельный слой для телефона (cover_mobile) сайт показывает на узком экране.
    if (header && img && (c.imageSize || 'arbitrary') === 'arbitrary' && c.cover?.asset?._ref) {
      const ratio = ref => { const m = (ref || '').match(/-(\d+)x(\d+)-\w+$/); return m ? Math.round(+m[2] / +m[1] * 100) : 37; };
      const coverLayer = (ref, mobCls) => `<div class="${C(mobCls ? 'CallToAction_cover_mobile' : 'CallToAction_cover')}" style="position:relative;padding-top:min(${ratio(ref)}%, 65vh);min-height:max(0px, 150px)">
          <div class="${C('CallToAction_cover-image-wrapper')}" style="position:absolute;inset:0"><img class="${C('CallToAction_cover-image')}" src="${imgUrl(ref, 2400)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div>
          <div class="${cwCls('CallToAction_content-wrapper_image')}">${content}</div></div>`;
      const dRef = c.cover.asset._ref, mRef = c.coverMobile?.asset?._ref || dRef;
      return `<div class="${C('CallToAction_container')}">
        <div class="${C('CallToAction_wrapper', 'CallToAction_wrapper_' + v, 'CallToAction_wrapper_image')}">
          ${coverLayer(dRef, false)}${coverLayer(mRef, true)}${blackout}
        </div></div>`;
    }
    // Остальные случаи (цвет, без фона, фото «по высоте текста», блоки CTA) — фон на самой обложке
    return `<div class="${C('CallToAction_container')}">
      <div class="${C('CallToAction_wrapper', 'CallToAction_wrapper_' + v, empty && 'CallToAction_wrapper_empty')}" style="${bgStyle}">
        <div class="${cwCls()}">${content}</div>
        ${blackout}
      </div></div>`;
  }

  function blockHtml(b, mobile) {
    const art = (...x) => C('SanityContent_description__article', 'SanityContent_description__article_page', ...x, 'SanityContentParagraph_paragraph');
    const wrapAttr = `data-spe-key="${b._key}"`;
    switch (b._type) {
      case 'block': {
        const inner = ptHtml(b.children, b.markDefs);
        if (b.style === 'h2') return `<div ${wrapAttr} class="${art('SanityContent_description__article_title', 'SanityContent_description__article_title_page')}"><h2>${inner}</h2></div>`;
        if (b.style === 'h3') return `<div ${wrapAttr} class="${art('SanityContent_description__article_sub-title', 'SanityContent_description__article_sub-title_page')}"><h3>${inner}</h3></div>`;
        const st = b.style === 'small' ? 'SanityContent_description__article_page_small' : b.style === 'large' ? 'SanityContent_description__article_page_large' : '';
        return `<div ${wrapAttr} class="${art(st)}">${inner}</div>`;
      }
      case 'border': return `<div ${wrapAttr} class="${C('SanityContent_description__border')}"></div>`;
      case 'button': return `<div ${wrapAttr}>${btnHtml(b.type || 'primary', b.label, b.url, b.icon, 'SanityContentButton_description__button_page')}</div>`;
      case 'callToAction': return `<div ${wrapAttr} class="${C('SanityContentCTA_cta-wrapper', 'SanityContentCTA_cta-wrapper_' + (b.width || 'max'))}">${ctaHtml(b, { header: false, mobile })}</div>`;
      case 'accordionWrapper': return `<ul ${wrapAttr} class="${C('SanityContent_block-wrapper')}">${(b.accordionList || []).map(a => {
          const open = S.accOpen.has(a._key);
          return `<li class="${C('Accordion_wrapper')}"><div class="${C('Accordion_title')}" data-spe-acc="${a._key}"><p>${esc(a.title)}</p>
            <svg class="${C('Accordion_icon', open && 'Accordion_icon_arrow')}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" style="transition:transform .2s"><path d="M6 9l6 6 6-6"/></svg></div>
            <p class="${C('Accordion_description', open && 'Accordion_description_visible')}">${esc(a.description)}</p></li>`;
        }).join('')}</ul>`;
      case 'tableWrapper': {
        const rows = b.table?.rows || [];
        return `<div ${wrapAttr} class="${C('SanityContent_block-wrapper')}"><ul class="${C('Table_container')}">${rows.map((r, i) => `<li class="${C('Table_row', b.tableBold === 'row' && i === 0 && 'Table_row_bold')}">${r.cells.map((c, j) => `<p class="${C('Table_value')}" ${b.tableBold === 'column' && j === 0 ? 'style="font-weight:700"' : ''}>${esc(c)}</p>`).join('')}</li>`).join('')}</ul></div>`;
      }
      // Разметка как на сайте: <figure> + подпись (подпись = поле «Описание (alt)»)
      case 'image': return b.asset?._ref ? `<figure ${wrapAttr} class="${C('SanityContentImg_figure', 'SanityContent_description__logo_figure', 'SanityContent_description__logo_figure_page')}">
          <div class="${C('SanityContent_description__logo', 'SanityContent_description__logo_page')}" style="height:auto;overflow:visible;border-radius:0">
            <img src="${imgUrl(b.asset._ref, 1600)}" alt="${esc(b.alt)}" style="display:block;${IMG_SIZE_STYLE(b)}"></div>
          ${b.alt ? `<figcaption class="${C('SanityContentImg_figure__caption', 'SanityContent_description__logo_figcaption', 'SanityContent_description__logo_figcaption_page')}">${esc(b.alt)}</figcaption>` : ''}</figure>` : '';
      case 'iframeWrapper': {
        const ar = (mobile ? b.aspectRatioMobile : b.aspectRatio) || b.aspectRatio || '16/9';
        return `<div ${wrapAttr} class="${C('SanityContent_iframe-wrapper')}"><iframe src="${esc(b.iframe?.current || '')}" class="${C('SanityContent_iframe')}" frameborder="0" style="aspect-ratio:${ar}"></iframe></div>`;
      }
      case 'mediaWrapper': return `<div ${wrapAttr} class="${C('SanityContent_block-wrapper')}" style="display:flex;gap:12px;overflow-x:auto">${(b.mediaList || []).map(m => `<figure style="margin:0;flex:0 0 ${mobile ? 85 : 45}%">
          ${m.image?.asset ? `<img src="${imgUrl(m.image.asset._ref, 1000)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:16px;display:block">` : m.iframe?.current ? `<iframe src="${esc(m.iframe.current)}" style="width:100%;aspect-ratio:4/3;border:0;border-radius:16px"></iframe>` : `<div style="aspect-ratio:4/3;background:#ddd;border-radius:16px;display:flex;align-items:center;justify-content:center">видео</div>`}
          ${m.caption ? `<figcaption style="margin-top:6px;opacity:.7">${esc(m.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
      case 'productSelection': return `<div ${wrapAttr} class="${C('SanityContent_block-wrapper')}" style="display:grid;grid-template-columns:repeat(${mobile ? 2 : 4},1fr);gap:16px">${(b.productSelectionList || []).map(r => { const m = S.meals[r._ref] || {}; return `<div>
          ${m.img ? `<img src="${imgUrl(m.img, 500)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--productImageSmallBorderRadius,18px);display:block">` : '<div style="aspect-ratio:1;background:#eee;border-radius:18px"></div>'}
          <div style="margin-top:8px;font-weight:600">${esc(m.n || '…')}</div>${m.price ? `<div style="opacity:.7">${m.price} ₽</div>` : ''}</div>`; }).join('')}</div>`;
      case 'bannersWrapper': return `<div ${wrapAttr} class="${C('SanityContent_block-wrapper')}" style="display:flex;gap:12px;overflow-x:auto">${(b.banners || []).map(r => { const x = S.banners[r._ref] || {}; return x.img ? `<img src="${imgUrl(x.img, 600)}" style="height:${mobile ? 220 : 320}px;border-radius:16px;display:block">` : `<div style="width:240px;height:320px;border-radius:16px;background:#eee;display:flex;align-items:center;justify-content:center">${esc(x.n || 'баннер')}</div>`; }).join('')}</div>`;
    }
    return '';
  }

  // Список элементов верхнего уровня контента: [{ id, html }] — для точечного обновления
  function contentItems(mobile) {
    const blocks = S.doc.detail.ru;
    const out = []; let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b._type === 'block' && b.listItem) { // соседние пункты списка — один <ul>/<ol>, как на сайте
        const num = b.listItem === 'number';
        let items = ''; const first = b._key;
        while (i < blocks.length && blocks[i]._type === 'block' && blocks[i].listItem === b.listItem) {
          items += `<li data-spe-key="${blocks[i]._key}" class="${C('SanityContent_description__li', num && 'SanityContent_description__li_number')}">${ptHtml(blocks[i].children, blocks[i].markDefs)}</li>`; i++;
        }
        const tag = num ? 'ol' : 'ul';
        out.push({ id: 'list-' + first, html: `<${tag} class="${C('SanityContent_description__list', num && 'SanityContent_description__list_number', 'SanityContent_empty-bottom')}">${items}</${tag}>` });
        continue;
      }
      const h = blockHtml(b, mobile);
      if (h) out.push({ id: b._key, html: h });
      i++;
    }
    return out;
  }
  function contentShellHtml() {
    return `<section class="${C('ContentPage_host')}"><div class="${C('ContentPage_wrapper', 'ContentPage_wrapper_page')}">
      <div class="${C('SanityContent_wrapper')}" data-spe-wrap><div class="${C('SanityContent_description')}" data-spe-content></div></div></div></section>`;
  }

  // ---------- Живой предпросмотр ----------
  // Оболочка сайта грузится в iframe ОДИН раз; дальше правки применяются точечно к DOM
  // (меняются только изменившиеся блоки) — без перезагрузки, мигания и прыжка скролла.
  let prevTimer = null;
  function schedulePreview() { clearTimeout(prevTimer); prevTimer = setTimeout(patchPreview, 60); }

  function frameDoc() { const fr = $?.querySelector('#spe-iframe'); return S.mounted ? fr?.contentDocument : null; }

  function mountShell() {
    if (!$) return;
    const fr = $.querySelector('#spe-iframe');
    fr.style.width = S.device === 'mobile' ? '390px' : '100%';
    if (!S.siteShell) { S.mounted = false; fr.srcdoc = '<p style="font-family:sans-serif;padding:20px;color:#888">Загружаю стили сайта…</p>'; return; }
    const doc = S.siteShell.cloneNode(true);
    doc.querySelectorAll('header .' + (S.cls['CallToAction_container'] || 'x-none')).forEach(n => n.remove());
    const main = doc.querySelector('main');
    if (main) main.innerHTML = contentShellHtml();
    S.mounted = false;
    fr.onload = () => {
      S.mounted = true;
      const d = fr.contentDocument;
      d.addEventListener('click', onPreviewClick, true);
      makeSortable({
        root: d, doc: d, getItems: () => previewItems(d),
        grab: t => t.closest?.('[data-spe-content] > *') || null,
        scroller: () => d.getElementById('scrollingElement') || d.scrollingElement
      });
      patchPreview();
    };
    fr.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
  }

  // Заменить узел, только если его HTML поменялся
  function setHtml(container, node, html, before) {
    if (node && node.__speHtml === html) return node;
    const t = container.ownerDocument.createElement('template');
    t.innerHTML = html.trim();
    const n = t.content.firstElementChild || container.ownerDocument.createElement('div');
    n.__speHtml = html;
    if (node) node.replaceWith(n); else container.insertBefore(n, before || null);
    return n;
  }

  function patchPreview() {
    if (!$) return;
    const fr = $.querySelector('#spe-iframe');
    const mobile = S.device === 'mobile';
    fr.style.width = mobile ? '390px' : '100%';
    const d = frameDoc();
    if (!d || !S.doc) return;
    // --- обложка (в шапке две копии: компьютер и телефон) ---
    const hc = S.doc.headerCallToAction || {};
    const hasCover = get(hc, 'title.ru') || (hc.background && hc.background !== 'null') || hc.logo?.asset;
    headerContainers(d).forEach(cont => {
      const isMob = cont.className.includes('Header_container_mobile');
      const old = cont.querySelector(':scope > [data-spe-cover]');
      if (!hasCover) { old?.remove(); return; }
      const html = `<div data-spe-cover>${ctaHtml(hc, { header: true, mobile: isMob })}</div>`;
      setHtml(cont, old, html);
    });
    applyHeader(d);
    // --- контент: точечно по блокам ---
    const box = d.querySelector('[data-spe-content]');
    if (box) {
      const items = contentItems(mobile);
      const blocks = S.doc.detail.ru;
      const firstH2 = blocks[0]?._type === 'block' && blocks[0].style === 'h2';
      const wrap = d.querySelector('[data-spe-wrap]');
      if (wrap) wrap.className = C('SanityContent_wrapper', firstH2 && 'SanityContent_wrapper_h2');
      const existing = [...box.children];
      const byId = new Map(existing.map(n => [n.__speId, n]));
      let prev = null;
      items.forEach(it => {
        let n = byId.get(it.id); byId.delete(it.id);
        const expectedAt = prev ? prev.nextElementSibling : box.firstElementChild;
        if (n && n !== expectedAt) box.insertBefore(n, expectedAt); // перестановка без пересоздания
        n = setHtml(box, n, it.html, n ? null : expectedAt);
        n.__speId = it.id;
        prev = n;
      });
      byId.forEach(n => n.remove());
    }
    d.title = get(S.doc, 'title.ru') || '';
  }

  function headerContainers(d) {
    const cls = S.cls['Header_container'];
    return cls ? [...d.querySelectorAll('header .' + cls)] : [];
  }
  // Настройки «Шапка»: положение (поверх / отдельно), логотип, цвет фона
  function applyHeader(d) {
    const hl = S.doc.headerAndLogoSettings || {};
    const L = S.doc.headerCallToAction?.headerLayout || {};
    headerContainers(d).forEach(cont => {
      const isMob = cont.className.includes('Header_container_mobile');
      const sep = isMob && hl.settingsForMobile;
      const navType = (sep ? hl.navTypeMobile : hl.navType) || 'standard-with-image';
      const showLogo = (sep ? hl.logoInHeaderMobile : hl.logoInHeader) !== false;
      const navColor = colorCss(sep ? hl.headerNavColorMobile : hl.headerNavColor);
      const pane = ((isMob && L.settingsForMobile ? L.paneMobile : L.pane) || 'light');
      const sfx = isMob ? '_mobile' : '';
      swapClass(cont, /^Header_container_variant_/, C('Header_container_variant_' + navType + sfx));
      swapClass(cont, /^Header_container_theme_/, C('Header_container_theme_' + pane));
      const nav = cont.querySelector('nav');
      if (nav) {
        swapClass(nav, /^Header_nav_(standard|standard-with-image|separated-image)(_mobile)?__/, C('Header_nav_' + navType + sfx));
        nav.style.background = navColor || '';
      }
      // Элементы меню по теме обложки: при тёмной — светлые иконки и белый текст (как на сайте)
      [['HeaderNavWrapper_wrapper', true], ['CitySelect_title', true], ['SidebarButton_counter_header', false], ['SidebarButton_value_header', false]].forEach(([base, both]) => {
        const sel = S.cls[base]; if (!sel) return;
        cont.querySelectorAll('.' + sel).forEach(el => {
          ['light', 'dark'].forEach(t => { const c = S.cls[`${base}_${t}`]; if (c) el.classList.remove(c); });
          const add = S.cls[`${base}_${pane}`];
          if (add && (both || pane === 'dark')) el.classList.add(add);
        });
      });
      if (S.cls['User_text']) cont.querySelectorAll('.' + S.cls['User_text']).forEach(el => { el.style.color = pane === 'dark' ? 'var(--color-white)' : 'var(--color-black)'; });
      // логотип: сайт подгружает его скриптом, поэтому в оболочке он пустой — ставим сами
      let bar = cont.querySelector('.' + (S.cls['Header_logo-bar'] || 'x-none'));
      // Если в странице-образце логотип был выключен, сайт не выводит его блок вовсе — достраиваем сами
      if (!bar && nav && S.cls['Header_logo-bar']) {
        const right = nav.querySelector('.' + (S.cls['Header_side-bar_right'] || 'x-none'));
        const t = d.createElement('template');
        t.innerHTML = `<div class="${C('Header_logo-bar')}"><a class="${C('Link_link', 'Header_link')}"><div class="${C('Header_logo-wrapper')}"></div></a></div>`;
        bar = t.content.firstElementChild;
        right ? nav.insertBefore(bar, right) : nav.appendChild(bar);
      }
      if (bar) {
        bar.style.display = showLogo ? '' : 'none'; // сайт в этом случае убирает блок логотипа целиком
        const w = bar.querySelector('.' + (S.cls['Header_logo-wrapper'] || 'x-none'));
        const lg = S.logos || {};
        const ref = pane === 'dark' ? (isMob && lg.ldm) || lg.ld || lg.l : (isMob && lg.lm) || lg.l;
        if (w && ref && w.dataset.speLogo !== ref) {
          w.dataset.speLogo = ref;
          w.innerHTML = `<img class="spe-logo-img ${C('Header_logo')}" src="${imgUrl(ref)}" alt="">`;
        }
      }
    });
  }
  function swapClass(el, re, add) {
    [...el.classList].forEach(c => { if (re.test(c)) el.classList.remove(c); });
    if (add) add.split(' ').forEach(c => c && el.classList.add(c));
  }

  // ---------- Перестановка блоков мышью (в списке формы и в предпросмотре) ----------
  // Переносит блоки [start..end] так, чтобы они встали перед блоком с индексом toIndex (0..len)
  function moveRange(start, end, toIndex) {
    const list = S.doc.detail.ru;
    if (toIndex >= start && toIndex <= end + 1) return false; // на то же место
    const chunk = list.splice(start, end - start + 1);
    list.splice(toIndex > end ? toIndex - chunk.length : toIndex, 0, ...chunk);
    return true;
  }
  // Универсальное перетаскивание: root — где ловим мышь, getItems() → [{ el, start, end }],
  // grab(target) → элемент-«ручка» или null, scroller() → что прокручивать у краёв
  function makeSortable({ root, doc, getItems, grab, scroller }) {
    let st = null, ind = null;
    const edgeScroll = y => {
      const sc = scroller?.(); if (!sc) return;
      const r = sc === doc.scrollingElement ? { top: 0, bottom: doc.defaultView.innerHeight } : sc.getBoundingClientRect();
      if (y < r.top + 50) sc.scrollTop -= 18; else if (y > r.bottom - 50) sc.scrollTop += 18;
    };
    root.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !S.doc) return;
      const h = grab(e.target); if (!h) return;
      const it = getItems().find(x => x.el === h || x.el.contains(h)); if (!it) return;
      st = { it, x: e.clientX, y: e.clientY, active: false, pid: e.pointerId };
    }, true);
    root.addEventListener('pointermove', e => {
      if (!st) return;
      if (!st.active) {
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
        st.active = true;
        try { st.it.el.setPointerCapture?.(st.pid); } catch (er) { /* ignore */ }
        st.it.el.classList.add('spe-dragging');
        doc.documentElement.classList.add('spe-dragmode');
        ind = doc.createElement('div'); ind.className = 'spe-drop-line'; doc.body.appendChild(ind);
      }
      e.preventDefault();
      const items = getItems().filter(x => x.el.offsetParent || x.el.getClientRects().length);
      if (!items.length) return;
      let target = items[items.length - 1].end + 1, ref = items[items.length - 1].el, before = false;
      for (const x of items) {
        const r = x.el.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { target = x.start; ref = x.el; before = true; break; }
      }
      const r = ref.getBoundingClientRect();
      Object.assign(ind.style, { top: (before ? r.top - 3 : r.bottom + 1) + 'px', left: r.left + 'px', width: r.width + 'px' });
      st.target = target;
      edgeScroll(e.clientY);
    }, true);
    const finish = cancel => {
      if (!st) return;
      const s = st; st = null;
      if (!s.active) return;
      s.it.el.classList.remove('spe-dragging');
      doc.documentElement.classList.remove('spe-dragmode');
      ind?.remove(); ind = null;
      S.justDragged = Date.now();
      if (cancel) return; // жест прерван (Esc, уход окна) — оставляем как было
      if (s.target != null && moveRange(s.it.start, s.it.end, s.target)) {
        changed(S.tab === 'content');
        status('Блок перемещён');
      }
    };
    root.addEventListener('pointerup', () => finish(false), true);
    root.addEventListener('pointercancel', () => finish(true), true);
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && st?.active) { e.stopPropagation(); finish(true); } }, true);
  }
  // Элементы предпросмотра → диапазоны блоков (несколько пунктов списка = один <ul>)
  function previewItems(d) {
    const box = d.querySelector('[data-spe-content]'); if (!box) return [];
    const list = S.doc.detail.ru;
    return [...box.children].map(el => {
      const id = el.__speId || ''; let start, end;
      if (id.startsWith('list-')) {
        start = list.findIndex(b => b._key === id.slice(5)); end = start;
        while (end + 1 < list.length && list[end + 1]._type === 'block' && list[end + 1].listItem && list[end + 1].listItem === list[start].listItem) end++;
      } else { start = end = list.findIndex(b => b._key === id); }
      return { el, start, end };
    }).filter(x => x.start >= 0);
  }

  // ---------- Клик в предпросмотре → блок в форме ----------
  function onPreviewClick(e) {
    e.preventDefault(); e.stopPropagation();
    if (Date.now() - S.justDragged < 400) return; // отпустили после перетаскивания
    const t = e.target;
    const acc = t.closest('[data-spe-acc]');
    if (acc) { // аккордеон раскрывается как на сайте
      const k = acc.dataset.speAcc;
      S.accOpen.has(k) ? S.accOpen.delete(k) : S.accOpen.add(k);
      schedulePreview();
    }
    const blk = t.closest('[data-spe-key]');
    if (blk) { selectBlock(blk.dataset.speKey); return; }
    if (t.closest('[data-spe-cover]')) { S.tab = 'cover'; renderTabs(); renderForm(); flashForm(); return; }
    if (t.closest('header')) { S.tab = 'header'; renderTabs(); renderForm(); flashForm(); }
  }
  function selectBlock(k) {
    S.tab = 'content'; S.openBlock = k; renderTabs(); renderForm();
    const el = $.querySelector(`.spe-blk.on`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); flashEl(el); }
  }
  function flashForm() { flashEl($.querySelector('#spe-fields')); }
  function flashEl(el) { if (!el) return; el.classList.remove('spe-flash'); void el.offsetWidth; el.classList.add('spe-flash'); }

  function highlightPreview(k) {
    const d = frameDoc(); if (!d || !k) return;
    const n = d.querySelector(`[data-spe-key="${k}"]`); if (!n) return;
    n.scrollIntoView({ block: 'center', behavior: 'smooth' }); n.classList.add('spe-hl'); setTimeout(() => n.classList.remove('spe-hl'), 1500);
  }

  // ===================================================================
  // 11. Кнопка запуска
  // ===================================================================
  // Кнопка стоит в верхнем меню Studio сразу правее «Schedules».
  // React Studio может перерисовать меню — поэтому проверяем и возвращаем кнопку на место.
  function ensureFab() {
    if (!document.getElementById('spe-style')) { const st = document.createElement('style'); st.id = 'spe-style'; st.textContent = CSS; document.head.appendChild(st); }
    let b = document.getElementById('spe-fab');
    // Кнопка нужна только в разделе «Контентные страницы»: /<любой проект>/structure/static-item;pages…
    if (!/^\/[^/]+\/structure\/static-item;pages(?:[;,%]|$)/.test(location.pathname)) { b?.remove(); return; }
    const sched = [...document.querySelectorAll('a[href$="/schedules"]')].find(a => a.textContent.trim() === 'Schedules');
    if (b && sched && b.previousElementSibling === sched) return;
    if (!sched) return; // меню ещё не отрисовано
    if (!b) {
      b = document.createElement('button');
      b.id = 'spe-fab'; b.type = 'button'; b.innerHTML = EYE_SVG + 'Предпросмотр';
      b.title = 'Быстрый редактор контентных страниц';
      b.onclick = openModal;
    }
    sched.after(b);
  }
  setInterval(ensureFab, 1000);
})();
    });
  });
})();
