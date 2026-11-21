/*
 * blackhole.js — same original scale and interactions, with stable long-run animation,
 * no viewport-edge fade, and WebGL context restoration.
 */
(() => {
  "use strict";

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform vec2  uRes;
    uniform vec4  uTimeHi;
    uniform vec3  uTimeLo;
    uniform vec2  uMouse;
    uniform float uLight;

    #define STEPS 110
    #define RIN   2.7
    #define ROUT  13.2

    const float TAU = 6.28318530718;

    // Rebuild the elapsed-time phase from base-256 millisecond digits.
    // Reducing at every digit prevents a large ever-growing float uniform and avoids
    // the visible discontinuity caused by wrapping one shared time value every N seconds.
    float elapsedPhase(float radiansPerSecond) {
      float rate = radiansPerSecond / 1000.0;
      float phase = 0.0;
      phase = mod(phase * 256.0 + uTimeHi.x * rate, TAU);
      phase = mod(phase * 256.0 + uTimeHi.y * rate, TAU);
      phase = mod(phase * 256.0 + uTimeHi.z * rate, TAU);
      phase = mod(phase * 256.0 + uTimeHi.w * rate, TAU);
      phase = mod(phase * 256.0 + uTimeLo.x * rate, TAU);
      phase = mod(phase * 256.0 + uTimeLo.y * rate, TAU);
      phase = mod(phase * 256.0 + uTimeLo.z * rate, TAU);
      return phase;
    }

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.55;
      for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
      return v;
    }

    void main() {
      // Keep the original camera framing and scale.
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.x;

      // milder orbit so disk never hits the canvas walls
      float yaw   = uMouse.x * 0.55;
      float pitch = 0.17 + uMouse.y * 0.10;
      float D = 40.0;
      vec3 ro  = vec3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)) * D;
      vec3 fwd = normalize(-ro);
      vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
      vec3 up  = cross(fwd, rgt);

      vec3 p = ro;
      // wider FOV → full disk + haze always inside the same 100% canvas
      vec3 v = normalize(fwd + (uv.x * rgt + uv.y * up) * 0.78);

      float accum = 0.0;
      float trans = 1.0;
      bool  horizon = false;
      float minr = 1e3;

      for (int i = 0; i < STEPS; i++) {
        float r2 = dot(p, p);
        float r  = sqrt(r2);
        minr = min(minr, r);
        if (r < 1.0) { horizon = true; break; }
        if (r > 22.0 && dot(p, v) > 0.0) break;

        float dt = 0.03 + 0.06 * r;

        vec3 h = cross(p, v);
        v = normalize(v - 1.5 * dot(h, h) * p / (r2 * r2 * r) * dt);
        vec3 pn = p + v * dt;

        if (p.y * pn.y < 0.0) {
          float t  = p.y / (p.y - pn.y);
          vec3  q  = mix(p, pn, t);
          float rq = length(q.xz);
          if (rq > RIN && rq < ROUT) {
            float ang   = atan(q.z, q.x);
            float omega = 2.7 * pow(rq, -1.5);
            float phase = elapsedPhase(omega * 5.5); // same spin speed
            float a2    = ang - phase;
            vec2  dir   = vec2(cos(a2), sin(a2));

            float n     = fbm(dir * 3.0 + vec2(rq * 1.15, rq * 0.6));
            float clump = pow(clamp(n * 1.6, 0.0, 1.0), 1.6);
            float lines = 0.74 + 0.26 * sin(rq * 4.6 + n * 4.0 + a2 * 2.0);
            float n2    = vnoise(dir * 4.5 + vec2(rq * 2.4, 3.0));

            float inEdge  = smoothstep(RIN, RIN + 0.4, rq);
            float outEdge = 1.0 - smoothstep(ROUT - 4.0, ROUT, rq);
            float dens = inEdge * outEdge * (0.25 + 0.95 * clump) * lines * (0.78 + 0.45 * n2);

            // permanent outer haze
            float haze = smoothstep(ROUT - 5.8, ROUT - 1.8, rq) * (1.0 - smoothstep(ROUT - 1.0, ROUT + 0.4, rq));
            dens += haze * (0.16 + 0.24 * n2) * (0.65 + 0.35 * clump);

            vec3  vt  = normalize(vec3(-q.z, 0.0, q.x));
            float dop = clamp(1.0 + 0.42 * dot(vt, -v), 0.45, 1.6);

            float emis = pow(RIN / max(rq, RIN), 1.0) * dens * pow(dop, 2.2) * 2.2;
            accum += trans * emis;
            trans *= 1.0 - clamp(dens * 0.68, 0.0, 0.88);
            if (trans < 0.02) break;
          }
        }
        p = pn;
      }

      float I = 1.0 - exp(-accum * 1.28);
      // sharp black circle
      if (!horizon) I += 0.34 * exp(-pow((minr - 1.56) * 6.0, 2.0));
      I = clamp(I, 0.0, 1.0);

      if (uLight < 0.5) {
        gl_FragColor = vec4(vec3(I), I);
      } else {
        float a = horizon ? 1.0 : I;
        gl_FragColor = vec4(vec3(0.0), a);
      }
    }
  `;

  function compile(gl, type, src) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[blackhole] shader error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function create(holder, opts = {}) {
    const isActive = opts.active || (() => true);

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl", {
      alpha: true, premultipliedAlpha: true, antialias: false,
      powerPreference: "high-performance", preserveDrawingBuffer: !!opts.preserve
    });
    if (!gl) return null;

    let u = null;

    function initGL() {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) {
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        return false;
      }

      const prog = gl.createProgram();
      if (!prog) return false;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("[blackhole] program link error:", gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return false;
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      if (!buf) {
        gl.deleteProgram(prog);
        return false;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      u = {
        res: gl.getUniformLocation(prog, "uRes"),
        timeHi: gl.getUniformLocation(prog, "uTimeHi"),
        timeLo: gl.getUniformLocation(prog, "uTimeLo"),
        mouse: gl.getUniformLocation(prog, "uMouse"),
        light: gl.getUniformLocation(prog, "uLight")
      };
      gl.clearColor(0, 0, 0, 0);
      gl.viewport(0, 0, canvas.width, canvas.height);
      return true;
    }

    if (!initGL()) return null;
    holder.appendChild(canvas);

    const scale = Math.min(window.devicePixelRatio || 1, 1.25);

    function resize() {
      const w = Math.max(64, Math.round((holder.clientWidth || 480) * scale));
      const h = Math.max(48, Math.round((holder.clientHeight || 207) * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    const onMove = (e) => {
      const t = e.touches ? e.touches[0] : e;
      target.x = (t.clientX / window.innerWidth) * 2 - 1;
      target.y = -((t.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let spinTarget = 1, spin = 1;
    const enter = () => (spinTarget = 3.0);
    const leave = () => (spinTarget = 1);
    holder.addEventListener("pointerenter", enter);
    holder.addEventListener("pointerleave", leave);

    let inView = true;
    const io = new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; });
    io.observe(holder);

    let raf = 0, last = performance.now(), time = 0, dead = false, lost = false;

    function draw(timeSeconds) {
      // Convert elapsed time to seven base-256 millisecond digits. The shader reduces
      // each digit modulo 2π, so its float uniforms always remain small and bounded.
      let milliseconds = Math.floor(timeSeconds * 1000);
      const digits = new Array(7);
      for (let i = 0; i < digits.length; i++) {
        digits[i] = milliseconds % 256;
        milliseconds = Math.floor(milliseconds / 256);
      }

      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform4f(u.timeHi, digits[6], digits[5], digits[4], digits[3]);
      gl.uniform3f(u.timeLo, digits[2], digits[1], digits[0]);
      gl.uniform2f(u.mouse, cur.x, cur.y);
      gl.uniform1f(u.light, document.body.classList.contains("light") ? 1 : 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const raw = now - last;
      const dt = Math.min(0.033, Math.max(0, raw / 1000));
      last = now;

      if (canvas.width === 0 || canvas.height === 0) resize();
      if (dead || lost || document.hidden || !inView || !isActive()) return;

      const k = 1 - Math.exp(-dt * 4.5);
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;
      spin += (spinTarget - spin) * (1 - Math.exp(-dt * 3.0));
      time += dt * spin;

      draw(time);
    }

    const onContextLost = (e) => {
      e.preventDefault();
      lost = true;
      holder.classList.add("off");
    };
    const onContextRestored = () => {
      if (!initGL()) {
        lost = true;
        return;
      }
      lost = false;
      resize();
      holder.classList.remove("off");
      draw(time);
    };
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);

    raf = requestAnimationFrame(frame);

    return {
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener("pointermove", onMove);
        holder.removeEventListener("pointerenter", enter);
        holder.removeEventListener("pointerleave", leave);
        canvas.removeEventListener("webglcontextlost", onContextLost, false);
        canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
        canvas.remove();
      },
      canvas, draw
    };
  }

  window.PfBlackHole = { create };
})();
