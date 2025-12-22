// ============================================================
//  CyTube BattleTanks — Deterministic Monte Version (SPEED FIX)
// ============================================================

(function () {
    'use strict';

    if (window.__CYTUBE_BATTLETANKS__) return;
    window.__CYTUBE_BATTLETANKS__ = true;

    // -----------------------------
    // Constants
    // -----------------------------
    const WORLD_SIZE = 80;
    const FIXED_DT = 1 / 60;
    const SPEED_SCALE = 80; // ✅ RESTORED ORIGINAL MOTION SPEED

    const BASE_TANK_HP = 100;
    const BASE_FOE_HP = 40;
    const FOOD_HEAL = 30;
    const COLLISION_RADIUS = 1.2;

    // -----------------------------
    // Deterministic PRNG
    // -----------------------------
    function mulberry32(a) {
        return function () {
            let t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    async function sha256Hex(str) {
        const buf = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(str)
        );
        return [...new Uint8Array(buf)]
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    function seedFromString(str) {
        return parseInt(str.slice(0, 8), 16) >>> 0;
    }

    // -----------------------------
    // Three.js bootstrap
    // -----------------------------
    function loadThree(cb) {
        if (window.THREE) return cb();
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.min.js';
        s.onload = cb;
        document.head.appendChild(s);
    }

    // -----------------------------
    // Game State
    // -----------------------------
    let scene, camera, renderer;
    let entities = [];
    let running = false;
    let accumulator = 0;
    let lastTime = performance.now();

    // -----------------------------
    // Entity helpers
    // -----------------------------
    function spawnEntity(type, prng, hp) {
        const geom =
            type === 'tank'
                ? new THREE.BoxGeometry(2, 1, 3)
                : type === 'foe'
                    ? new THREE.SphereGeometry(1, 12, 12)
                    : new THREE.BoxGeometry(1, 1, 1);

        const mat =
            type === 'tank'
                ? new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true })
                : type === 'foe'
                    ? new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
                    : new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });

        const mesh = new THREE.Mesh(geom, mat);

        mesh.position.set(
            (prng() - 0.5) * WORLD_SIZE,
            0,
            (prng() - 0.5) * WORLD_SIZE
        );

        const vx = (prng() - 0.5) * 0.7 * SPEED_SCALE; // ✅ FIX
        const vz = (prng() - 0.5) * 0.7 * SPEED_SCALE; // ✅ FIX

        scene.add(mesh);

        entities.push({
            type,
            mesh,
            vx,
            vz,
            hp
        });
    }

    // -----------------------------
    // Physics + collisions
    // -----------------------------
    function stepSimulation() {
        for (const e of entities) {
            e.mesh.position.x += e.vx * FIXED_DT;
            e.mesh.position.z += e.vz * FIXED_DT;

            if (Math.abs(e.mesh.position.x) > WORLD_SIZE / 2) e.vx *= -1;
            if (Math.abs(e.mesh.position.z) > WORLD_SIZE / 2) e.vz *= -1;
        }

        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const a = entities[i];
                const b = entities[j];
                if (!a || !b) continue;

                const dx = a.mesh.position.x - b.mesh.position.x;
                const dz = a.mesh.position.z - b.mesh.position.z;
                const dist = Math.hypot(dx, dz);

                if (dist < COLLISION_RADIUS) {
                    if (a.type === 'tank' && b.type === 'food') {
                        a.hp += FOOD_HEAL;
                        scene.remove(b.mesh);
                        entities[j] = null;
                    } else if (b.type === 'tank' && a.type === 'food') {
                        b.hp += FOOD_HEAL;
                        scene.remove(a.mesh);
                        entities[i] = null;
                    } else {
                        a.hp -= 10;
                        b.hp -= 10;
                    }
                }
            }
        }

        entities = entities.filter(e => e && e.hp > 0);
    }

    // -----------------------------
    // Render loop
    // -----------------------------
    function animate(now) {
        if (!running) return;
        requestAnimationFrame(animate);

        accumulator += (now - lastTime) / 1000;
        lastTime = now;

        while (accumulator >= FIXED_DT) {
            stepSimulation();
            accumulator -= FIXED_DT;
        }

        renderer.render(scene, camera);
    }

    // -----------------------------
    // Start game
    // -----------------------------
    window.startBattleTanks = async function (seedWord) {
        running = false;
        entities.length = 0;

        const room = window.CLIENT?.name || 'default';
        const users = Object.keys(window.CLIENT?.users || {});
        const userCount = Math.max(1, users.length);

        const seedHex = await sha256Hex(room + seedWord + users.join(','));
        const prng = mulberry32(seedFromString(seedHex));

        scene.clear();

        for (let i = 0; i < userCount; i++) {
            spawnEntity('tank', prng, BASE_TANK_HP);
        }

        const foeCount = Math.max(1, Math.floor(userCount * 1.5));
        const foodCount = Math.max(1, Math.floor(userCount * 1.2));

        for (let i = 0; i < foeCount; i++) spawnEntity('foe', prng, BASE_FOE_HP);
        for (let i = 0; i < foodCount; i++) spawnEntity('food', prng, 1);

        running = true;
        lastTime = performance.now();
        requestAnimationFrame(animate);
    };

    // -----------------------------
    // Init
    // -----------------------------
    loadThree(() => {
        scene = new THREE.Scene();

        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        camera.position.set(0, 20, 40);
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.domElement.style.position = 'fixed';
        renderer.domElement.style.top = '0';
        renderer.domElement.style.left = '0';
        renderer.domElement.style.zIndex = '0';

        document.body.appendChild(renderer.domElement);
    });

})();
