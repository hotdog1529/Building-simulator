// Build & Destroy Simulator with drag-and-drop weapons (tap-to-explode)
// Touch + mouse friendly. Works on iPad/iPhone & Desktop.
// Uses Matter.js

const { Engine, Render, Runner, Composite, Bodies, Body, Mouse, MouseConstraint, Events, Vector } = Matter;

// DOM
const canvas = document.getElementById('stage');
const gravityCheckbox = document.getElementById('gravityToggle');
const snapCheckbox = document.getElementById('snapToggle');
const sizeRange = document.getElementById('sizeRange');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');

const toolbarTools = document.querySelectorAll('.tool');
const toolbarShapes = document.querySelectorAll('.shape');
const weaponEls = document.querySelectorAll('.weapon');

let currentTool = 'spawn';
let currentShape = 'rectangle';

toolbarTools.forEach(t => t.addEventListener('click', () => {
  toolbarTools.forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  currentTool = t.dataset.tool;
}));

toolbarShapes.forEach(s => s.addEventListener('click', () => {
  toolbarShapes.forEach(x=>x.classList.remove('active'));
  s.classList.add('active');
  currentShape = s.dataset.shape;
}));

// --- Matter setup ---
const engine = Engine.create();
const world = engine.world;
world.gravity.y = gravityCheckbox.checked ? 1 : 0;

const render = Render.create({
  canvas: canvas,
  engine: engine,
  options: {
    width: window.innerWidth - (window.innerWidth > 720 ? 220 : 0),
    height: window.innerHeight,
    wireframes: false,
    background: 'transparent',
    pixelRatio: window.devicePixelRatio || 1
  }
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// resize
function resizeCanvas(){
  const toolbarWidth = (window.innerWidth > 720) ? 220 : 0;
  render.canvas.width = window.innerWidth - toolbarWidth;
  render.canvas.height = window.innerHeight;
  render.options.width = render.canvas.width;
  render.options.height = render.canvas.height;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// walls
const wallThickness = 80;
const createBounds = () => {
  if (world.boundsBodies) Composite.remove(world, world.boundsBodies);
  const w = render.options.width;
  const h = render.options.height;
  const left = Bodies.rectangle(-wallThickness/2, h/2, wallThickness, h*3, { isStatic:true });
  const right = Bodies.rectangle(w + wallThickness/2, h/2, wallThickness, h*3, { isStatic:true });
  const floor = Bodies.rectangle(w/2, h + wallThickness/2, w*2, wallThickness, { isStatic:true });
  const ceiling = Bodies.rectangle(w/2, -wallThickness/2, w*2, wallThickness, { isStatic:true });
  world.boundsBodies = [left, right, floor, ceiling];
  Composite.add(world, world.boundsBodies);
};
createBounds();
window.addEventListener('resize', createBounds);

// mouse & touch interactions
const mouse = Mouse.create(render.canvas);
const mouseConstraint = MouseConstraint.create(engine, {
  mouse: mouse,
  constraint: {
    stiffness: 0.2,
    render: { visible: false }
  }
});
Composite.add(world, mouseConstraint);

// prevent default touch move for canvas
render.canvas.addEventListener('touchmove', e => e.preventDefault(), { passive:false });

// snap util
function snapToGrid(v) {
  if (!snapCheckbox.checked) return v;
  const grid = 20;
  return Math.round(v / grid) * grid;
}

// spawn shapes
function spawnShapeAt(x,y, opts = {}) {
  const size = parseInt(sizeRange.value, 10) || 50;
  const common = {
    friction: 0.3, restitution: 0.1,
    render: { fillStyle: opts.color || randomColor() }
  };
  if (currentShape === 'rectangle') {
    const rect = Bodies.rectangle(snapToGrid(x), snapToGrid(y), size, Math.max(20, size*0.6), common);
    Composite.add(world, rect);
    return rect;
  } else {
    const circ = Bodies.circle(snapToGrid(x), snapToGrid(y), Math.max(8, size/2), common);
    Composite.add(world, circ);
    return circ;
  }
}

function randomColor(){
  return '#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
}

// Pointer conversions
const getPointerPos = (event) => {
  const rect = render.canvas.getBoundingClientRect();
  const p = event.touches ? event.touches[0] : event;
  return {
    x: (p.clientX - rect.left) * (render.canvas.width / rect.width),
    y: (p.clientY - rect.top) * (render.canvas.height / rect.height)
  };
};

// spawn/erase via pointer
let lastTap = 0;
render.canvas.addEventListener('pointerdown', e => {
  const p = getPointerPos(e);
  if (currentTool === 'spawn') {
    spawnShapeAt(p.x, p.y);
  } else if (currentTool === 'erase') {
    eraseAt(p.x, p.y);
  }
});

render.canvas.addEventListener('pointerup', e => {
  const now = Date.now();
  if (now - lastTap < 300) {
    // double-tap explosion at pointer
    const p = getPointerPos(e);
    explode(p.x, p.y, 0.06);
  }
  lastTap = now;
});

// erase helper
function eraseAt(x,y){
  const bodies = Composite.allBodies(world);
  const radius = Math.max(20, parseInt(sizeRange.value,10)/1.5);
  for (let i=bodies.length-1;i>=0;i--){
    const b = bodies[i];
    if (b.isStatic) continue;
    const dx = b.position.x - x;
    const dy = b.position.y - y;
    if (Math.sqrt(dx*dx+dy*dy) < (radius + (b.circleRadius || Math.max(b.bounds.max.x - b.bounds.min.x, b.bounds.max.y - b.bounds.min.y)/2))) {
      Composite.remove(world, b);
      break;
    }
  }
}

// --- Weapons: drag & drop from toolbar ---
// We'll implement a pointer-based drag so it works for touch and mouse (draggable attribute is unreliable on touch)
let draggingWeapon = null;   // {type, el, ghostEl}
let ghostEl = null;

weaponEls.forEach(w => {
  // mark as draggable for desktop accessibility
  w.setAttribute('draggable','false');

  w.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const type = w.dataset.weapon;
    startWeaponDrag(type, ev);
  });

  // keyboard accessible: space/enter to create in center of canvas
  w.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      const rect = render.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      spawnWeaponAtPointer({clientX: cx, clientY: cy}, w.dataset.weapon);
      ev.preventDefault();
    }
  });
});

function startWeaponDrag(type, ev) {
  draggingWeapon = { type };
  createGhost(type, ev);
  window.addEventListener('pointermove', weaponDragMove);
  window.addEventListener('pointerup', weaponDragEnd, { once: true });
}

function createGhost(type, ev) {
  ghostEl = document.createElement('div');
  ghostEl.className = 'weapon-ghost';
  ghostEl.style.position = 'fixed';
  ghostEl.style.pointerEvents = 'none';
  ghostEl.style.padding = '8px 10px';
  ghostEl.style.borderRadius = '8px';
  ghostEl.style.background = 'rgba(0,0,0,0.6)';
  ghostEl.style.color = 'white';
  ghostEl.style.zIndex = 9999;
  ghostEl.style.transform = 'translate(-50%,-50%) scale(1.05)';
  ghostEl.textContent = (type === 'bomb') ? '💣 Bomb' : (type === 'tnt') ? '🧨 TNT' : '🟢 Grenade';
  document.body.appendChild(ghostEl);
  weaponDragMove(ev);
}

function weaponDragMove(ev) {
  if (!ghostEl) return;
  ghostEl.style.left = ev.clientX + 'px';
  ghostEl.style.top = ev.clientY + 'px';
}

function weaponDragEnd(ev) {
  // place the weapon if released over canvas
  if (!draggingWeapon) cleanupGhost();
  const canvasRect = render.canvas.getBoundingClientRect();
  if (ev.clientX >= canvasRect.left && ev.clientX <= canvasRect.right && ev.clientY >= canvasRect.top && ev.clientY <= canvasRect.bottom) {
    spawnWeaponAtPointer(ev, draggingWeapon.type);
  }
  cleanupGhost();
  window.removeEventListener('pointermove', weaponDragMove);
  draggingWeapon = null;
}

function cleanupGhost(){
  if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
  ghostEl = null;
}

// spawn weapon as a Matter body at pointer position
function spawnWeaponAtPointer(ev, type) {
  const pos = getPointerPos(ev);
  const size = Math.max(18, parseInt(sizeRange.value,10) || 50);
  const opts = {
    friction: 0.4,
    restitution: 0.2,
    render: {}
  };

  let body;
  if (type === 'bomb') {
    body = Bodies.circle(snapToGrid(pos.x), snapToGrid(pos.y), Math.max(12, size/2), {
      ...opts,
      label: 'weapon',
      plugin: { weaponType: 'bomb' },
      render: { fillStyle: '#222', strokeStyle: '#444', lineWidth: 3 }
    });
  } else if (type === 'tnt') {
    body = Bodies.rectangle(snapToGrid(pos.x), snapToGrid(pos.y), size*0.9, Math.max(18, size*0.6), {
      ...opts,
      label: 'weapon',
      plugin: { weaponType: 'tnt' },
      render: { fillStyle: '#b14d2a', strokeStyle: '#8a2f14', lineWidth: 3 }
    });
  } else { // grenade
    body = Bodies.circle(snapToGrid(pos.x), snapToGrid(pos.y), Math.max(8, size/2.2), {
      ...opts,
      label: 'weapon',
      plugin: { weaponType: 'grenade' },
      render: { fillStyle: '#2f7a2f', strokeStyle: '#1e4f1e', lineWidth: 3 }
    });
  }

  // small visual hint: set render.sprite or text is complex; we'll use colors and shapes
  Composite.add(world, body);

  // make a tiny body property so we can detect taps reliably
  // Add a custom property that will be read when pointerdown on a body.
  // We'll not auto-explode: Tap-to-explode behavior required.
  return body;
}

// handle pointerdown over bodies for grab or explode
Events.on(mouseConstraint, 'mousedown', (e) => {
  // On mousedown, Matter's mouseConstraint has already potentially created a constraint for grabbing.
  // If current tool is 'grab', do nothing special (mouseConstraint handles). If 'erase', handle elsewhere.
  // But we want tap-to-explode: if pointer down on a weapon body and current tool is not 'grab', detonate.
  const mousePos = e.mouse.position;
  const found = Matter.Query.point(Composite.allBodies(world), mousePos)[0];
  if (found && found.label === 'weapon') {
    // Only explode when current tool isn't 'grab' (so players can pick up if they switch to grab)
    if (currentTool !== 'grab') {
      detonateWeapon(found);
    }
  }
});

// Also support touch pointerstart directly on canvas (for some touch flows)
render.canvas.addEventListener('pointerdown', (ev) => {
  // don't conflict with drag which spawns weapons; check if pointer is over a body
  const p = getPointerPos(ev);
  const found = Matter.Query.point(Composite.allBodies(world), p)[0];
  if (found && found.label === 'weapon') {
    if (currentTool !== 'grab') {
      detonateWeapon(found);
    }
  }
});

// --- Explosion behaviors ---
function detonateWeapon(body) {
  if (!body || body._destroying) return;
  body._destroying = true; // prevent double detonation
  const type = (body.plugin && body.plugin.weaponType) || 'bomb';
  const pos = body.position;

  if (type === 'grenade') {
    // Style 1 — tight high-force blast
    explode(pos.x, pos.y, 0.12, 100);
    // small visual pop: remove grenade
    Composite.remove(world, body);
  } else if (type === 'bomb') {
    // Style 2 — medium radius but strong
    explode(pos.x, pos.y, 0.09, 160);
    Composite.remove(world, body);
  } else if (type === 'tnt') {
    // Style 3 — large destructive explosion + fragments
    explode(pos.x, pos.y, 0.07, 300);
    // spawn fragments: several small dynamic bits
    spawnFragments(pos.x, pos.y, 12);
    Composite.remove(world, body);
  }
}

function explode(x,y,force = 0.06, radius = 120) {
  const bodies = Composite.allBodies(world);
  bodies.forEach(b=>{
    if (b.isStatic) return;
    const dir = Vector.sub(b.position, {x,y});
    const d = Math.max(1, Vector.magnitude(dir));
    if (d > radius) return;
    const falloff = 1 - (d / radius);
    const mag = (force * falloff) * (b.mass || 1);
    const normal = Vector.normalise(dir);
    Body.applyForce(b, b.position, Vector.mult(normal, mag));
    // also apply a small angular impulse
    Body.setAngularVelocity(b, b.angularVelocity + (Math.random()-0.5) * 0.2 * falloff);
  });
  // optional screen shake effect can be added by moving the renderer view for a frame — omitted for simplicity
}

function spawnFragments(x,y,count=8){
  for (let i=0;i<count;i++){
    const w = 6 + Math.round(Math.random()*12);
    const h = 6 + Math.round(Math.random()*12);
    const frag = Bodies.rectangle(x + (Math.random()-0.5)*30, y + (Math.random()-0.5)*30, w, h, {
      friction: 0.3,
      restitution: 0.2,
      render: { fillStyle: randomColor() }
    });
    Body.setVelocity(frag, { x: (Math.random()-0.5)*10, y: (Math.random()-0.8)*8 });
    Composite.add(world, frag);
    // remove fragments after some time
    setTimeout(()=> {
      try { Composite.remove(world, frag); } catch(e){}
    }, 8000 + Math.random()*6000);
  }
}

// Clear button
clearBtn.addEventListener('click', () => {
  const bodies = Composite.allBodies(world).slice();
  bodies.forEach(b=>{
    if (!b.isStatic) Composite.remove(world, b);
  });
});

// Download PNG
downloadBtn.addEventListener('click', () => {
  const url = render.canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'build-destroy.png';
  a.click();
});

// Gravity toggle
gravityCheckbox.addEventListener('change', () => {
  world.gravity.y = gravityCheckbox.checked ? 1 : 0;
});

// Utility: remove offscreen bodies occasionally to keep performance
setInterval(()=>{
  const bodies = Composite.allBodies(world);
  for (let i=bodies.length-1;i>=0;i--){
    const b = bodies[i];
    if (b.isStatic) continue;
    if (b.position.y > render.options.height + 200 || b.position.x < -500 || b.position.x > render.options.width + 500) {
      try { Composite.remove(world, b); } catch(e){}
    }
  }
}, 5000);

// small aesthetic: draw simple outlines for weapons slightly different
// (Matter.Render will use render.fillStyle, strokeStyle etc. which we set in spawn)

// --- Keep user from accidentally selecting text while dragging ---
document.addEventListener('selectstart', (e) => { if (draggingWeapon) e.preventDefault(); });

// --- Done ---
console.log('Build & Destroy loaded — drag a weapon to the stage, then tap it to explode!');
