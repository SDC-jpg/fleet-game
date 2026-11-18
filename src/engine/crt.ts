// CRT screen effect: an old tube screen look over the finished game picture, drawn on
// the graphics card (WebGL 2). The renderer hands over its buffer at the end of each frame
// (renderer.end); this draws it enlarged onto its own canvas, laid exactly over the game
// canvas, with:
// - glow ("bloom"): the bright parts, shrunk, blurred and added back, tinted a little;
// - colour fringes: red and blue taken from slightly different spots toward the edges;
// - curved glass: the picture bulges, with black rounded corners;
// - colour stripes: the tube's red/green/blue grille, from an image (ui.crt-mask) tiled
//   across the screen, so an artist can paint their own pattern;
// - scanlines, dark corners, lifted blacks, softness, grain, flicker and a rolling band.
// Sizes are in pixels of a 1080-pixel-tall screen and scale with the canvas.
// With `hud` on, the stripes and dark corners are left to a page overlay instead (App.tsx),
// so they cover the HUD and menus too without being applied twice.
// If WebGL isn't available (or the context is lost), `render` returns false and the
// renderer draws the plain picture as before.

export interface CrtParams {
  enabled: boolean;
  hud: boolean;
  curvature: number;
  aberration: number;
  bloom: number;
  bloomRadius: number;
  bloomThreshold: number;
  bloomTint: number;
  bloomColor: string;
  mask: number;
  maskSize: number;
  scanlines: number;
  vignette: number;
  blackLift: number;
  liftColor: string;
  softness: number;
  noise: number;
  flicker: number;
  rollBand: number;
}

/** "#b46cff" → [0.71, 0.42, 1]. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The glow is worked out at this fraction of the screen size (cheaper, and blurrier for free). */
const BLOOM_DOWNSCALE = 4;

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  // One triangle covering the whole screen.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Screen position (0–1, y up) → position in the source buffer texture (flipped on upload,
// top-left aligned, enlarged by the renderer's buffer scale).
const SRC = `
uniform vec2 uMap;
vec2 srcUv(vec2 uv) { return vec2(uv.x * uMap.x, 1.0 - (1.0 - uv.y) * uMap.y); }
`;

/** The bright parts of the picture, shrunk to the glow's size. */
const BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uPx; // one screen pixel, in 0–1 units
uniform float uThreshold;
${SRC}
void main() {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i & 1, i >> 1) * 2.0 - 1.0;
    c += texture(uSrc, srcUv(vUv + o * uPx * 1.0)).rgb;
  }
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.25, l), 1.0);
}`;

/** A one-direction blur (run across, then down). */
const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  float w[5] = float[](0.227, 0.1945, 0.1216, 0.054, 0.0162);
  vec3 c = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uTex, vUv + uStep * float(i)).rgb * w[i];
    c += texture(uTex, vUv - uStep * float(i)).rgb * w[i];
  }
  outColor = vec4(c, 1.0);
}`;

/** Everything together, onto the screen. */
const FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrcN;   // the picture, crisp
uniform sampler2D uSrcL;   // the same picture, smoothed (softness)
uniform sampler2D uBloom;
uniform sampler2D uMask;
uniform vec2 uScreen;      // screen size in pixels
uniform float uK;          // screen pixels per pixel of a 1080-pixel-tall screen
uniform float uTime;
uniform bool uHud;         // the page overlay does the stripes and dark corners
uniform float uCurvature, uAberration, uBloomAmt, uBloomTint, uMaskAmt, uMaskSize, uMaskW, uMaskAvg;
uniform float uScan, uVignette, uLift, uSoft, uNoise, uFlicker, uRoll;
uniform vec3 uBloomColor, uLiftColor;
${SRC}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 pic(vec2 uv) {
  vec3 crisp = texture(uSrcN, srcUv(uv)).rgb;
  if (uSoft <= 0.0) return crisp;
  vec2 px = uK / uScreen;
  vec3 soft = 0.25 * (texture(uSrcL, srcUv(uv + vec2(px.x, 0.0))).rgb + texture(uSrcL, srcUv(uv - vec2(px.x, 0.0))).rgb
                    + texture(uSrcL, srcUv(uv + vec2(0.0, px.y))).rgb + texture(uSrcL, srcUv(uv - vec2(0.0, px.y))).rgb);
  return mix(crisp, soft, uSoft);
}
void main() {
  vec2 cc = vUv * 2.0 - 1.0;
  // Curved glass: sample further out toward the edges (the picture bulges); the middle of
  // each edge stays on the edge, the corners fall off into black.
  float r2 = dot(cc, cc);
  vec2 bent = cc * (1.0 + uCurvature * r2) / (1.0 + uCurvature);
  vec2 edgePx = (1.0 - abs(bent)) * uScreen * 0.5;
  float inside = clamp(min(edgePx.x, edgePx.y) / (1.5 * uK), 0.0, 1.0);
  vec2 uv = bent * 0.5 + 0.5;

  // Colour fringes: red outward, blue inward, more toward the edges.
  vec2 off = cc * uAberration * uK / uScreen;
  vec3 col = vec3(pic(uv + off).r, pic(uv).g, pic(uv - off).b);

  // Glow, tinted toward the glow colour.
  vec3 b = texture(uBloom, uv).rgb;
  float bl = max(b.r, max(b.g, b.b));
  col += uBloomAmt * mix(b, bl * uBloomColor, uBloomTint);

  // Scanlines (one every 3 pixels of a 1080 screen).
  col *= 1.0 - uScan * 0.5 * (1.0 + cos(gl_FragCoord.y * 6.2832 / (3.0 * uK)));

  // Colour stripes, made up for in brightness so the picture doesn't just get darker.
  float boost = 1.0 / mix(1.0, uMaskAvg, uMaskAmt);
  if (!uHud) {
    vec3 m = texture(uMask, vec2(gl_FragCoord.x / (uMaskSize * uK * uMaskW), 0.5)).rgb;
    col *= mix(vec3(1.0), m, uMaskAmt);
  }
  col *= boost;

  // Lifted blacks, tinted.
  col += uLiftColor * uLift * (1.0 - clamp(col, 0.0, 1.0));

  // A faint band rolling down the screen, flicker and grain.
  float band = fract(uTime * 0.07);
  col *= 1.0 + uRoll * exp(-pow((vUv.y - (1.0 - band)) * 9.0, 2.0));
  col *= 1.0 + uFlicker * (hash(vec2(floor(uTime * 30.0), 1.7)) * 2.0 - 1.0);
  col += (hash(gl_FragCoord.xy + fract(uTime) * vec2(113.0, 71.0)) - 0.5) * uNoise;

  // Dark corners.
  if (!uHud) col *= 1.0 - uVignette * smoothstep(0.35, 1.9, r2);

  outColor = vec4(clamp(col, 0.0, 1.0) * inside, 1.0);
}`;

interface Pass {
  prog: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}

export class CrtFilter {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null;
  private lost = false;
  private bright?: Pass;
  private blur?: Pass;
  private final?: Pass;
  private src!: WebGLTexture;
  private maskTex!: WebGLTexture;
  private maskW = 3;
  private maskAvg = 1 / 3;
  private nearest!: WebGLSampler;
  private linear!: WebGLSampler;
  private repeat!: WebGLSampler;
  private bloom: { tex: WebGLTexture; fb: WebGLFramebuffer }[] = [];
  private bloomW = 0;
  private bloomH = 0;

  /** The game canvas this one is laid over. */
  private screen: HTMLCanvasElement;

  /** `screen`: the game canvas this one is laid over. `mask`: the stripe image (ui.crt-mask). */
  constructor(screen: HTMLCanvasElement, mask: CanvasImageSource & { width: number; height: number }) {
    this.screen = screen;
    this.canvas.className = 'crt-canvas';
    this.canvas.style.display = 'none';
    screen.after(this.canvas);
    this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    if (!this.gl) return;
    try {
      this.setup(mask);
    } catch (e) {
      console.warn('CRT effect unavailable:', e);
      this.gl = null;
    }
  }

  /** Can the effect be drawn here (WebGL 2 works)? */
  get supported() {
    return !!this.gl && !this.lost;
  }

  private setup(mask: CanvasImageSource & { width: number; height: number }) {
    const gl = this.gl!;
    const pass = (frag: string, names: string[]): Pass => {
      const prog = gl.createProgram()!;
      for (const [type, text] of [
        [gl.VERTEX_SHADER, VERT],
        [gl.FRAGMENT_SHADER, frag],
      ] as const) {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, text);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
        gl.attachShader(prog, sh);
      }
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
      return { prog, u: new Map(names.map((n) => [n, gl.getUniformLocation(prog, n)])) };
    };
    this.bright = pass(BRIGHT, ['uSrc', 'uPx', 'uThreshold', 'uMap']);
    this.blur = pass(BLUR, ['uTex', 'uStep']);
    this.final = pass(FINAL, [
      'uSrcN', 'uSrcL', 'uBloom', 'uMask', 'uScreen', 'uK', 'uTime', 'uHud', 'uMap',
      'uCurvature', 'uAberration', 'uBloomAmt', 'uBloomTint', 'uMaskAmt', 'uMaskSize', 'uMaskW', 'uMaskAvg',
      'uScan', 'uVignette', 'uLift', 'uSoft', 'uNoise', 'uFlicker', 'uRoll', 'uBloomColor', 'uLiftColor',
    ]);
    gl.bindVertexArray(gl.createVertexArray());

    const sampler = (filter: number, wrap: number) => {
      const s = gl.createSampler()!;
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
      return s;
    };
    this.nearest = sampler(gl.NEAREST, gl.CLAMP_TO_EDGE);
    this.linear = sampler(gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.repeat = sampler(gl.LINEAR, gl.REPEAT);
    this.src = gl.createTexture()!;

    // The stripe image, and its average brightness (to make up for the darkening).
    this.maskTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask as TexImageSource);
    this.maskW = Math.max(1, mask.width);
    const c = document.createElement('canvas');
    c.width = mask.width;
    c.height = mask.height;
    const g = c.getContext('2d')!;
    g.drawImage(mask, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    this.maskAvg = Math.max(0.05, sum / (d.length / 4) / 255);
  }

  /** Make the glow's two working images match the screen size. */
  private sizeBloom(w: number, h: number) {
    const gl = this.gl!;
    const bw = Math.max(1, Math.ceil(w / BLOOM_DOWNSCALE));
    const bh = Math.max(1, Math.ceil(h / BLOOM_DOWNSCALE));
    if (bw === this.bloomW && bh === this.bloomH) return;
    for (const b of this.bloom) {
      gl.deleteTexture(b.tex);
      gl.deleteFramebuffer(b.fb);
    }
    this.bloom = [0, 1].map(() => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    });
    this.bloomW = bw;
    this.bloomH = bh;
  }

  private bindTex(unit: number, tex: WebGLTexture, sampler: WebGLSampler) {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindSampler(unit, sampler);
  }

  /** Remove the effect's canvas (when the game or preview stops). */
  destroy() {
    this.canvas.remove();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Stop showing the effect (the plain game canvas shows again). */
  hide() {
    this.canvas.style.display = 'none';
  }

  /**
   * Draw `source` (the renderer's buffer, `scale` screen pixels per buffer pixel) with the
   * effect. Returns false if it can't (then draw the plain picture instead).
   */
  render(source: HTMLCanvasElement, scale: number, p: CrtParams): boolean {
    const gl = this.gl;
    if (!gl || this.lost || !this.final || !this.bright || !this.blur) return false;
    const w = this.screen.width;
    const h = this.screen.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = this.screen.style.width;
    this.canvas.style.height = this.screen.style.height;
    this.canvas.style.display = 'block';
    this.sizeBloom(w, h);
    // Sized by the window (not this canvas), so a small preview (ShipArt) matches the game.
    const k = (window.innerHeight * (window.devicePixelRatio || 1)) / 1080;
    const map = [w / (source.width * scale), h / (source.height * scale)];

    // The picture.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // Glow: bright parts, then blurred across and down, twice.
    const [A, B] = this.bloom;
    gl.viewport(0, 0, this.bloomW, this.bloomH);
    gl.useProgram(this.bright.prog);
    this.bindTex(0, this.src, this.linear);
    gl.uniform1i(this.bright.u.get('uSrc')!, 0);
    gl.uniform2f(this.bright.u.get('uPx')!, 1 / w, 1 / h);
    gl.uniform1f(this.bright.u.get('uThreshold')!, p.bloomThreshold);
    gl.uniform2f(this.bright.u.get('uMap')!, map[0], map[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.blur.prog);
    gl.uniform1i(this.blur.u.get('uTex')!, 0);
    const spread = (p.bloomRadius * k) / BLOOM_DOWNSCALE / 4; // 4 taps each side
    for (let i = 0; i < 2; i++)
      for (const [from, to, dx, dy] of [
        [A, B, 1, 0],
        [B, A, 0, 1],
      ] as const) {
        this.bindTex(0, from.tex, this.linear);
        gl.uniform2f(this.blur.u.get('uStep')!, (dx * spread) / this.bloomW, (dy * spread) / this.bloomH);
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

    // Everything together, onto the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const f = this.final;
    const u = (n: string) => f.u.get(n)!;
    gl.useProgram(f.prog);
    this.bindTex(0, this.src, this.nearest);
    this.bindTex(1, this.src, this.linear);
    this.bindTex(2, A.tex, this.linear);
    this.bindTex(3, this.maskTex, this.repeat);
    gl.uniform1i(u('uSrcN'), 0);
    gl.uniform1i(u('uSrcL'), 1);
    gl.uniform1i(u('uBloom'), 2);
    gl.uniform1i(u('uMask'), 3);
    gl.uniform2f(u('uScreen'), w, h);
    gl.uniform2f(u('uMap'), map[0], map[1]);
    gl.uniform1f(u('uK'), k);
    gl.uniform1f(u('uTime'), (performance.now() / 1000) % 1000);
    gl.uniform1i(u('uHud'), p.hud ? 1 : 0);
    gl.uniform1f(u('uCurvature'), p.curvature);
    gl.uniform1f(u('uAberration'), p.aberration);
    gl.uniform1f(u('uBloomAmt'), p.bloom);
    gl.uniform1f(u('uBloomTint'), p.bloomTint);
    gl.uniform1f(u('uMaskAmt'), p.mask);
    gl.uniform1f(u('uMaskSize'), Math.max(0.1, p.maskSize));
    gl.uniform1f(u('uMaskW'), this.maskW);
    gl.uniform1f(u('uMaskAvg'), this.maskAvg);
    gl.uniform1f(u('uScan'), p.scanlines);
    gl.uniform1f(u('uVignette'), p.vignette);
    gl.uniform1f(u('uLift'), p.blackLift);
    gl.uniform1f(u('uSoft'), p.softness);
    gl.uniform1f(u('uNoise'), p.noise);
    gl.uniform1f(u('uFlicker'), p.flicker);
    gl.uniform1f(u('uRoll'), p.rollBand);
    gl.uniform3f(u('uBloomColor'), ...rgb(p.bloomColor));
    gl.uniform3f(u('uLiftColor'), ...rgb(p.liftColor));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** Width of the stripe image in pixels (one repeat). */
  get stripeWidth() {
    return this.maskW;
  }

  /** Average brightness of the stripe image (0–1): the page overlay makes up for it the same way. */
  get stripeAverage() {
    return this.maskAvg;
  }
}
