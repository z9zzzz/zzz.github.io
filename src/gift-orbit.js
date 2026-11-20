(function () {
    "use strict";

    const MANIFEST_PATH = "GiftsJson/gifts-manifest.json";
    // Share one request with the profile badge initializer in index.html.
    // Both features need the same manifest, so only the first consumer fetches it.
    const manifestPromise = window.__giftsManifestPromise || (window.__giftsManifestPromise = fetch(MANIFEST_PATH, { cache: "force-cache" })
        .then((response) => {
            if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
            return response.json();
        }));
    const MAX_VISIBLE_GIFTS = 3;
    const RETURN_DURATION_MS = 520;
    // Three staggered, clockwise elliptical paths. Increase MAX_VISIBLE_GIFTS when
    // needed; getOrbitPath() then spreads extra gifts across two safe rings.
    const ORBIT_PATHS = [
        { phase: -Math.PI / 2, radiusX: 1.88, radiusY: 1.56, period: 11200, dragScale: 1.52 },
        { phase: Math.PI / 6, radiusX: 1.92, radiusY: 1.60, period: 11200, dragScale: 1.62 },
        { phase: Math.PI * 5 / 6, radiusX: 1.84, radiusY: 1.52, period: 11200, dragScale: 1.56 }
    ];
    const ORBIT_RINGS = [
        { radiusX: 1.72, radiusY: 1.42, period: 10800 },
        { radiusX: 2.08, radiusY: 1.68, period: 12400 }
    ];
    const REST_EDGE = 22;
    const DRAG_EDGE = 36;
    const TAU = Math.PI * 2;

    const orbit = document.getElementById("profile-gift-orbit");
    const avatar = document.querySelector(".profile-avatar-stage > .image");
    const portfolioScroller = document.getElementById("portfolio");
    if (!orbit || !avatar) return;

    const motionQuery = window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reducedMotion = motionQuery ? motionQuery.matches : false;
    let motionEpoch = performance.now();
    let motionPausedAt = reducedMotion ? motionEpoch : null;
    const items = [];
    let frameId = 0;
    let geometryFrameId = 0;
    let avatarRect = null;

    // Portal the bubbles outside the card/header clipping so pointer capture can drag freely.
    document.body.appendChild(orbit);
    orbit.classList.add("gift-orbit--portal");

    function shuffle(list) {
        const result = list.slice();
        for (let i = result.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    function isLocalGiftPath(path) {
        return typeof path === "string" && /^GiftsJson\/[A-Za-z0-9_-]+\.json$/.test(path);
    }

    function getOrbitPath(index, count) {
        if (count <= ORBIT_PATHS.length) return ORBIT_PATHS[index];

        const innerCount = Math.ceil(count / 2);
        const ringIndex = index < innerCount ? 0 : 1;
        const slot = ringIndex === 0 ? index : index - innerCount;
        const ringCount = ringIndex === 0 ? innerCount : count - innerCount;
        const ring = ORBIT_RINGS[ringIndex];
        const phase = -Math.PI / 2 + (slot / ringCount) * TAU + ringIndex * (TAU / (ringCount * 2));

        return {
            phase,
            radiusX: ring.radiusX,
            radiusY: ring.radiusY,
            period: ring.period + (slot % 3) * 500,
            dragScale: 1.42 + (slot % 3) * 0.08
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function viewportMargin(state) {
        return state.dragging || state.returning ? DRAG_EDGE : REST_EDGE;
    }

    function clampToViewport(value, axis, margin) {
        const extent = axis === "x" ? window.innerWidth : window.innerHeight;
        return clamp(value, margin, Math.max(margin, extent - margin));
    }

    function setPosition(state, x, y) {
        const margin = viewportMargin(state);
        state.x = clampToViewport(x, "x", margin);
        state.y = clampToViewport(y, "y", margin);
        state.item.style.setProperty("--gift-x", `${state.x.toFixed(2)}px`);
        state.item.style.setProperty("--gift-y", `${state.y.toFixed(2)}px`);
    }

    function floatingPoint(state, now, avatarRect) {
        const centerX = avatarRect.left + avatarRect.width / 2;
        const centerY = avatarRect.top + avatarRect.height / 2;
        const centerRadius = Math.min(avatarRect.width, avatarRect.height) / 2;
        const motionTime = motionPausedAt === null ? now : motionPausedAt;
        const progress = (motionTime - motionEpoch) * TAU / state.orbitPeriod;
        const orbitAngle = state.orbitPhase + progress;
        const depth = (Math.sin(orbitAngle) + 1) / 2;

        return {
            x: centerX + Math.cos(orbitAngle) * centerRadius * state.radiusX,
            y: centerY + Math.sin(orbitAngle) * centerRadius * state.radiusY,
            depth
        };
    }

    function applyDepth(state, depth, dragging) {
        const scale = dragging ? state.dragScale : state.backScale + depth * (state.frontScale - state.backScale);
        const opacity = dragging ? 1 : state.backOpacity + depth * (1 - state.backOpacity);
        state.item.style.setProperty("--gift-scale", scale.toFixed(3));
        state.item.style.opacity = opacity.toFixed(3);
        state.item.style.zIndex = dragging ? "100" : String(10 + Math.round(depth * 20));
        state.shell.style.setProperty("--gift-scale", scale.toFixed(3));
    }

    function springEase(progress) {
        const t = clamp(progress, 0, 1);
        return 1 - Math.exp(-8 * t) * (Math.cos(10 * t) + 0.8 * Math.sin(10 * t));
    }

    function positionItem(state, now, avatarRect) {
        if (state.dragging) {
            applyDepth(state, state.depth, true);
            setPosition(state, state.x, state.y);
            return;
        }

        const target = floatingPoint(state, now, avatarRect);
        state.depth = target.depth;
        applyDepth(state, target.depth, false);
        if (state.returning) {
            const progress = (now - state.returning.startedAt) / RETURN_DURATION_MS;
            if (progress >= 1) {
                state.returning = null;
                state.item.classList.remove("is-returning", "is-open");
            } else {
                const eased = springEase(progress);
                const x = state.returning.fromX + (target.x - state.returning.fromX) * eased;
                const y = state.returning.fromY + (target.y - state.returning.fromY) * eased;
                setPosition(state, x, y);
                return;
            }
        }

        setPosition(state, target.x, target.y);
    }

    function updateAvatarGeometry() {
        const rect = avatar.getBoundingClientRect();
        avatarRect = rect;
        const visible = rect.width > 0 && rect.height > 0
            && rect.bottom > 0 && rect.right > 0
            && rect.top < window.innerHeight && rect.left < window.innerWidth;
        orbit.classList.toggle("is-avatar-offscreen", !visible);
        return rect;
    }

    function renderPositions(now, rect) {
        const currentRect = rect || avatarRect || updateAvatarGeometry();
        if (!currentRect.width || !currentRect.height) return;
        items.forEach((state) => positionItem(state, now, currentRect));
    }

    function scheduleGeometryUpdate() {
        if (geometryFrameId) return;
        geometryFrameId = window.requestAnimationFrame(() => {
            geometryFrameId = 0;
            renderPositions(performance.now(), updateAvatarGeometry());
            setStickerMotion();
            startAnimation();
        });
    }

    function hasAnimatedReturn() {
        return items.some((state) => state.returning !== null);
    }

    function shouldAnimate() {
        const pageIsMoving = document.body.classList.contains("pf-animating");
        const avatarIsVisible = !orbit.classList.contains("is-avatar-offscreen");
        return !document.hidden
            && (avatarIsVisible || pageIsMoving)
            && (!reducedMotion || hasAnimatedReturn());
    }

    function animate(now) {
        const pageIsMoving = document.body.classList.contains("pf-animating");
        renderPositions(now, pageIsMoving ? updateAvatarGeometry() : undefined);
        if (shouldAnimate()) {
            frameId = window.requestAnimationFrame(animate);
        } else {
            frameId = 0;
        }
    }

    function startAnimation() {
        if (!frameId && shouldAnimate()) {
            frameId = window.requestAnimationFrame(animate);
        }
    }

    function stopAnimation() {
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = 0;
    }

    function setStickerMotion() {
        const shouldPlay = !reducedMotion
            && !document.hidden
            && !orbit.classList.contains("is-avatar-offscreen");
        items.forEach((state) => {
            if (!state.animation) return;
            if (!shouldPlay) state.animation.pause();
            else state.animation.play();
        });
    }

    function setFallback(item, message) {
        const lottieBox = item.querySelector(".gift-orbit-lottie");
        if (lottieBox) lottieBox.remove();
        const fallback = document.createElement("span");
        fallback.className = "gift-orbit-fallback";
        fallback.textContent = "✦";
        fallback.setAttribute("aria-hidden", "true");
        (item.querySelector(".gift-orbit-shell") || item).appendChild(fallback);
        if (message) console.warn("Profile gift animation could not be loaded:", message);
    }

    function currentCenter(state) {
        const rect = state.item.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function beginInteraction(state, pointerId) {
        const center = currentCenter(state);
        state.x = center.x;
        state.y = center.y;
        state.pointerId = pointerId;
        state.dragging = true;
        state.returning = null;
        state.item.classList.remove("is-returning");
        state.item.classList.add("is-open", "is-dragging");
        setPosition(state, state.x, state.y);
    }

    function returnToFloatingPosition(state, event) {
        if (!state.dragging) return;
        state.dragging = false;
        state.pointerId = null;
        state.returning = {
            startedAt: performance.now(),
            fromX: state.x,
            fromY: state.y
        };
        state.item.classList.remove("is-dragging", "is-open");
        state.item.classList.add("is-returning");

        if (event && state.item.hasPointerCapture && state.item.hasPointerCapture(event.pointerId)) {
            try {
                state.item.releasePointerCapture(event.pointerId);
            } catch (_) {
                // Pointer cancellation may release capture before this callback runs.
            }
        }

        renderPositions(performance.now());
        startAnimation();
    }

    function bindPointerDrag(state) {
        const item = state.item;

        item.addEventListener("pointerdown", (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            if (state.dragging) return;
            event.preventDefault();
            event.stopPropagation();

            const center = currentCenter(state);
            beginInteraction(state, event.pointerId);
            state.grabOffsetX = center.x - event.clientX;
            state.grabOffsetY = center.y - event.clientY;

            if (item.setPointerCapture) {
                try {
                    item.setPointerCapture(event.pointerId);
                } catch (_) {
                    // The pointer remains usable in browsers without capture support.
                }
            }
        });

        item.addEventListener("pointermove", (event) => {
            if (!state.dragging || event.pointerId !== state.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            setPosition(state, event.clientX + state.grabOffsetX, event.clientY + state.grabOffsetY);
        });

        item.addEventListener("pointerup", (event) => {
            if (event.pointerId === state.pointerId) returnToFloatingPosition(state, event);
        });
        item.addEventListener("pointercancel", (event) => {
            if (event.pointerId === state.pointerId) returnToFloatingPosition(state, event);
        });
        item.addEventListener("lostpointercapture", () => returnToFloatingPosition(state));
        item.addEventListener("click", (event) => {
            // Floating gifts are decorative and draggable, never navigation links.
            event.preventDefault();
        });
    }

    function bindKeyboard(state) {
        const directions = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1]
        };

        state.item.addEventListener("keydown", (event) => {
            const direction = directions[event.key];
            const activation = event.code === "Space" || event.code === "Enter";
            if (!direction && !activation) return;
            event.preventDefault();

            if (!state.keyboardActive) {
                beginInteraction(state, null);
                state.keyboardActive = true;
            }
            if (direction) {
                const step = event.shiftKey ? 28 : 14;
                setPosition(state, state.x + direction[0] * step, state.y + direction[1] * step);
            }
        });

        state.item.addEventListener("keyup", (event) => {
            if (!state.keyboardActive) return;
            if (event.code === "Space" || event.code === "Enter" || directions[event.key]) {
                event.preventDefault();
                state.keyboardActive = false;
                returnToFloatingPosition(state);
            }
        });
    }

    function createGift(gift, index) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "gift-orbit-item";
        item.setAttribute("aria-label", `${gift.label || gift.name || "Profile gift"}. Drag to move; release to return to its floating position.`);
        item.draggable = false;

        const shell = document.createElement("span");
        shell.className = "gift-orbit-shell";
        shell.setAttribute("aria-hidden", "true");

        const lottieBox = document.createElement("span");
        lottieBox.className = "gift-orbit-lottie";
        lottieBox.setAttribute("aria-hidden", "true");
        shell.appendChild(lottieBox);

        const sparkles = document.createElement("span");
        sparkles.className = "gift-orbit-sparkles";
        sparkles.setAttribute("aria-hidden", "true");
        for (let sparkleIndex = 0; sparkleIndex < 4; sparkleIndex += 1) {
            const sparkle = document.createElement("i");
            sparkle.className = "gift-orbit-sparkle";
            sparkle.style.setProperty("--sparkle-index", sparkleIndex);
            sparkles.appendChild(sparkle);
        }
        shell.appendChild(sparkles);
        item.appendChild(shell);
        orbit.appendChild(item);

        const floatingPosition = getOrbitPath(index, MAX_VISIBLE_GIFTS);
        const state = {
            item,
            shell,
            orbitPhase: floatingPosition.phase,
            radiusX: floatingPosition.radiusX,
            radiusY: floatingPosition.radiusY,
            orbitPeriod: floatingPosition.period,
            backScale: 0.72,
            frontScale: 1,
            dragScale: floatingPosition.dragScale,
            backOpacity: 0.54,
            depth: 0.5,
            x: 0,
            y: 0,
            grabOffsetX: 0,
            grabOffsetY: 0,
            pointerId: null,
            dragging: false,
            returning: null,
            keyboardActive: false,
            animation: null
        };
        items.push(state);
        bindPointerDrag(state);
        bindKeyboard(state);

        if (typeof window.lottie === "undefined") {
            setFallback(item, "Lottie is unavailable");
            return;
        }

        try {
            state.animation = window.lottie.loadAnimation({
                container: lottieBox,
                renderer: "svg",
                loop: true,
                autoplay: !reducedMotion,
                path: gift.json,
                rendererSettings: {
                    preserveAspectRatio: "xMidYMid meet",
                    progressiveLoad: true
                }
            });
            state.animation.addEventListener("data_failed", () => setFallback(item, gift.json));
        } catch (error) {
            setFallback(item, error);
        }
    }

    function syncMotionPreference(event) {
        const now = performance.now();
        if (event.matches && !reducedMotion) {
            motionPausedAt = now;
        } else if (!event.matches && reducedMotion && motionPausedAt !== null) {
            motionEpoch += now - motionPausedAt;
            motionPausedAt = null;
        }
        reducedMotion = event.matches;
        setStickerMotion();
        if (reducedMotion && !hasAnimatedReturn()) stopAnimation();
        else startAnimation();
        renderPositions(performance.now());
    }

    document.addEventListener("visibilitychange", () => {
        setStickerMotion();
        if (document.hidden) stopAnimation();
        else {
            renderPositions(performance.now());
            startAnimation();
        }
    });
    window.addEventListener("resize", scheduleGeometryUpdate, { passive: true });
    window.addEventListener("scroll", scheduleGeometryUpdate, { passive: true });
    document.addEventListener("scroll", scheduleGeometryUpdate, { capture: true, passive: true });
    if (portfolioScroller) {
        portfolioScroller.addEventListener("scroll", scheduleGeometryUpdate, { passive: true });
    }

    if (typeof window.MutationObserver === "function") {
        const pageStateObserver = new MutationObserver(scheduleGeometryUpdate);
        pageStateObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }

    if (typeof window.IntersectionObserver === "function") {
        const visibilityObserver = new IntersectionObserver(() => {
            scheduleGeometryUpdate();
        }, { threshold: [0, 0.01] });
        visibilityObserver.observe(avatar);
    }
    window.addEventListener("blur", () => {
        items.forEach((state) => {
            if (state.keyboardActive) {
                state.keyboardActive = false;
                returnToFloatingPosition(state);
            }
        });
    });

    if (motionQuery) {
        if (motionQuery.addEventListener) motionQuery.addEventListener("change", syncMotionPreference);
        else if (motionQuery.addListener) motionQuery.addListener(syncMotionPreference);
    }

    manifestPromise
        .then((manifest) => {
            if (!Array.isArray(manifest)) throw new Error("Gift manifest must be an array");
            const gifts = manifest.filter((gift) => gift && isLocalGiftPath(gift.json));
            if (gifts.length < MAX_VISIBLE_GIFTS) throw new Error("Three local gift animations are required");
            shuffle(gifts).slice(0, MAX_VISIBLE_GIFTS).forEach((gift, index) => {
                createGift(gift, index);
            });
            renderPositions(performance.now(), updateAvatarGeometry());
            setStickerMotion();
            startAnimation();
        })
        .catch((error) => {
            orbit.hidden = true;
            console.warn("Profile gifts are unavailable:", error);
        });
})();
