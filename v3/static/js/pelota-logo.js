/* El logo de ZeroWaste: la pelota de tenis en 3D con la S.

   Se monta solo en cada elemento con `data-pelota`:
     <span class="logo-mark pelota" data-pelota><img src=".../pelota-64.png" alt=""></span>
   La imagen de adentro es el respaldo (sin JS, sin WebGL o mientras carga); cuando
   la pelota 3D dibuja su primer cuadro, la imagen se oculta.

   Modos (valor de data-pelota):
     ""        logo chico: se balancea apenas y gira una vuelta al pasar el mouse.
     "foto"    quieta del todo (para sacar los íconos de la app).
     "vidriera" grande: además gira sola cada tanto, sigue al mouse y se arrastra.
   En todos, la S es la posición de descanso: todo movimiento vuelve a ella.

   Un solo contexto WebGL para todas las pelotas de la página: se dibuja cada una
   en el mismo lienzo oculto y se copia a su canvas. */
import * as THREE from "../vendor/three/three.module.min.js";
import { RoomEnvironment } from "../vendor/three/RoomEnvironment.js";

const QUIETA = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- La costura: la S del logo ---------- */
const S_DEL_LOGO = [
  [0.86, 0.51], [0.62, 0.60], [0.30, 0.64], [-0.05, 0.62], [-0.38, 0.52], [-0.54, 0.32],
  [-0.52, 0.12], [-0.34, -0.01], [-0.02, -0.04], [0.30, -0.08], [0.47, -0.30],
  [0.40, -0.56], [0.10, -0.68], [-0.30, -0.66], [-0.62, -0.58], [-0.86, -0.51],
];
function puntosDeLaCostura() {
  const n = S_DEL_LOGO.length;
  const adelante = S_DEL_LOGO.map(([x, y], k) => {
    if (k === 0 || k === n - 1) { const r = Math.hypot(x, y); return new THREE.Vector3(x / r, y / r, 0); }
    return new THREE.Vector3(x, y, Math.sqrt(Math.max(0.02, 1 - x * x - y * y)));
  });
  adelante[n - 1].copy(adelante[0]).negate();
  const atras = adelante.slice(1, n - 1).map((v) => v.clone().negate());
  return [...adelante, ...atras];
}
/* Los puntos marcados a mano dejan ondas: se muestrea fino y se suaviza sobre la esfera. */
function costuraSuave(puntos, muestras = 240, pasadas = 60) {
  const cruda = new THREE.CatmullRomCurve3(puntos, true, "centripetal");
  let p = cruda.getSpacedPoints(muestras).slice(0, muestras).map((v) => v.normalize());
  for (let k = 0; k < pasadas; k++) {
    p = p.map((v, i) => {
      const a = p[(i - 1 + muestras) % muestras], b = p[(i + 1) % muestras];
      return v.clone().multiplyScalar(0.5).addScaledVector(a, 0.25).addScaledVector(b, 0.25).normalize();
    });
  }
  return new THREE.CatmullRomCurve3(p, true, "centripetal");
}
class Costura extends THREE.Curve {
  constructor(r, base) { super(); this.r = r; this.base = base; }
  getPoint(u, out = new THREE.Vector3()) { return this.base.getPoint(u, out).normalize().multiplyScalar(this.r); }
}

function texturaDeFieltro() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const x = c.getContext("2d"); const img = x.createImageData(512, 512);
  for (let i = 0; i < img.data.length; i += 4) { const v = 110 + Math.random() * 145; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 3); return t;
}

/* ---------- La escena (una sola, compartida) ---------- */
let motor = null;
function crearMotor() {
  const lienzo = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  const escena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camara = new THREE.PerspectiveCamera(30, 1, 0.1, 20); camara.position.set(0, 0, 4.6);

  const inclinacion = new THREE.Group(); escena.add(inclinacion);
  const grupo = new THREE.Group(); inclinacion.add(grupo);

  const base = costuraSuave(puntosDeLaCostura());
  const bola = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#bcff00"), roughness: 0.85, metalness: 0,
    emissive: new THREE.Color("#8cd400"), emissiveIntensity: 0.5,
    sheen: 0.25, sheenColor: new THREE.Color("#e4ff00"), sheenRoughness: 0.5,
    bumpMap: texturaDeFieltro(), bumpScale: 0.35, envMapIntensity: 0.15,
  }));
  /* Sombra suave pegada a la costura, calculada contra los tramos de la línea. */
  const puntosAO = new Costura(1, base).getSpacedPoints(120);
  bola.material.onBeforeCompile = (sh) => {
    sh.uniforms.costura = { value: puntosAO };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPosBola;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPosBola = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPosBola;\nuniform vec3 costura[121];\nfloat aTramo(vec3 p, vec3 a, vec3 b){ vec3 ab = b - a; float h = clamp(dot(p - a, ab) / dot(ab, ab), 0., 1.); return length(p - a - ab * h); }")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 haciaLuz = normalize(vec3(-0.45, 0.55, 0.7)) * 0.07;
        float dCerca = 10., dLuz = 10.;
        for (int i = 0; i < 120; i++) {
          dCerca = min(dCerca, aTramo(vPosBola, costura[i], costura[i + 1]));
          dLuz = min(dLuz, aTramo(vPosBola + haciaLuz, costura[i], costura[i + 1]));
        }
        float aoCostura = mix(0.78, 1.0, smoothstep(0.05, 0.16, dCerca)) * mix(0.82, 1.0, smoothstep(0.03, 0.2, dLuz));
        diffuseColor.rgb *= aoCostura;`)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= aoCostura;");
  };
  grupo.add(bola);

  const linea = new THREE.Mesh(new THREE.TubeGeometry(new Costura(0.998, base), 800, 0.06, 32, true),
    new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.6 }));
  grupo.add(linea);

  /* El brillo verde del borde. */
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 48), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { color: { value: new THREE.Color("#c6ff00") } },
    vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
    fragmentShader: "uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(vN, vV)), 2.2); float borde = pow(1. - smoothstep(0.5, 1., f), 1.6) * smoothstep(0.25, 0.5, f); gl_FragColor = vec4(color, min(1., borde * 1.25)); }",
  }));
  inclinacion.add(halo);

  escena.add(new THREE.HemisphereLight("#ffffff", "#4a7a00", 0.6));
  const llave = new THREE.DirectionalLight("#ffffff", 2.0); llave.position.set(-2.5, 3, 4); escena.add(llave);
  const contra = new THREE.DirectionalLight("#d8ff00", 1.6); contra.position.set(3, -1.5, -2.5); escena.add(contra);

  return { renderer, lienzo, escena, camara, inclinacion, grupo, ancho: 0, alto: 0 };
}

/* ---------- Cada pelota de la página ---------- */
const pelotas = new Set();
const reloj = new THREE.Clock();
let andando = false;

function suavizar(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

export function montar(el) {
  if (!el || el.__pelota) return;
  if (!motor) {
    try { motor = crearMotor(); } catch { return; } // sin WebGL queda la imagen
  }
  const vidriera = el.dataset.pelota === "vidriera";
  const foto = el.dataset.pelota === "foto"; // quieta, para sacar los íconos
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "pelota-3d";
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const p = {
    el, canvas, ctx, vidriera, foto, visible: true, lista: false,
    mx: 0, my: 0, tiltX: 0, tiltY: 0, extraX: 0, extraY: 0, arrastre: null,
    rebote: 0, vuelta: -1, desfase: Math.random() * 10,
  };
  el.__pelota = p;

  /* Al pasar el mouse por el logo (o por el link que lo contiene): salta y da una vuelta. */
  const disparador = el.closest("a, .logo, .ac-marca") || el;
  p.alEntrar = () => { p.rebote = 1; if (p.vuelta < 0) p.vuelta = 0; };
  disparador.addEventListener("pointerenter", p.alEntrar);
  p.disparador = disparador;

  if (vidriera) {
    canvas.style.cursor = "grab";
    p.alMover = (e) => {
      const r = canvas.getBoundingClientRect();
      p.mx = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1.5, 1.5);
      p.my = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1.5, 1.5);
      if (p.arrastre) {
        p.extraY += (e.clientX - p.arrastre.x) * 0.01; p.extraX += (e.clientY - p.arrastre.y) * 0.01;
        p.arrastre = { x: e.clientX, y: e.clientY };
      }
    };
    p.alSoltar = () => { p.arrastre = null; canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerdown", (e) => { p.arrastre = { x: e.clientX, y: e.clientY }; canvas.style.cursor = "grabbing"; canvas.setPointerCapture(e.pointerId); });
    addEventListener("pointermove", p.alMover);
    addEventListener("pointerup", p.alSoltar);
  }

  p.io = new IntersectionObserver(([e]) => { p.visible = e.isIntersecting; });
  p.io.observe(el);
  pelotas.add(p);
  if (!andando) { andando = true; requestAnimationFrame(cuadro); }
}

export function desmontar(el) {
  const p = el && el.__pelota; if (!p) return;
  p.io.disconnect();
  p.disparador.removeEventListener("pointerenter", p.alEntrar);
  if (p.alMover) { removeEventListener("pointermove", p.alMover); removeEventListener("pointerup", p.alSoltar); }
  p.canvas.remove(); el.classList.remove("pelota-lista");
  pelotas.delete(p); delete el.__pelota;
}

function dibujar(p, t, dt) {
  const { renderer, lienzo, escena, camara, inclinacion, grupo } = motor;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(p.el.clientWidth * dpr)), h = Math.max(1, Math.round(p.el.clientHeight * dpr));
  if (p.canvas.width !== w || p.canvas.height !== h) { p.canvas.width = w; p.canvas.height = h; }
  if (motor.ancho < w || motor.alto < h) {
    motor.ancho = Math.max(motor.ancho, w); motor.alto = Math.max(motor.alto, h);
    renderer.setSize(motor.ancho, motor.alto, false);
  }

  /* Movimiento: todo vuelve a mostrar la S de frente. */
  let balanceoY = 0, balanceoX = 0, giro = 0;
  if (!QUIETA && !p.foto) {
    const tt = t + p.desfase;
    balanceoY = Math.sin(tt * 0.7) * (p.vidriera ? 0.18 : 0.14);
    balanceoX = Math.sin(tt * 0.5) * (p.vidriera ? 0.08 : 0.06);
    if (p.vidriera && p.vuelta < 0 && (t % 8) < dt) p.vuelta = 0;     // una vuelta cada 8 s
    if (p.vuelta >= 0) {
      p.vuelta += dt / 1.6;
      if (p.vuelta >= 1) p.vuelta = -1; else giro = suavizar(p.vuelta) * Math.PI * 2;
    }
  }
  if (!p.arrastre) { p.extraX *= 0.92; p.extraY *= 0.92; }
  p.tiltY += ((p.vidriera ? p.mx * 0.35 : 0) - p.tiltY) * 0.06;
  p.tiltX += ((p.vidriera ? p.my * 0.25 : 0) - p.tiltX) * 0.06;
  p.rebote *= 0.93;

  inclinacion.rotation.set(p.tiltX, p.tiltY, 0);
  grupo.rotation.set(p.extraX + balanceoX, p.extraY + balanceoY + giro, 0);
  grupo.scale.setScalar(1 + Math.sin(p.rebote * Math.PI) * 0.06);
  grupo.position.y = QUIETA || !p.vidriera ? 0 : Math.sin(t * 1.3) * 0.04;
  camara.aspect = w / h; camara.updateProjectionMatrix();

  /* Dibuja en la esquina de abajo del lienzo compartido y lo copia a esta pelota. */
  renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h); renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(escena, camara);
  p.ctx.clearRect(0, 0, w, h);
  p.ctx.drawImage(lienzo, 0, motor.alto - h, w, h, 0, 0, w, h);
  if (!p.lista) { p.lista = true; p.el.classList.add("pelota-lista"); }
}

let previo = 0;
function cuadro() {
  const t = reloj.getElapsedTime();
  const dt = Math.min(0.1, t - previo); previo = t;
  for (const p of pelotas) {
    if (!p.el.isConnected) { desmontar(p.el); continue; }
    if (p.visible || !p.lista) dibujar(p, t, dt);
  }
  if (pelotas.size) requestAnimationFrame(cuadro); else andando = false;
}

/* Arranque: las que ya están en la página. */
function montarTodas(raiz = document) { raiz.querySelectorAll("[data-pelota]").forEach(montar); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => montarTodas());
else montarTodas();
